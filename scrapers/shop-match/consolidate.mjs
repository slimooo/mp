#!/usr/bin/env node
// One file for the mee.plus sheets found in the shops: one line per mee.plus sheet (re-editions merged
// like MeePlus/meeplus-next scripts/import-myludo.ts `reeditions`), with the product URLs and pictures of
// every shop that sells one of its editions.
//
// Unlike match.mjs (each shop only searched for what the previous ones had not found), every sheet is
// matched against every shop here, so a sheet gets the links and pictures of all the shops that sell it.
// Same rule: an edition is linked to a product only when one of its EAN/ISBN is identical to the product's
// barcode, and the link is kept only when the titles agree (titleCheck "ok").
//
// The editions flagged "à vérifier" in data/<shop>/meeplus-<shop>.jsonl.gz (the 157 games of
// exports/liens-ean-a-valider.xlsx) are left as they are: their codes are not used here until they are
// validated. Their sheet still gets the links found through its other editions (e.g. Pickomino).
//
// Input:  data/myludo/games.jsonl.gz, data/<shop>/products.jsonl(.gz), data/<shop>/meeplus-<shop>.jsonl.gz
// Output: data/shops/meeplus-boutiques.jsonl.gz, data/shops/meeplus-boutiques.csv.gz (lists joined with " | ")
//
// Usage: node consolidate.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { csvCell, filterOut, gtin, norm, readJsonl, titleCheck } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(__dirname, '../../data'));
const SHOPS = [
  { key: 'playin', label: 'Play-In' },
  { key: 'ludum', label: 'Ludum' },
  { key: 'philibert', label: 'Philibert' },
];
const OUT_DIR = path.join(DATA, 'shops');

// ---------- re-editions (copy of meeplus-next scripts/import-myludo.ts) ----------
const MONTHS = { janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11 };
function releaseDate(r) {
  const m = r.release_date ? /^(\d{1,2})(?:er)?\s+(\S+)\s+(\d{4})$/.exec(String(r.release_date).trim()) : null;
  if (m && norm(m[2]) in MONTHS) return Date.UTC(Number(m[3]), MONTHS[norm(m[2])], Number(m[1]));
  const year = r.release_date ? /\b(\d{4})\b/.exec(String(r.release_date))?.[1] : null;
  if (year) return Date.UTC(Number(year), 0, 1);
  return r.edition ? Date.UTC(Number(r.edition), 0, 1) : null;
}
const cleanTitle = (r) => {
  const t = r.title.trim().replace(/\s{2,}/g, ' ');
  return (r.subtitle?.trim() ? `${t} : ${r.subtitle.trim()}` : t).slice(0, 160).trim();
};
function reeditions(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const key = `${r.type === 'extension' ? 'x' : 'g'}|${norm(cleanTitle(r))}`;
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  const groups = [];
  for (const bucket of buckets.values()) {
    const parent = bucket.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    const byAuthor = new Map();
    bucket.forEach((r, i) => {
      for (const a of (r.authors ?? []).map(norm).filter(Boolean)) {
        const j = byAuthor.get(a);
        if (j === undefined) byAuthor.set(a, i);
        else parent[root(i)] = root(j);
      }
    });
    const byRoot = new Map();
    bucket.forEach((r, i) => byRoot.set(root(i), [...(byRoot.get(root(i)) ?? []), r]));
    groups.push(...byRoot.values());
  }
  const when = (r) => releaseDate(r) ?? -Infinity;
  return groups.map((g) => g.sort((a, b) => when(b) - when(a) || Number(b.id) - Number(a.id)));
}

const barcodesOf = (r) => (Array.isArray(r.barcodes) ? r.barcodes.filter(Boolean) : []);

