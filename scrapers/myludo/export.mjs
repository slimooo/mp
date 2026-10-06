#!/usr/bin/env node
// Convert data/myludo/games.jsonl into games.csv (one flat row per game; lists joined with " | ")
// and game_people.csv; with --json, also games.json (full records, several hundred MB).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data'));
const DIR = path.join(DATA, 'myludo');
const games = new Map();
for (const line of fs.readFileSync(path.join(DIR, 'games.jsonl'), 'utf8').split('\n')) {
  if (!line) continue;
  try { const g = JSON.parse(line); games.set(g.id, g); } catch {}
}
const list = [...games.values()].sort((a, b) => Number(a.id) - Number(b.id));
if (process.argv.includes('--json')) fs.writeFileSync(path.join(DIR, 'games.json'), JSON.stringify(list, null, 1));

const join = (a) => (Array.isArray(a) ? a.join(' | ') : '');
const cols = {
  id: (g) => g.id, title: (g) => g.title, subtitle: (g) => g.subtitle, url: (g) => g.url, type: (g) => g.type,
  edition: (g) => g.edition, release_date: (g) => g.release_date, languages: (g) => join(g.languages),
  players_min: (g) => g.players_min, players_max: (g) => g.players_max, age_min: (g) => g.age_min, age_max: (g) => g.age_max,
  duration_min: (g) => g.duration_min, duration_max: (g) => g.duration_max,
  categories: (g) => join(g.categories), themes: (g) => join(g.themes), mechanics: (g) => join(g.mechanics), ranges: (g) => join(g.ranges),
  authors: (g) => join(g.authors), illustrators: (g) => join(g.illustrators), publishers: (g) => join(g.publishers),
  community_note: (g) => g.ratings.community_note, community_votes: (g) => g.ratings.community_votes,
  complexity_note: (g) => g.ratings.complexity_note, complexity_votes: (g) => g.ratings.complexity_votes,
  best_players: (g) => g.community.best_players, in_collections: (g) => g.stats.in_collections, plays: (g) => g.stats.plays,
  price_eur: (g) => g.price_eur, barcodes: (g) => join(g.barcodes),
  awards: (g) => join(g.awards.map((a) => `${a.award} ${a.category ?? ''} ${a.year ?? ''}`.trim())),
  description: (g) => g.description, cover: (g) => g.cover,
  images: (g) => join(g.images.map((i) => i.url)), videos: (g) => join(g.videos.map((v) => v.youtube_url)),
  files: (g) => join(g.files.map((f) => `${f.title} <${f.page_url}>`)),
};
const esc = (v) => (v == null ? '' : /[",\n\r;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const rows = [Object.keys(cols).join(','), ...list.map((g) => Object.values(cols).map((f) => esc(f(g))).join(','))];
fs.writeFileSync(path.join(DIR, 'games.csv'), '﻿' + rows.join('\n'));

// Link table game ↔ person (one row per role), joinable on people.csv `id`.
const links = ['game_id,game_title,person_id,person_name,role'];
for (const g of list) {
  for (const p of g.people ?? []) {
    for (const role of p.roles?.length ? p.roles : ['']) links.push([g.id, g.title, p.id, p.name, role].map(esc).join(','));
  }
}
fs.writeFileSync(path.join(DIR, 'game_people.csv'), '﻿' + links.join('\n'));
console.log(`Exported ${list.length} games to games.csv and game_people.csv (${links.length - 1} links)`);
