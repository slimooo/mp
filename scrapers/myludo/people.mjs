#!/usr/bin/env node
// Fetch the MyLudo profile (views/people/datas.php) of every author and
// illustrator credited in data/myludo/games.jsonl: bio, gender, roles,
// website and social links. Most-credited people first.
//
// Output (resumable, append-only): data/myludo/people.jsonl, one person per line.
// Failures go to data/myludo/people-errors.jsonl and are retried on the next run.
// Name splitting (first name / last name / pseudonym) is done afterwards by names.mjs.
//
// Usage: node people.mjs [--concurrency 3] [--interval 800] [--limit N] [--ids 103,68]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, args, api, currentInterval } from './client.mjs';

// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data'));
const DIR = path.join(DATA, 'myludo');
const GAMES_FILE = path.join(DIR, 'games.jsonl');
const OUT_FILE = path.join(DIR, 'people.jsonl');
const ERR_FILE = path.join(DIR, 'people-errors.jsonl');

const CONCURRENCY = Number(args.concurrency ?? 3);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CREATOR_ROLE = /^(Aut|Illustr)/;
const SOCIALS = ['site', 'facebook', 'twitter', 'instagram', 'bluesky', 'youtube', 'twitch', 'tiktok', 'discord'];

const stripHtml = (h) => (h ? h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{2,}/g, '\n').trim() : null);

// Authors and illustrators credited on at least one game, with their credit count.
function loadCreators() {
  const people = new Map();
  for (const line of fs.readFileSync(GAMES_FILE, 'utf8').split('\n')) {
    if (!line) continue;
    for (const p of JSON.parse(line).people) {
      if (!p.roles?.some((r) => CREATOR_ROLE.test(r))) continue;
      const e = people.get(p.id) ?? { id: p.id, code: p.code, name: p.name, credits: 0 };
      e.credits++;
      people.set(p.id, e);
    }
  }
  return [...people.values()].sort((a, b) => b.credits - a.credits);
}

function buildRecord(c, d) {
  return {
    id: d.id,
    code: d.code,
    url: `${BASE}/#!/people/${d.code}-${d.id}`,
    name: d.title,
    gender: d.gender || null,
    roles: d.roles ?? [],
    is_author: !!d.author,
    is_illustrator: !!d.illustrator,
    is_graphic_designer: !!d.graphic,
    is_scenarist: !!d.scenarist,
    is_sculptor: !!d.sculptor,
    is_composer: !!d.composer,
    is_translator: !!d.translator,
    is_publisher: !!d.editor,
    is_distributor: !!d.distributor,
    games_count: d.counts?.games ?? c.credits,
    awards_count: d.counts?.awards ?? 0,
    links: Object.fromEntries(SOCIALS.map((k) => [k, d[k] || null])),
    bio: stripHtml(d.description),
    photo: d.image?.S200 ?? null,
    updated_at: d.dateupdate ?? null,
    scraped_at: new Date().toISOString(),
  };
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

async function main() {
  const creators = args.ids
    ? String(args.ids).split(',').map((id) => ({ id: id.trim(), credits: 0 }))
    : loadCreators();
  const done = loadDone();
  const todo = creators.filter((c) => !done.has(c.id)).slice(0, LIMIT);
  console.log(`${creators.length} authors/illustrators, ${done.size} already fetched, ${todo.length} to do (concurrency ${CONCURRENCY})`);
  if (fs.existsSync(ERR_FILE)) fs.renameSync(ERR_FILE, `${ERR_FILE}.prev`);

  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });
  const errOut = fs.createWriteStream(ERR_FILE, { flags: 'a' });
  let idx = 0, ok = 0, failed = 0, missing = 0;
  const t0 = Date.now();

  async function worker() {
    while (idx < todo.length) {
      const c = todo[idx++];
      try {
        const d = await api('people', { type: 'people', id: c.id });
        if (!d?.id) { missing++; errOut.write(JSON.stringify({ ...c, error: 'missing' }) + '\n'); }
        else { out.write(JSON.stringify(buildRecord(c, d)) + '\n'); ok++; }
      } catch (e) {
        // give each failed person one more try at the end of the queue
        if (!c.retried) { todo.push({ ...c, retried: true }); continue; }
        failed++;
        errOut.write(JSON.stringify({ ...c, error: String(e.message ?? e) }) + '\n');
      }
      const n = ok + failed + missing;
      if (n % 100 === 0) {
        const rate = n / ((Date.now() - t0) / 1000);
        console.log(`[${new Date().toISOString()}] ${n}/${todo.length} ok=${ok} failed=${failed} missing=${missing} ${rate.toFixed(2)} people/s interval=${currentInterval()}ms ETA ${((todo.length - n) / rate / 3600).toFixed(1)}h`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await new Promise((r) => out.end(r));
  await new Promise((r) => errOut.end(r));
  console.log(`Done: ok=${ok} failed=${failed} missing=${missing} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

main().catch((e) => { console.error(e); process.exit(1); });