async function main() {
  // mee.plus editions
  const editions = [];
  for await (const r of readJsonl(path.join(DATA, 'myludo/games.jsonl.gz'))) if (!filterOut(r)) editions.push(r);

  // editions flagged "à vérifier" in any shop (left out with their whole sheet)
  const flagged = new Set();
  for (const { key } of SHOPS) {
    for await (const r of readJsonl(path.join(DATA, key, `meeplus-${key}.jsonl.gz`))) if (r[`${key}_title_check`] === 'à vérifier') flagged.add(r.ml_id);
  }

  // shop products by GTIN-14
  const byGtin = {};
  for (const { key, label } of SHOPS) {
    const dir = path.join(DATA, key);
    const file = [path.join(dir, 'products.jsonl'), path.join(dir, 'products.jsonl.gz')].find((f) => fs.existsSync(f));
    byGtin[key] = new Map();
    let n = 0;
    for await (const p of readJsonl(file)) {
      n++;
      for (const code of new Set([gtin(p.barcode), gtin(p.gtin14)].filter(Boolean))) {
        if (!byGtin[key].has(code)) byGtin[key].set(code, []);
        byGtin[key].get(code).push(p);
      }
    }
    console.log(`${label} : ${n} fiches produit lues`);
  }

  const sheets = reeditions(editions);
  const rows = [];
  let withFlagged = 0;
  for (const group of sheets) {
    if (group.some((r) => flagged.has(r.id))) withFlagged++;
    const primary = group[0];
    const row = {
      source_ref: `myludo:${primary.id}`,
      source_refs: group.map((r) => `myludo:${r.id}`),
      title: cleanTitle(primary),
      type: primary.type,
      editions: group.length,
      editions_a_verifier: group.filter((r) => flagged.has(r.id)).map((r) => `myludo:${r.id}`),
      isbns: [...new Set(group.flatMap(barcodesOf))],
      shops: 0,
    };
    for (const { key } of SHOPS) {
      const products = [];
      for (const r of group) {
        if (flagged.has(r.id)) continue;
        for (const code of new Set(barcodesOf(r).map(gtin).filter(Boolean))) {
          for (const p of byGtin[key].get(code) ?? []) {
            if (titleCheck(r.title, [p.name]) === 'ok' && !products.some((x) => x.id === p.id)) products.push(p);
          }
        }
      }
      row[`${key}_present`] = products.length ? 'oui' : 'non';
      row[`${key}_urls`] = products.map((p) => p.url);
      row[`${key}_images`] = [...new Set(products.flatMap((p) => p.images ?? []))];
      if (key === 'playin') row.playin_rules_pdf = [...new Set(products.flatMap((p) => (p.rules ?? []).map((x) => x.url)))];
      if (products.length) row.shops++;
    }
    if (row.shops) rows.push(row);
  }
  rows.sort((a, b) => a.title.localeCompare(b.title, 'fr'));

  console.log(`Fiches mee.plus : ${sheets.length} (${editions.length} éditions) · avec une édition à vérifier (non utilisée) : ${withFlagged}`);
  console.log(`Fiches trouvées dans au moins une boutique : ${rows.length} · dans 1 / 2 / 3 boutiques : ${[1, 2, 3].map((n) => rows.filter((r) => r.shops === n).length).join(' / ')}`);
  for (const { key, label } of SHOPS) console.log(`  ${label} : ${rows.filter((r) => r[`${key}_present`] === 'oui').length} fiches`);
  console.log(`  Images : ${rows.reduce((n, r) => n + SHOPS.reduce((m, { key }) => m + r[`${key}_images`].length, 0), 0)} liens · règles PDF Play-In : ${rows.filter((r) => r.playin_rules_pdf.length).length} fiches`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const gzWrite = (file, text) => fs.writeFileSync(path.join(OUT_DIR, file), zlib.gzipSync(text, { level: 9 }));
  gzWrite('meeplus-boutiques.jsonl.gz', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const cols = Object.keys(rows[0]);
  gzWrite('meeplus-boutiques.csv.gz', '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n');
  console.log('Écrit : data/shops/{meeplus-boutiques.jsonl.gz, meeplus-boutiques.csv.gz}');
}

main().catch((e) => { console.error(e); process.exit(1); });
