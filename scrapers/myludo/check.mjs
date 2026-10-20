// Checks the JSON Lines files the MyLudo scrapers append to (games.jsonl, people.jsonl) before they are sliced
// and versioned: every line must parse. An unreadable line is removed and printed (its start) for diagnosis; the
// record it held is simply scraped again next time, since it is no longer in the file. Without this, one bad line
// stopped every reader (matching, import) and, once versioned, every following run. Lines end at « \n » only
// (jsonl.mjs): node:readline would also cut at U+2028 / U+2029 inside descriptions and remove valid records.
// Usage: node scrapers/myludo/check.mjs <file.jsonl> [<file.jsonl>…]   (a missing file is skipped)
import fs from 'node:fs';
import { lines } from '../jsonl.mjs';

let failed = false;
for (const file of process.argv.slice(2)) {
  if (!fs.existsSync(file)) continue;
  if (file.endsWith('.gz')) {
    console.error(`${file} : fichier compressé, à vérifier décompressé.`);
    failed = true;
    continue;
  }
  const tmp = `${file}.check`;
  const out = fs.createWriteStream(tmp);
  let kept = 0;
  let bad = 0;
  for await (const { n, line } of lines(file)) {
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
    } catch (e) {
      bad++;
      console.error(`${file} : ligne ${n} illisible, retirée (${String(e.message).split('\n')[0]}) : ${line.slice(0, 200)}`);
      continue;
    }
    kept++;
    if (!out.write(`${line}\n`)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((r) => out.end(r));
  if (bad) {
    fs.renameSync(tmp, file);
    console.log(`${file} : ${kept} lignes gardées, ${bad} retirée(s).`);
    failed = true;
  } else {
    fs.unlinkSync(tmp);
    console.log(`${file} : ${kept} lignes, toutes lisibles.`);
  }
}
// Non-zero so the step shows red in the workflow (the file is clean, but something produced a bad line).
process.exit(failed ? 1 : 0);
