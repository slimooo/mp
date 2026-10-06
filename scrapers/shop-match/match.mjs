#!/usr/bin/env node
// Match the mee.plus games with a shop catalogue (Play-In, Le Passe-Temps…), by barcode only.
//
// mee.plus games = the MyLudo scrape (data/myludo/games.jsonl.gz) filtered like MeePlus/meeplus-next
// scripts/myludo/common.ts `filterOut` (board game / extension / standalone, not crowdfunded, not print
// and play, with an author, a publisher and a French version). One row per MyLudo edition: its
// mee.plus sheet holds `myludo:<id>` in sourceRef/sourceRefs.
//
// A game is linked to a shop product only when one of its EAN/ISBN codes is identical to the
// product's barcode (both compared as GTIN-14, i.e. digits left-padded with zeros, so a UPC-12 and its
// EAN-13 "0…" form are the same code). No title matching: a game without an identical code is "non".
// Publishers sometimes reuse a barcode, so a linked game whose title looks nothing like the shop
// name gets <shop>_title_check = "à vérifier" (it stays linked: the code is identical).
//
// Each shop scraper writes data/<shop>/products.jsonl, one product per line, with at least
// { id, url, name, barcode, gtin14?, images: [url], rules: [{ url }] }.
//
// Input:  data/myludo/games.jsonl.gz, data/<shop>/products.jsonl (or products.jsonl.gz)
// Output: data/<shop>/products.jsonl.gz        every scraped product
//         data/<shop>/meeplus-<shop>.jsonl.gz  one line per mee.plus game, columns prefixed <shop>_
//         data/<shop>/meeplus-<shop>.csv.gz    same, flat (lists joined with " | ")
//
// --only-missing-from <shop>[,<shop>…]: only the games that have an EAN/ISBN and that none of these
// shops settled, i.e. absent from data/<shop>/meeplus-<shop>.jsonl.gz or linked with
// <shop>_title_check = "à vérifier" (e.g. Ludum for what Play-In did not find, Philibert for what
// neither found). Those rows keep <shop>_present and <shop>_title_check for each listed shop.
//
// Usage: node match.mjs --shop playin --label Play-In
//        node match.mjs --shop ludum --label Ludum --only-missing-from playin
//        node match.mjs --shop philibert --label Philibert --only-missing-from playin,ludum

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { csvCell, filterOut, gtin, readJsonl, titleCheck } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(__dirname, '../../data'));
const ML_FILE = path.join(DATA, 'myludo/games.jsonl.gz');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') && acc.push([a.slice(2), arr[i + 1]]), acc), []));
const SHOP = args.shop;
if (!/^[a-z0-9]+$/.test(SHOP ?? '')) { console.error('Usage: node match.mjs --shop <dossier de data/> [--label <nom>]'); process.exit(1); }
const LABEL = args.label ?? SHOP;
const OUT_DIR = path.join(DATA, SHOP);
const PREVIOUS = args['only-missing-from'] ? args['only-missing-from'].split(',') : [];
if (PREVIOUS.some((p) => !/^[a-z0-9]+$/.test(p))) { console.error('--only-missing-from <dossier de data/>[,<dossier>…]'); process.exit(1); }
const PRODUCTS_FILE = [path.join(OUT_DIR, 'products.jsonl'), path.join(OUT_DIR, 'products.jsonl.gz')].find((f) => fs.existsSync(f));

