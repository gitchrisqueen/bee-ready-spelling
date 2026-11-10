// My words: share links (list id, packing, caps and the id format check).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { SALT } from '../mine/salt.js';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';
import {
  buildShareUrl, canonicalWords, idMatches, listId, packWords, parseShareLocation, registryPath, toBase64Url, unpackWords,
} from '../mine/share.js';
import { LIMITS, LIST_ID_RE } from '../mine/validate.js';

const root = resolve(import.meta.dirname, '..');
before(() => setBlocklist(parseBlocklist(readFileSync(join(root, 'mine/filter.sha256'), 'utf8'))));

test('the list id is 22 base64url characters of SHA-256(salt + sorted unique lowercase words)', () => {
  const words = ['Banana', 'apple', 'cherry', 'apple'];
  const expected = createHash('sha256').update(`${SALT}\napple\nbanana\ncherry`).digest().subarray(0, 16).toString('base64url');
  assert.equal(listId(words), expected);
  assert.match(listId(words), LIST_ID_RE);
  assert.equal(listId(['cherry', 'banana', 'APPLE']), expected, 'order and case do not matter');
  assert.notEqual(listId(['apple', 'banana']), expected);
  assert.deepEqual(canonicalWords(['b', 'a', 'B', 'é']), ['a', 'b', 'é']);
});

test('words pack into a fragment and unpack to the same list', async () => {
  const words = ['apple', 'banana', 'cherry', "o'clock", 'pre-school', 'étude'];
  const packed = await packWords(words);
  assert.match(packed, /^[pz][A-Za-z0-9_-]+$/);
  const out = await unpackWords(packed);
  assert.deepEqual(out.words, canonicalWords(words));
  assert.ok(idMatches(listId(words), out.words));
  assert.equal(idMatches(listId(['apple']), out.words), false, 'a link whose words do not match its id is rejected');
});

test('a full list fits in the fragment cap', async () => {
  const words = Array.from({ length: LIMITS.words }, (_, i) => `${'abcdefghij'[i % 10]}${'xyz'.repeat(1 + (i % 4))}${'lmnop'[i % 5]}${'q'.repeat(1 + Math.floor(i / 10))}`);
  const packed = await packWords(words);
  assert.ok(packed.length <= LIMITS.fragment, `${packed.length} characters`);
  assert.equal((await unpackWords(packed)).words.length, new Set(words).size);
});

test('caps: an over-long fragment, a decompression bomb and garbage are refused', async () => {
  assert.deepEqual(await unpackWords(`p${'A'.repeat(LIMITS.fragment)}`), { error: 'too-long' });
  const bomb = `z${toBase64Url(deflateRawSync(Buffer.alloc(5_000_000)))}`;
  assert.ok(bomb.length < LIMITS.fragment, 'the bomb is small on the wire');
  assert.ok((await unpackWords(bomb)).error, 'inflating stops at the 16 KB cap');
  assert.ok((await unpackWords('zNOT-DEFLATE')).error);
  assert.ok((await unpackWords('p***')).error);
  assert.ok((await unpackWords('x1234')).error);
  assert.ok((await unpackWords('')).error);
  assert.ok((await unpackWords(null)).error);
});

test('unpacked words go through the same validation as typed words', async () => {
  const plain = `p${toBase64Url(new TextEncoder().encode('good\n<b>bad</b>\nab3d\nfine'))}`;
  assert.deepEqual((await unpackWords(plain)).words, ['good', 'fine']);
});

test('the l value must be exactly 22 base64url characters before any use', () => {
  const ok = 'A'.repeat(22);
  assert.deepEqual(parseShareLocation(`?mode=mine&l=${ok}`, '#w=pYWJj'), { id: ok, packed: 'pYWJj' });
  assert.deepEqual(parseShareLocation(`?mode=mine&l=${ok}`, ''), { id: ok, packed: null });
  for (const bad of ['../x', 'a%2Fb', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}.`]) {
    assert.equal(parseShareLocation(`?mode=mine&l=${bad}`, ''), null, bad);
    assert.equal(parseShareLocation(`?mode=mine&l=${bad}`, '#w=pYWJj').id, null, bad);
    assert.equal(registryPath(bad), null, 'no registry request is built from it');
    assert.equal(idMatches(bad, ['apple']), false);
  }
  assert.equal(registryPath(ok), `./lists/${ok}.json`);
  assert.equal(parseShareLocation('?mode=mine', ''), null);
});

test('buildShareUrl puts the words in the fragment and only the id in the query', async () => {
  const url = new URL(await buildShareUrl('https://example.github.io/bee-ready-spelling/', ['apple', 'banana']));
  assert.equal(url.searchParams.get('mode'), 'mine');
  assert.equal(url.searchParams.get('l'), listId(['apple', 'banana']));
  assert.ok(url.hash.startsWith('#w='));
  assert.equal(url.search.includes('apple'), false, 'the query string (which the server sees) has no words');
  assert.equal(url.pathname, '/bee-ready-spelling/');
});
