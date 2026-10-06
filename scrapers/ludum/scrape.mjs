#!/usr/bin/env node
// Scrape the Ludum catalogue (https://www.ludum.fr, PrestaShop): the game product pages listed in the
// site's sitemap, for their EAN13 ("Détails du produit") and pictures. Books, comics, puzzles and
// painting supplies are skipped (see SKIPPED_CATEGORIES).
//
// Ludum's search (/rechercher) is disallowed to every robot by its robots.txt, so games are not looked
// up by EAN there: every game page of the sitemap is read once and matched locally by EAN13
// (scripts/shop-match). Polite by design: identifies itself as scrappfire, follows the robots.txt rules
// of `User-agent: *` (never fetches a disallowed path), one request at a time every --interval ms,
// backs off on 429/503.
//
// Output (resumable): data/ludum/urls.txt (product URLs found), data/ludum/products.jsonl (one product
// page per line, append-only; seeded from products.jsonl.gz when present, URLs already there are
// skipped). Failures go to data/ludum/errors.jsonl and are retried on the next run.
//
// Usage: node scrape.mjs [--interval 800] [--max-minutes N] [--limit N] [--urls url1,url2] [--refresh-urls]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseProduct } from './parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(__dirname, '../../data'));
const OUT_DIR = path.join(DATA, 'ludum');
const URLS_FILE = path.join(OUT_DIR, 'urls.txt');
const OUT_FILE = path.join(OUT_DIR, 'products.jsonl');
const OUT_GZ = path.join(OUT_DIR, 'products.jsonl.gz');
const ERR_FILE = path.join(OUT_DIR, 'errors.jsonl');

const BASE = 'https://www.ludum.fr';
const UA = 'scrappfire/1.0 (+https://github.com/slimooo/scrappfire)';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]);
    return acc;
  }, []),
);
const BASE_INTERVAL = Number(args.interval ?? 800);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DEADLINE = args['max-minutes'] ? Date.now() + Number(args['max-minutes']) * 60000 : Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- robots.txt (group `User-agent: *`) ----------
let rules = [];
let robotsSitemaps = [];
let crawlDelay = 0;
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = [m[0], m[1].toLowerCase(), m[2].trim()];
    if (key === 'sitemap') { robotsSitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [], delay: 0 }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if ((key === 'allow' || key === 'disallow') && value) current.rules.push({ allow: key === 'allow', pattern: value });
    if (key === 'crawl-delay') current.delay = Number(value) || 0;
  }
  const star = groups.filter((g) => g.agents.includes('*'));
  rules = star.flatMap((g) => g.rules);
  crawlDelay = Math.max(0, ...star.map((g) => g.delay));
}
const toRegex = (pattern) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
/** Longest matching rule wins, Allow wins ties (RFC 9309). */
export function allowed(url) {
  const u = new URL(url, BASE);
  const target = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    if (!toRegex(r.pattern).test(target)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// ---------- HTTP (one request at a time, paced) ----------
let interval = BASE_INTERVAL;
let nextSlot = 0;
async function get(url, attempt = 0) {
  if (!allowed(url)) throw new Error(`robots.txt disallows ${url}`);
  const wait = nextSlot - Date.now();
  if (wait > 0) await sleep(wait);
  nextSlot = Date.now() + interval;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, signal: AbortSignal.timeout(45000) });
  } catch (e) {
    if (attempt < 8) { await sleep(Math.min(60000, 2000 * 2 ** attempt)); return get(url, attempt + 1); }
    throw e;
  }
  if ((res.status === 429 || res.status === 503) && attempt < 8) {
    interval = Math.min(10000, Math.round(interval * 1.5));
    const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 30000;
    console.warn(`  ${res.status} sur ${url}, pause ${retryAfter / 1000}s, intervalle ${interval}ms`);
    await sleep(retryAfter);
    return get(url, attempt + 1);
  }
  if (res.status >= 500 && attempt < 4) { await sleep(5000 * 2 ** attempt); return get(url, attempt + 1); }
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return (url.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
}

