#!/usr/bin/env node
// Scrape every game listed in the MyLudo sitemaps via the site's own JSON
// endpoints (views/game/datas.php). Comments are intentionally not fetched.
//
// Output (resumable, append-only): data/myludo/games.jsonl, one game per line.
// Failures go to data/myludo/errors.jsonl and are retried on the next run.
//
// The site rate-limits (HTTP 429) around ~1.3 req/s, so all requests go through
// one global pacer (--interval ms between request starts) that backs off on 429.
//
// Usage: node scrape.mjs [--concurrency 3] [--interval 800] [--limit N] [--ids 95627,4680]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, UA, args, sleep, api, currentInterval } from './client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(__dirname, '../../data'));
const OUT_DIR = path.join(DATA, 'myludo');
const OUT_FILE = path.join(OUT_DIR, 'games.jsonl');
const ERR_FILE = path.join(OUT_DIR, 'errors.jsonl');

const SITEMAPS = ['games-1.xml', 'games-2.xml'];

const CONCURRENCY = Number(args.concurrency ?? 3);
const BASE_INTERVAL = Number(args.interval ?? 800);
const LIMIT = args.limit ? Number(args.limit) : Infinity;

const gameApi = (params) => api('game', params);

async function fetchList(type, id) {
  const all = [];
  let count = null;
  for (let page = 1; page <= 50; page++) {
    const d = await gameApi({ type, id, page, limit: '', order: '' });
    const list = d?.list ?? [];
    count = d?.count ?? count;
    all.push(...list);
    if (!list.length || count == null || all.length >= count) break;
  }
  return all;
}

// ---------- normalisation ----------
const num = (v) => (v == null || v === '' || v === false ? null : Number(String(v).replace(',', '.')));
const stripHtml = (h) => (h ? h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim() : null);
const titles = (obj) => (obj ? Object.values(obj) : []);
const groupTitles = (obj) => (obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.map((x) => x.title)])) : {});

function buildRecord(id, code, game, info, images, videos, files) {
  const r = game.rating ?? {};
  const themes = info?.themes ?? {};
  const people = Object.values(info?.people ?? {}).map((p) => ({ id: p.id, name: p.title, code: p.code, roles: p.roles }));
  const byRole = (re) => people.filter((p) => p.roles?.some((x) => re.test(x))).map((p) => p.name);

  return {
    id: game.id,
    code: game.code,
    url: `${BASE}/#!/game/${game.code}-${game.id}`,
    title: game.title,
    subtitle: game.subtitle || null,
    edition: game.edition || null,
    type: game.type,
    release_date: game.release?.date ?? null,
    crowdfunding: game.crowdfunding,
    languages: titles(game.languages),

    players_min: num(game.players_min),
    players_max: num(game.players_max),
    age_min: num(game.age_min),
    age_max: num(game.age_max),
    duration_min: num(game.time_min),
    duration_max: num(game.time_max),

    categories: titles(themes.categorie),
    themes: titles(themes.theme),
    mechanics: titles(themes.mecanisme),
    ranges: titles(themes.gamme),
    other_tags: Object.fromEntries(Object.entries(themes).filter(([k]) => !['categorie', 'theme', 'mecanisme', 'gamme'].includes(k)).map(([k, v]) => [k, titles(v)])),

    authors: byRole(/^Aut/),
    illustrators: byRole(/^Illustr/),
    publishers: byRole(/^[ÉE]diteur/),
    people,

    description: stripHtml(info?.description),
    description_html: info?.description || null,
    content: stripHtml(info?.content),
    price_eur: num(info?.offer),
    barcodes: info?.barcodes || [],
    dimensions_cm: info?.metrics ? { length: info.metrics.len, width: info.metrics.width, height: info.metrics.height, weight: info.metrics.weight || null } : null,
    sleeves: info?.sleeves || [],
    awards: (info?.awards || []).map((a) => ({ award: a.title, category: a.category?.title, year: a.edition })),
    options: groupTitles(info?.options),
    factions: groupTitles(info?.factions),
    print_and_play: info?.pnp ?? false,
    play_online: info?.playonline || null,
    music_playlist: info?.playlist || null,
    accessibility: info?.accessibility || null,

    ratings: {
      community_note: num(r.game?.note),
      community_votes: r.game?.audience ?? 0,
      community_distribution: Object.fromEntries(Object.entries(r.game?.sharing ?? {}).map(([k, v]) => [k, v.audience])),
      complexity_note: num(r.complexity?.note),
      complexity_votes: r.complexity?.audience ?? 0,
      complexity_radar: r.complexity?.radar?.values ?? null,
    },
    community: {
      best_players: game.community?.players ?? null,
      avg_duration: game.community?.duration ?? null,
      players_votes: Object.fromEntries(Object.values(game.community?.tables ?? {}).map((t) => [t.label, t.value])),
    },
    stats: {
      in_collections: game.collected,
      wishes: game.wishes,
      plays: game.plays,
      extensions: game.nbextensions,
      medias: game.nbmedias,
    },

    cover: game.image?.jpg ?? null,
    images: images.map((m) => ({ id: m.id, url: m.image?.jpg, thumb: m.image?.jpg360, cheers: m.cheers, by: m.user?.name })),
    videos: videos.map((m) => ({ id: m.id, title: m.title, youtube_id: m.video, youtube_url: m.video ? `https://www.youtube.com/watch?v=${m.video}` : null, channel: m.channel?.title ?? null, thumb: m.image?.jpg })),
    files: files.map((f) => ({ id: f.id, title: f.title, type: f.type, category: f.category, version: f.version, date: f.date, size: f.size, languages: titles(f.languages), page_url: f.link, download_url: `${BASE}/download/file/${f.id}` })),

    scraped_at: new Date().toISOString(),
  };
}

