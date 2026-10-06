// Helpers shared by match.mjs and consolidate.mjs.
import fs from 'node:fs';
import readline from 'node:readline';
import zlib from 'node:zlib';

// ---------- mee.plus selection (copy of meeplus-next scripts/myludo/common.ts) ----------
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const KEPT_TYPES = new Set(['basegame', 'extension', 'standalone']);
export function filterOut(r) {
  if (r.crowdfunding !== false) return 'financement participatif';
  if (!KEPT_TYPES.has(r.type)) return `type ${r.type}`;
  if (r.print_and_play === true) return 'print and play';
  if (!r.authors?.some((a) => a?.trim())) return 'sans auteur';
  if (!r.languages?.some((l) => norm(l) === 'francais')) return 'pas en français';
  if (!r.publishers?.some((p) => p?.trim())) return 'sans éditeur';
  return null;
}

/** GTIN-14 form of an EAN/UPC/ISBN-13 code, or null if it is not one. */
export function gtin(code) {
  const d = String(code ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return null;
  return d.padStart(14, '0');
}

export async function* readJsonl(file) {
  let input = fs.createReadStream(file);
  if (file.endsWith('.gz')) input = input.pipe(zlib.createGunzip());
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line);
}

/** Similarity of two titles (0–1), from their character bigrams (Dice coefficient). */
export function similarity(a, b) {
  const grams = (s) => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) ?? 0) + 1); return g; };
  const [ga, gb] = [grams(a), grams(b)];
  let common = 0;
  for (const [k, n] of ga) common += Math.min(n, gb.get(k) ?? 0);
  const total = Math.max(0, a.length - 1) + Math.max(0, b.length - 1);
  return total ? (2 * common) / total : a === b ? 1 : 0;
}
/** "ok" when a shop product name looks like the game title, else "à vérifier" (same code, different-looking game). */
export function titleCheck(title, names) {
  const t = norm(title);
  return names.some((n) => { const p = norm(n); return p.includes(t) || t.includes(p) || similarity(t, p) >= 0.5; }) ? 'ok' : 'à vérifier';
}

export const csvCell = (v) => {
  const s = Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