// ---------- product URLs ----------
const PRODUCT_URL = /^https:\/\/www\.ludum\.fr\/([^/?#]+)\/[^/?#]+-\d+$/;
const SKIPPED_CATEGORIES = new Set([
  'mangas', 'bd', 'comics', 'shonen', 'bd-mangas-comics', 'blog',
  'puzzles-1000-pieces', 'puzzles-500-pieces', 'puzzles-3d', 'puzzles-escape-game', 'puzzles-2000-6000-pieces', 'puzzles-pour-petits-2-4-ans',
  'puzzles-pour-enfants-5-7-ans', 'puzzles-pour-grands-8-12-ans', 'puzzles-6000-pieces', 'puzzles-2000-pieces', 'puzzles-1500-pieces',
  'puzzles-pour-bebes-0-2-ans', 'puzzle-adulte', 'puzzle-enfant', 'accessoires-puzzle',
  'Peinture', 'pinceaux', 'outillages-modelisme', 'cartes-cadeaux-ludumfr', 'programme-fidelite', 'editeur',
]);
const isGamePage = (u) => { const m = u.match(PRODUCT_URL); return Boolean(m) && !SKIPPED_CATEGORIES.has(m[1]); };

async function sitemapUrls() {
  const queue = [...new Set([...robotsSitemaps.filter((u) => u.endsWith('.xml')), `${BASE}/1_index_sitemap.xml`])];
  const seen = new Set();
  const urls = new Set();
  while (queue.length) {
    const sm = queue.shift();
    if (seen.has(sm) || !allowed(sm)) continue;
    seen.add(sm);
    let xml;
    try { xml = await get(sm); } catch (e) { console.warn(`  sitemap ${sm} : ${e.message}`); continue; }
    if (!xml || !/<(urlset|sitemapindex)/.test(xml)) continue;
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/.test(xml)) queue.push(...locs);
    else for (const u of locs) if (isGamePage(u)) urls.add(u);
    console.log(`  sitemap ${sm} · ${urls.size} fiches de jeux`);
  }
  return [...urls];
}

// ---------- main ----------
const readJsonl = (text) => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const robots = await get(`${BASE}/robots.txt`).catch(() => null);
  if (robots) parseRobots(robots);
  if (crawlDelay * 1000 > interval) interval = crawlDelay * 1000;
  if (!allowed(`${BASE}/`)) throw new Error('robots.txt interdit le site à User-agent: *');
  console.log(`robots.txt : ${rules.length} règles pour *, ${robotsSitemaps.length} sitemap(s), intervalle ${interval}ms`);

  let urls;
  if (args.urls) urls = String(args.urls).split(',');
  else if (!args['refresh-urls'] && (fs.existsSync(URLS_FILE) || fs.existsSync(`${URLS_FILE}.gz`))) {
    const raw = fs.existsSync(URLS_FILE) ? fs.readFileSync(URLS_FILE) : zlib.gunzipSync(fs.readFileSync(`${URLS_FILE}.gz`));
    urls = raw.toString('utf8').split('\n').filter(Boolean);
  }
  else {
    urls = await sitemapUrls();
    if (!urls.length) throw new Error('Aucune fiche produit dans le sitemap');
    fs.writeFileSync(URLS_FILE, urls.join('\n') + '\n');
  }
  urls = urls.filter((u) => allowed(u));
  console.log(`${urls.length} fiches produit au catalogue`);

  if (!fs.existsSync(OUT_FILE) && fs.existsSync(OUT_GZ)) fs.writeFileSync(OUT_FILE, zlib.gunzipSync(fs.readFileSync(OUT_GZ)));
  const done = new Set(fs.existsSync(OUT_FILE) ? readJsonl(fs.readFileSync(OUT_FILE, 'utf8')).map((r) => r.url_listed) : []);
  const todo = urls.filter((u) => !done.has(u)).slice(0, LIMIT);
  console.log(`Fiches : ${done.size} déjà lues, ${todo.length} à lire`);
  if (fs.existsSync(ERR_FILE)) fs.unlinkSync(ERR_FILE);

  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  let n = 0, missing = 0, failed = 0;
  const started = Date.now();
  for (const url of todo) {
    if (Date.now() > DEADLINE) { console.log('Limite de temps atteinte : la prochaine exécution reprendra ici.'); break; }
    try {
      const html = await get(url);
      const rec = html && parseProduct(html, url);
      if (rec) out.write(JSON.stringify({ ...rec, url_listed: url, scraped_at: new Date().toISOString() }) + '\n');
      else { missing++; fs.appendFileSync(ERR_FILE, JSON.stringify({ url, error: html ? 'pas de données produit' : '404' }) + '\n'); }
    } catch (e) {
      failed++;
      fs.appendFileSync(ERR_FILE, JSON.stringify({ url, error: e.message }) + '\n');
    }
    if (++n % 100 === 0) {
      const rate = n / ((Date.now() - started) / 1000);
      console.log(`  ${n}/${todo.length} · ${rate.toFixed(2)}/s · reste ~${Math.round((todo.length - n) / rate / 60)} min · sans données ${missing} · erreurs ${failed}`);
    }
  }
  await new Promise((r) => out.end(r));
  fs.writeFileSync(OUT_GZ, zlib.gzipSync(fs.readFileSync(OUT_FILE), { level: 9 }));
  console.log(`Terminé : ${n - missing - failed} fiches ajoutées, ${missing} sans données, ${failed} erreurs, ${todo.length - n} restantes`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