async function main() {
  // shop products by barcode
  const products = [];
  for await (const p of readJsonl(PRODUCTS_FILE)) products.push(p);
  const byGtin = new Map();
  for (const p of products) {
    for (const code of new Set([gtin(p.barcode), gtin(p.gtin14)].filter(Boolean))) {
      if (!byGtin.has(code)) byGtin.set(code, []);
      byGtin.get(code).push(p);
    }
  }
  const noBarcode = products.filter((p) => !gtin(p.barcode) && !gtin(p.gtin14)).length;
  console.log(`${LABEL} : ${products.length} produits, ${byGtin.size} codes-barres distincts, ${noBarcode} sans code-barres`);

  // games another shop did not settle (--only-missing-from)
  let previous = null;
  if (PREVIOUS.length) {
    previous = new Map(); // ml_id → { <shop>_present, <shop>_title_check… } merged over the listed shops
    for (const shop of PREVIOUS) {
      for await (const r of readJsonl(path.join(DATA, shop, `meeplus-${shop}.jsonl.gz`))) {
        previous.set(r.ml_id, { ...previous.get(r.ml_id), [`${shop}_present`]: r[`${shop}_present`], [`${shop}_title_check`]: r[`${shop}_title_check`] });
      }
    }
  }

  const rows = [];
  const skipped = {};
  for await (const r of readJsonl(ML_FILE)) {
    const why = filterOut(r);
    if (why) { skipped[why] = (skipped[why] ?? 0) + 1; continue; }
    const barcodes = Array.isArray(r.barcodes) ? r.barcodes.filter(Boolean) : [];
    const codes = [...new Set(barcodes.map(gtin).filter(Boolean))];
    const prev = previous?.get(r.id);
    if (previous) {
      if (!codes.length) { skipped['sans EAN/ISBN'] = (skipped['sans EAN/ISBN'] ?? 0) + 1; continue; }
      const foundAt = PREVIOUS.find((shop) => prev?.[`${shop}_present`] === 'oui' && prev?.[`${shop}_title_check`] === 'ok');
      if (foundAt) { skipped[`trouvé chez ${foundAt}`] = (skipped[`trouvé chez ${foundAt}`] ?? 0) + 1; continue; }
    }
    const matches = [];
    for (const code of codes) for (const p of byGtin.get(code) ?? []) if (!matches.some((m) => m.p.id === p.id)) matches.push({ code, p });
    const P = (k) => `${SHOP}_${k}`;
    rows.push({
      ml_id: r.id,
      meeplus_source_ref: `myludo:${r.id}`,
      title: r.title,
      edition: r.edition ?? null,
      type: r.type,
      publishers: r.publishers ?? [],
      barcodes,
      ...Object.fromEntries(PREVIOUS.flatMap((shop) => [[`${shop}_present`, prev?.[`${shop}_present`] ?? 'non'], [`${shop}_title_check`, prev?.[`${shop}_title_check`] ?? null]])),
      [P('present')]: matches.length ? 'oui' : 'non',
      [P('matched_ean')]: [...new Set(matches.map((m) => m.code.replace(/^0+(?=\d{13}$)/, '')))],
      [P('title_check')]: matches.length ? titleCheck(r.title, matches.map((m) => m.p.name)) : null,
      [P('ids')]: matches.map((m) => m.p.id),
      [P('names')]: matches.map((m) => m.p.name),
      [P('urls')]: matches.map((m) => m.p.url),
      [P('images')]: [...new Set(matches.flatMap((m) => m.p.images))],
      [P('rules_pdf')]: [...new Set(matches.flatMap((m) => (m.p.rules ?? []).map((x) => x.url)))],
    });
  }

  const col = (r, k) => r[`${SHOP}_${k}`];
  const linked = rows.filter((r) => col(r, 'present') === 'oui');
  const toCheck = linked.filter((r) => col(r, 'title_check') !== 'ok').length;
  const withCode = rows.filter((r) => r.barcodes.length).length;
  const usedProducts = new Set(linked.flatMap((r) => col(r, 'ids')));
  console.log(`mee.plus : ${rows.length} jeux${PREVIOUS.length ? ` non réglés par ${PREVIOUS.join(', ')}` : ''} (${withCode} avec EAN/ISBN) · non retenus : ${JSON.stringify(skipped)}`);
  console.log(`Présents chez ${LABEL} : ${linked.length} (${linked.filter((r) => r.type === 'extension').length} extensions) · avec règle PDF : ${linked.filter((r) => col(r, 'rules_pdf').length).length} · produits ${LABEL} reliés : ${usedProducts.size} · titre à vérifier : ${toCheck}`);

  const gzWrite = (file, text) => fs.writeFileSync(path.join(OUT_DIR, file), zlib.gzipSync(text, { level: 9 }));
  if (PRODUCTS_FILE.endsWith('.jsonl')) gzWrite('products.jsonl.gz', products.map((p) => JSON.stringify(p)).join('\n') + '\n');
  gzWrite(`meeplus-${SHOP}.jsonl.gz`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const cols = Object.keys(rows[0]);
  gzWrite(`meeplus-${SHOP}.csv.gz`, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n');
  console.log(`Écrit : data/${SHOP}/{products.jsonl.gz, meeplus-${SHOP}.jsonl.gz, meeplus-${SHOP}.csv.gz}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
