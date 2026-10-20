// Reading JSON Lines files (plain or .gz) line by line, split on « \n » only.
// node:readline also ends a line at U+2028 / U+2029 (Node 24, the workflows' version), and some MyLudo
// descriptions contain them: read through readline, such a record came out as broken fragments, was reported
// unreadable and, in check.mjs, removed from the data (18 games on 20 October 2026).
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Every line of the file (the last one even without a final « \n »), with its number. */
export async function* lines(file) {
  let input = fs.createReadStream(file);
  if (file.endsWith('.gz')) input = input.pipe(zlib.createGunzip());
  input.setEncoding('utf8');
  let rest = '';
  let n = 0;
  for await (const chunk of input) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop();
    for (const line of parts) yield { n: ++n, line: line.endsWith('\r') ? line.slice(0, -1) : line };
  }
  if (rest) yield { n: ++n, line: rest.endsWith('\r') ? rest.slice(0, -1) : rest };
}
