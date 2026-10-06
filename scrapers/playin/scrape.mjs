#!/usr/bin/env node
// Scrape the Play-In catalogue (https://www.play-in.com/fr): every sealed product (board games,
// extensions, accessories… — no single trading cards) listed by the site's own search, then each
// product page for its barcode (EAN/GTIN), pictures and rules PDFs.
//
// "Catalogue" means what the site search lists, i.e. the products currently on sale (in stock,
// in store or on back order). Unlisted product pages cannot be enumerated: unknown and hidden ids
// both return the same generic page.
//
// Output (resumable): data/playin/catalog.jsonl (search listing, rewritten each run) and
// data/playin/products.jsonl (one product page per line; seeded from products.jsonl.gz when present,
// ids already there are skipped). Failures go to data/playin/errors.jsonl and are retried on the next run.
//
// --refresh-rules also reads again the pages of the products linked to a mee.plus game
// (data/playin/meeplus-playin.jsonl.gz) that had no rules PDF yet: Play-In adds rules after the
// product goes on sale. The new reading replaces the old one.
//
// Usage: node scrape.mjs [--concurrency 2] [--interval 700] [--limit N] [--ids 636222,264994] [--skip-list] [--refresh-rules]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { BASE, args, currentInterval, getHtml, rscObjects, rscPayload, search } from './client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(__dirname, '../../data'));
const OUT_DIR = path.join(DATA, 'playin');
const CATALOG_FILE = path.join(OUT_DIR, 'catalog.jsonl');
const OUT_FILE = path.join(OUT_DIR, 'products.jsonl');
const OUT_GZ = path.join(OUT_DIR, 'products.jsonl.gz');
const MATCH_GZ = path.join(OUT_DIR, 'meeplus-playin.jsonl.gz');
const ERR_FILE = path.join(OUT_DIR, 'errors.jsonl');

const CONCURRENCY = Number(args.concurrency ?? 2);
const LIMIT = args.limit ? Number(args.limit) : Infinity;

const readJsonl = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