async function scrapeGame({ id, code }) {
  const game = await gameApi({ type: 'game', id });
  if (!game?.id) return { missing: true };
  const info = await gameApi({ type: 'info', id, page: 1, limit: '', order: 'bytitle' });
  // game.images already holds the image gallery; nbmedias = images + videos.
  // Only hit the tabs when the embedded list can't account for every media.
  let images = Array.isArray(game.images) ? game.images : [];
  let videos = [];
  if (game.nbmedias > images.length) {
    videos = await fetchList('videos', id);
    if (images.length + videos.length < game.nbmedias) images = await fetchList('images', id);
  }
  const files = await fetchList('files', id);
  return buildRecord(id, code, game, info, images, videos, files);
}

// ---------- game list ----------
async function loadGameList() {
  if (args.ids) return String(args.ids).split(',').map((id) => ({ id: id.trim(), code: '' }));
  const games = new Map();
  for (const sm of SITEMAPS) {
    const xml = await (await fetch(`${BASE}/content/sitemap/${sm}`, { headers: { 'User-Agent': UA } })).text();
    for (const m of xml.matchAll(/#!\/game\/([^<]+)-(\d+)<\/loc>/g)) games.set(m[2], { id: m[2], code: m[1] });
  }
  return [...games.values()];
}

function loadDone() {
  const done = new Set();
  if (!fs.existsSync(OUT_FILE)) return done;
  for (const line of fs.readFileSync(OUT_FILE, 'utf8').split('\n')) {
    if (!line) continue;
    try { done.add(String(JSON.parse(line).id)); } catch {}
  }
  return done;
}

// ---------- main ----------
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = await loadGameList();
  const done = loadDone();
  const todo = all.filter((g) => !done.has(g.id)).slice(0, LIMIT);
  console.log(`${all.length} games in sitemaps, ${done.size} already scraped, ${todo.length} to do (concurrency ${CONCURRENCY}, interval ${BASE_INTERVAL}ms)`);
  if (fs.existsSync(ERR_FILE)) fs.renameSync(ERR_FILE, `${ERR_FILE}.prev`);

  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  const errOut = fs.createWriteStream(ERR_FILE, { flags: 'a' });
  let idx = 0, ok = 0, failed = 0, missing = 0;
  const t0 = Date.now();

  async function worker() {
    while (idx < todo.length) {
      const g = todo[idx++];
      try {
        const rec = await scrapeGame(g);
        if (rec.missing) { missing++; errOut.write(JSON.stringify({ ...g, error: 'missing' }) + '\n'); }
        else { out.write(JSON.stringify(rec) + '\n'); ok++; }
      } catch (e) {
        // give each failed game one more try at the end of the queue
        if (!g.retried) { todo.push({ ...g, retried: true }); continue; }
        failed++;
        errOut.write(JSON.stringify({ ...g, error: String(e.message ?? e) }) + '\n');
      }
      const n = ok + failed + missing;
      if (n % 50 === 0) {
        const rate = n / ((Date.now() - t0) / 1000);
        const eta = (todo.length - n) / rate / 3600;
        console.log(`[${new Date().toISOString()}] ${n}/${todo.length} ok=${ok} failed=${failed} missing=${missing} ${rate.toFixed(2)} games/s interval=${currentInterval()}ms ETA ${eta.toFixed(1)}h`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await new Promise((r) => out.end(r));
  await new Promise((r) => errOut.end(r));
  console.log(`Done: ok=${ok} failed=${failed} missing=${missing} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

main().catch((e) => { console.error(e); process.exit(1); });
