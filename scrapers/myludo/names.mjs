#!/usr/bin/env node
// Split the display name of every MyLudo author/illustrator (data/myludo/people.jsonl)
// into title / first name / last name / suffix / pseudonym, and look for the real
// name of pseudonyms in their bio ("X, plus connu sous le nom de Naïade").
// MyLudo itself only stores one display name per person, so this is heuristic:
// anything ambiguous is flagged with needs_review + review_reason, never guessed silently.
//
// Output: data/myludo/people.json and people.csv. Re-runnable at any time (no network).
//
// Usage: node names.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Data folder: DATA_DIR (the data/ folder of the private data repository in CI), else <repo>/data.
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data'));
const DIR = path.join(DATA, 'myludo');

const PARTICLES = new Set(['de', 'du', 'des', 'del', 'della', 'delle', 'dei', 'di', 'da', 'das', 'do', 'dos', 'van', 'von', 'der', 'den', 'ter', 'ten', 'le', 'la', 'les', 'st', 'st.', 'saint', 'sainte', 'ben', 'bin', 'ibn', 'al', 'el', 'ar', 'zu', 'af', 'av', 'op', "d'", "l'", 'mc', 'mac']);
const SUFFIX = /^(jr\.?|sr\.?|i{2,3}|iv|v|vi|ph\.?d\.?|md|esq\.?)$/i;
const TITLE = /^(dr\.?|prof\.?|professor|sir|mr\.?|mrs\.?|ms\.?|me\.?|pr\.?)$/i;
const ORG = /\b(studios?|team|games?|gaming|collecti(f|ve)|atelier|[ée]ditions?|edizioni|verlag|agency|inc\.?|ltd\.?|llc|gmbh|sarl|sas|s\.?a\.?|ab|oy|bv|group|groupe|lab|labs|company|compagnie|association|club|cinema|entertainment|productions?|publishing|press|design|creative|illustrations?|graphics|art team|interactive|media|factory|workshop|soci[ée]t[ée]|\w+\.(com|net|fr|org))\b/i;
const GROUP = /\s(&|and|et|und|y|e)\s|,\s*\S+\s+\S+.*,|\s\/\s/i;
const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-ۿ฀-๿぀-ヿ㐀-鿿가-힯]/;