// ---------- 1. catalogue listing (search server action, 50 per page) ----------
async function listCatalog() {
  const filters = { searchType: ['SEALED_PRODUCTS'] };
  const orderBy = ['name-asc']; // stable order so pages do not shift while paging
  const first = await search({ filters, orderBy });
  const { lastPage, totalCount } = first.catalog.paginationInfos;
  console.log(`Catalogue: ${totalCount} produits scellés, ${lastPage} pages`);
  const byId = new Map();
  const add = (d) => {
    for (const { sealedProduct: p } of d.items) {
      if (p) byId.set(p._id, { id: p._id, name: p.name, family: p.family?.transName ?? null, category: p.category?.transName ?? null, brand: p.brandLabel ?? null, sellable: p.sellable, releasedAt: p.releasedAt ?? null, imageUrl: p.imageUrl ?? null });
    }
  };
  add(first);
  for (let page = 2; page <= lastPage; page++) {
    add(await search({ filters, orderBy, page }));
    if (page % 20 === 0) console.log(`  page ${page}/${lastPage} · ${byId.size} produits`);
  }
  if (byId.size < totalCount) console.warn(`  ${totalCount - byId.size} produits manquent au listing (catalogue modifié pendant la lecture ?)`);
  const rows = [...byId.values()];
  fs.writeFileSync(CATALOG_FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows;
}

// ---------- 2. product page ----------
const digits = (s) => (s == null ? null : String(s).replace(/\D/g, '') || null);

export function parseProduct(id, html) {
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
  const rsc = rscPayload(html);
  const products = rscObjects(rsc, 'SealedProduct');
  const main = products.find((o) => o._id === id && 'barCode' in o);
  if (!main) return null; // generic page: unknown or hidden product
  const extra = products.find((o) => 'visibility' in o && 'imagesUrl' in o) ?? {};
  const gtin14 = rsc.match(new RegExp(`"sku":"${id}","gtin14":"([^"]*)"`))?.[1] ?? null;
  return {
    id,
    url: canonical?.startsWith(`${BASE}/fr/produit/${id}/`) ? canonical : `${BASE}/fr/produit/${id}`,
    name: main.name ?? main.transName ?? null,
    barcode: digits(main.barCode),
    gtin14: digits(gtin14),
    family: main.family?.name ?? null,
    category: main.category?.name ?? null,
    editor: main.editor?.name ?? null,
    brand: main.brand?.name ?? null,
    lang: main.lang?.name ?? null,
    released_at: main.releasedAt ?? null,
    is_base_box: extra.isBaseBox ?? null,
    is_expansion_box: extra.isExpansionBox ?? null,
    sellable: extra.sellable ?? null,
    old: extra.old ?? null,
    availability: main.schemaAvailability ?? null,
    price_eur: main.sellPrice ?? null,
    authors: (main.authors?.collection ?? []).map((a) => a.name),
    artists: (main.artists?.collection ?? []).map((a) => a.name),
    images: [...new Set(main.imagesUrl ?? extra.imagesUrl ?? [])],
    rules: (main.boardgameRules?.collection ?? []).filter((r) => r.ruleUrl).map((r) => ({ locale: r.locale ?? null, url: r.ruleUrl })),
    youtube_ids: (main.videos?.collection ?? []).map((v) => v.youtubeId).filter(Boolean),
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(OUT_FILE) && fs.existsSync(OUT_GZ)) fs.writeFileSync(OUT_FILE, zlib.gunzipSync(fs.readFileSync(OUT_GZ)));
  let ids;
  if (args.ids) ids = String(args.ids).split(',').map(Number);
  else ids = (args['skip-list'] ? readJsonl(CATALOG_FILE) : await listCatalog()).map((r) => r.id);

  const products = readJsonl(OUT_FILE);
  const done = new Set(products.map((r) => r.id));
  let refresh = [];
  if (args['refresh-rules'] && fs.existsSync(MATCH_GZ)) {
    const linked = new Set();
    for (const line of zlib.gunzipSync(fs.readFileSync(MATCH_GZ)).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      for (const id of Array.isArray(r.playin_ids) ? r.playin_ids : String(r.playin_ids ?? '').split(' | ')) if (id) linked.add(Number(id));
    }
    const withRules = new Set(products.filter((p) => p.rules?.length).map((p) => p.id));
    refresh = [...linked].filter((id) => done.has(id) && !withRules.has(id));
    for (const id of refresh) done.delete(id);
  }
  const todo = [...new Set([...ids, ...refresh])].filter((id) => !done.has(id)).slice(0, LIMIT);
  console.log(`Fiches produit : ${done.size} déjà lues, ${todo.length} à lire${refresh.length ? ` (dont ${refresh.length} relues pour les règles)` : ''}`);
  if (fs.existsSync(ERR_FILE)) fs.unlinkSync(ERR_FILE);

  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  let n = 0;
  let missing = 0;
  let failed = 0;
  const started = Date.now();
  const queue = [...todo];
  async function worker() {
    for (let id; (id = queue.shift()) !== undefined; ) {
      try {
        const rec = parseProduct(id, await getHtml(`/fr/produit/${id}/p`));
        if (rec) out.write(JSON.stringify(rec) + '\n');
        else { missing++; fs.appendFileSync(ERR_FILE, JSON.stringify({ id, error: 'no product data' }) + '\n'); }
      } catch (e) {
        failed++;
        fs.appendFileSync(ERR_FILE, JSON.stringify({ id, error: e.message }) + '\n');
      }
      if (++n % 100 === 0) {
        const rate = n / ((Date.now() - started) / 1000);
        console.log(`  ${n}/${todo.length} · ${rate.toFixed(2)}/s · reste ~${Math.round((todo.length - n) / rate / 60)} min · interval ${currentInterval()}ms · sans données ${missing} · erreurs ${failed}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await new Promise((r) => out.end(r));
  // A page read again replaces the previous reading: the last line of an id wins.
  if (refresh.length) {
    const latest = new Map(readJsonl(OUT_FILE).map((r) => [r.id, r]));
    fs.writeFileSync(OUT_FILE, [...latest.values()].map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  console.log(`Terminé : ${n - missing - failed} fiches lues, ${missing} sans données, ${failed} erreurs`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
