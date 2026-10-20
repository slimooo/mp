// node --test scrapers/: the JSON Lines readers keep records whose text holds U+2028 / U+2029 (Node 24's
// node:readline cut them into fragments, and check.mjs removed them as unreadable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { lines } from './jsonl.mjs';
import { readJsonl } from './shop-match/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const withSeparators = { id: '57181', description: `Cinq batailles sont proposées :${LS}Andrassos 960${PS}Sayf al-Dawla` };
const plain = { id: '4680', description: 'Sept merveilles' };

function tmpFile(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-jsonl-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, name.endsWith('.gz') ? zlib.gzipSync(text) : text);
  return file;
}

test('lines: split on \\n only, CRLF and a missing final newline handled', async () => {
  const file = tmpFile('a.jsonl', `${JSON.stringify(withSeparators)}\r\n${JSON.stringify(plain)}`);
  const got = [];
  for await (const l of lines(file)) got.push(l);
  assert.deepEqual(got.map((l) => l.n), [1, 2]);
  assert.deepEqual(JSON.parse(got[0].line), withSeparators);
  assert.deepEqual(JSON.parse(got[1].line), plain);
});

test('readJsonl (matching): a record holding U+2028 / U+2029 is read whole, plain or gzipped', async () => {
  for (const name of ['b.jsonl', 'b.jsonl.gz']) {
    const file = tmpFile(name, `${JSON.stringify(withSeparators)}\n${JSON.stringify(plain)}\n`);
    const got = [];
    for await (const r of readJsonl(file)) got.push(r);
    assert.deepEqual(got, [withSeparators, plain], name);
  }
});

test('check.mjs keeps a record holding U+2028 / U+2029 and removes only a truly broken line', () => {
  const file = tmpFile('games.jsonl', `${JSON.stringify(withSeparators)}\n{"id":"1","title":"cut\n${JSON.stringify(plain)}\n`);
  let code = 0;
  try {
    execFileSync(process.execPath, [path.join(here, 'myludo', 'check.mjs'), file], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 1, 'a removed line marks the step as failed');
  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(kept, [withSeparators, plain]);
});