// How often each word is a first name vs a family name in plain two-word names
// ("Gary Smith"), learnt from the whole people list by setNameStats().
let FIRST = new Map();
let LAST = new Map();
export function setNameStats(names) {
  FIRST = new Map(); LAST = new Map();
  for (const n of names) {
    const toks = clean(n).split(' ');
    if (toks.length !== 2 || !toks.every((t) => /^\p{Lu}\p{Ll}[\p{L}'’-]*$/u.test(t))) continue;
    FIRST.set(toks[0], (FIRST.get(toks[0]) ?? 0) + 1);
    LAST.set(toks[1], (LAST.get(toks[1]) ?? 0) + 1);
  }
}
const mostlyFirst = (t) => (FIRST.get(t) ?? 0) >= 3 && (FIRST.get(t) ?? 0) > 2 * (LAST.get(t) ?? 0);
const mostlyLast = (t) => (LAST.get(t) ?? 0) >= 2 && (LAST.get(t) ?? 0) > (FIRST.get(t) ?? 0);

const isInitial = (t) => /^(\p{Lu}\.?-?)+$/u.test(t) && t.replace(/[.-]/g, '').length <= 3 && (t.includes('.') || t.length <= 2);
const isCapsWord = (t) => /^\p{Lu}[\p{Lu}'’-]{2,}$/u.test(t) && !SUFFIX.test(t);
// 2–4 capitalised words or initials, nothing that looks like a company: plausible "First Last".
const looksLikePersonName = (s) => {
  const toks = s.split(' ');
  return toks.length >= 2 && toks.length <= 4 && !ORG.test(s)
    && toks.every((t) => PARTICLES.has(t.toLowerCase()) || isInitial(t) || /^\p{Lu}[\p{L}'’-]+$/u.test(t));
};
const clean = (s) => s.replace(/[​-‍﻿]/g, '').replace(/[‐-‑]/g, '-').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();

// Split a plain "Title First Middle Last Suffix" person name (no quotes/parentheses).
function splitPersonName(full) {
  const r = { title: null, first_name: null, last_name: null, suffix: null, review: [] };
  // ", Jr." / ", III" / ", Ph.D." suffixes
  let s = full.replace(/,\s*((jr|sr)\.?|i{2,3}|iv|ph\.?\s?d\.?)$/i, (_, x) => { r.suffix = x; return ''; }).trim();
  if (s.includes(',')) {
    const [a, b] = s.split(',').map((x) => x.trim());
    r.review.push('virgule dans le nom');
    s = b && !b.includes(' ') && a ? `${a} ${b}` : s.replace(/,/g, ' ');
  }
  let toks = s.split(' ').filter(Boolean);
  while (toks.length > 1 && TITLE.test(toks[0])) r.title = [r.title, toks.shift()].filter(Boolean).join(' ');
  while (toks.length > 1 && SUFFIX.test(toks.at(-1))) r.suffix = [toks.pop(), r.suffix].filter(Boolean).join(' ');

  if (toks.length === 1) {
    // "G.desroches" → initial + surname
    const m = toks[0].match(/^(\p{L}\.)(\p{L}{2,})$/u);
    if (m) { r.first_name = m[1]; r.last_name = m[2][0].toUpperCase() + m[2].slice(1); return r; }
    r.last_name = null;
    return r;
  }

  // An all-caps word after the first one is the family name: "Fabrice ROS", "Maëlle MURSIC".
  const capsIdx = toks.findIndex((t, i) => i > 0 && isCapsWord(t));
  if (capsIdx > 0) {
    r.first_name = toks.slice(0, capsIdx).join(' ');
    r.last_name = toks.slice(capsIdx).join(' ');
    return r;
  }
  // Inverted "DUPONT Jean"
  if (isCapsWord(toks[0]) && toks[0].length >= 4 && toks.length === 2 && !isCapsWord(toks[1])) {
    r.first_name = toks[1]; r.last_name = toks[0]; r.review.push('nom en majuscules en tête, ordre inversé supposé');
    return r;
  }

  // First name = first token, plus any following initials ("Christopher F. Allen"),
  // or the next word too when the name starts with an initial ("J. Robert King").
  let i = 1;
  if (isInitial(toks[0]) && toks.length > 2 && !PARTICLES.has(toks[1].toLowerCase())) i = 2;
  while (i < toks.length - 1 && (isInitial(toks[i]) || mostlyFirst(toks[i]))) i++;
  // A particle starts the family name: "Clément De Ruyter", "Eric Ar Braz", "W. Van Meter".
  const pIdx = toks.findIndex((t, k) => k >= 1 && k < toks.length - 1 && PARTICLES.has(t.toLowerCase()));
  if (pIdx > 0 && pIdx <= i) i = pIdx;
  else if (pIdx > i) {
    r.review.push('plusieurs prénoms ou noms possibles');
    i = pIdx;
  }
  r.first_name = toks.slice(0, i).join(' ');
  r.last_name = toks.slice(i).join(' ');
  const lastWords = toks.slice(i).filter((t) => !PARTICLES.has(t.toLowerCase()));
  // Several family-name words left: fine when each is a known family name (Spanish double surname),
  // ambiguous otherwise ("Hannah Elizabeth Baker").
  if (pIdx < 0 && lastWords.length >= 2 && !lastWords.slice(0, -1).every(mostlyLast)) r.review.push('plusieurs prénoms ou noms possibles');
  return r;
}

// Real name of a pseudonym, from the bio. Returns null unless an explicit phrase links both.
function realNameFromBio(pseudo, bio) {
  if (!bio || !pseudo) return null;
  const P = pseudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const NAME = "(\\p{Lu}[\\p{L}'’.-]+(?:\\s+(?:(?:de|du|des|van|von|der|di|da|le|la)\\s+)?\\p{Lu}[\\p{L}'’.-]+){1,3})";
  const patterns = [
    `${NAME}\\s*,?\\s*(?:\\(|,)?\\s*(?:plus |mieux |aussi |également )?(?:connue?|surnommée?|dite?|appelée?)\\s+(?:sous le (?:nom|pseudo(?:nyme)?)(?: d'artiste)? (?:de |d['’])|sous |comme |par )?["«“ ]*${P}`,
    `${NAME}\\s*(?:\\(|,)?\\s*(?:alias|aka|a\\.k\\.a\\.?|dite?|signe|signant|sous le pseudo(?:nyme)?(?: de| d['’])?)\\s+["«“ ]*${P}`,
    `${P}["»” ]*\\s*(?:\\(|,)?\\s*(?:de son (?:vrai |véritable )?nom|né(?:e)? sous le nom de|nom de naissance|real name|born|whose real name is|alias de|pseudonyme de|est le pseudonyme de|est le nom d['’]artiste de|is the (?:pen|artist|stage) name of)\\s*:?\\s*${NAME}`,
    `(?:[Dd]e son (?:vrai |véritable )?nom|[Nn]é(?:e)? sous le nom de|[Bb]orn)\\s*:?\\s*${NAME}\\s*,\\s*["«“ ]*${P}`,
    `(?:[Dd]errière|[Ss]ous)\\s+(?:le pseudo(?:nyme)? |le nom )?(?:de |d['’])?["«“ ]*${P}["»” ]*,?\\s+se (?:cache|trouve)\\s+${NAME}`,
  ];
  for (const p of patterns) {
    const m = bio.match(new RegExp(p, 'u'));
    if (m) {
      const real = m[1].trim().replace(/[.,;:]+$/, '');
      if (real.toLowerCase() !== pseudo.toLowerCase() && !/^(Il|Elle|Son|Sa|Ses|Le|La|Les|Un|Une|He|She|The)\b/.test(real)) return real;
    }
  }
  return null;
}

export function analyzeName(rawName, bio = null) {
  const name = clean(rawName);
  const out = { name_type: 'person', title: null, first_name: null, last_name: null, suffix: null, pseudo: null, real_name: null, real_name_source: null, needs_review: false, review_reason: null };
  const review = [];
  let base = name;

  // Disambiguators MyLudo appends: "Kara (2)", "Steve Jackson (UK)".
  base = base.replace(/\s*\((\d+|[A-Z]{2,3})\)$/, '').trim();

  // Nickname in quotes: Laëtitia "Jalee" Jalabert, Quentin Dognon "Qenus", Lindsay 'Linz' Archer.
  const q = base.match(/^(.*?)\s*["“«]\s*([^"”»]+?)\s*["”»]\s*(.*)$/) || base.match(/^(.*?)\s+'([^']+)'\s*(.*)$/);
  if (q) {
    out.pseudo = q[2];
    base = clean(`${q[1]} ${q[3]}`);
  }
  // Parentheses: "Livia Varga (Noppa)" (pseudo) or "Yareyare (やれやれ)" (other script).
  const par = base.match(/^(.*?)\s*\(([^)]+)\)\s*(.*)$/);
  if (par) {
    const outside = clean(`${par[1]} ${par[3]}`);
    const inside = par[2].trim();
    if (NON_LATIN.test(inside) || NON_LATIN.test(outside)) { base = NON_LATIN.test(outside) ? inside : outside; review.push(`nom dans une autre écriture : ${NON_LATIN.test(outside) ? outside : inside}`); }
    else if (outside.split(' ').length >= 2 && inside.split(' ').length === 1) { out.pseudo ??= inside; base = outside; }
    else if (outside.split(' ').length === 1 && looksLikePersonName(inside)) { out.pseudo ??= outside; base = inside; out.real_name_source = 'name'; }
    else { base = outside; review.push(`mention entre parenthèses : ${inside}`); }
  }

  if (!base) {
    // only a pseudo in quotes: Amès "U Token 2 Me"
    out.name_type = 'pseudonym';
  } else if (ORG.test(base) && !out.pseudo) {
    out.name_type = 'organisation';
  } else if (GROUP.test(` ${base} `) || (base.includes(',') && base.split(',').every((p) => p.trim().split(' ').length >= 2))) {
    out.name_type = 'group';
    review.push('plusieurs personnes sous un seul nom');
  } else if (NON_LATIN.test(base)) {
    out.name_type = 'person';
    review.push("écriture non latine, découpage impossible");
  } else if (/^(the|la|le|les|l['’])\s/i.test(base)) {
    // "La Hyène Orange": an article is not a first name
    out.name_type = 'pseudonym';
    out.pseudo ??= base;
    review.push('commence par un article, pseudo ou collectif possible');
  } else if (!base.includes(' ') && !/^\p{L}\.\p{L}{2,}$/u.test(base)) {
    // a single word: pseudonym, or a family name credited alone
    out.name_type = 'pseudonym';
    out.pseudo ??= base;
    review.push('nom en un seul mot : pseudo probable, ou nom de famille seul');
  } else {
    const p = splitPersonName(base);
    Object.assign(out, { title: p.title, first_name: p.first_name, last_name: p.last_name, suffix: p.suffix });
    review.push(...p.review);
    if (out.real_name_source === 'name') out.real_name = base;
  }

  // Real name of a pseudonym: from the display name itself ("Laëtitia "Jalee" Jalabert"),
  // otherwise from an explicit phrase in the bio.
  if (out.pseudo && !out.real_name) {
    const real = out.first_name ? null : realNameFromBio(out.pseudo, bio);
    if (out.first_name) {
      out.real_name = [out.first_name, out.last_name].filter(Boolean).join(' ');
      out.real_name_source = 'name';
    } else if (real) {
      const p = splitPersonName(real);
      Object.assign(out, { real_name: real, real_name_source: 'bio', first_name: p.first_name, last_name: p.last_name });
      review.length = 0; // the bio settles it
    }
  }

  out.needs_review = review.length > 0;
  out.review_reason = review.length ? review.join(' ; ') : null;
  return out;
}

function main() {
  const raw = fs.readFileSync(path.join(DIR, 'people.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // learn first/last name frequencies from every credited person, not only those fetched so far
  const allNames = new Set(raw.map((p) => p.name));
  for (const line of fs.readFileSync(path.join(DIR, 'games.jsonl'), 'utf8').split('\n')) {
    if (line) for (const p of JSON.parse(line).people) allNames.add(p.name);
  }
  setNameStats(allNames);
  const people = raw.map((p) => ({ ...p, ...analyzeName(p.name, p.bio) }));
  const byId = new Map(people.map((p) => [p.id, p]));
  const list = [...byId.values()].sort((a, b) => b.games_count - a.games_count);
  fs.writeFileSync(path.join(DIR, 'people.json'), JSON.stringify(list, null, 1));

  const join = (a) => (Array.isArray(a) ? a.join(' | ') : '');
  const cols = {
    id: (p) => p.id, name: (p) => p.name, name_type: (p) => p.name_type,
    title: (p) => p.title, first_name: (p) => p.first_name, last_name: (p) => p.last_name, suffix: (p) => p.suffix,
    pseudo: (p) => p.pseudo, real_name: (p) => p.real_name, real_name_source: (p) => p.real_name_source,
    needs_review: (p) => (p.needs_review ? 'oui' : ''), review_reason: (p) => p.review_reason,
    gender: (p) => p.gender, roles: (p) => join(p.roles), games_count: (p) => p.games_count, awards_count: (p) => p.awards_count,
    site: (p) => p.links.site, facebook: (p) => p.links.facebook, instagram: (p) => p.links.instagram, twitter: (p) => p.links.twitter,
    bluesky: (p) => p.links.bluesky, youtube: (p) => p.links.youtube, twitch: (p) => p.links.twitch, tiktok: (p) => p.links.tiktok, discord: (p) => p.links.discord,
    url: (p) => p.url, photo: (p) => p.photo, bio: (p) => p.bio,
  };
  const esc = (v) => (v == null ? '' : /[",\n\r;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [Object.keys(cols).join(','), ...list.map((p) => Object.values(cols).map((f) => esc(f(p))).join(','))];
  fs.writeFileSync(path.join(DIR, 'people.csv'), '﻿' + rows.join('\n'));

  const count = (f) => list.filter(f).length;
  console.log(`Exported ${list.length} people to ${DIR}/people.json and people.csv`);
  console.log(`  types: ${Object.entries(list.reduce((a, p) => ((a[p.name_type] = (a[p.name_type] ?? 0) + 1), a), {})).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  pseudo=${count((p) => p.pseudo)} real_name_from_bio=${count((p) => p.real_name_source === 'bio')} needs_review=${count((p) => p.needs_review)}`);
  console.log(`  with at least one link=${count((p) => Object.values(p.links).some(Boolean))}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
