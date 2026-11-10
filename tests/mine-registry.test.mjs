// My words: published lists (lists/<id>.json), the publish tool, and the extra-word-list parser for the library.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';
import { sha256Hex } from '../mine/sha256.js';
import { buildRegistryEntry, loadRegistryList } from '../mine/registry.js';
import { listId } from '../mine/share.js';
import { LIMITS } from '../mine/validate.js';
import { parseExtraWords } from '../tools/library/wordlist.mjs';

const root = resolve(import.meta.dirname, '..');
const TOKEN = 'zzqblocked';
const real = () => parseBlocklist(readFileSync(join(root, 'mine/filter.sha256'), 'utf8'));
before(() => setBlocklist([...real(), sha256Hex(TOKEN)]));

const WORDS = ['elephant', 'giraffe', 'penguin'];
const ID = listId(WORDS);
// A fetch stand-in: records every request and answers with the body for the one path it knows.
function fakeFetch(files) {
  const calls = [];
  const fn = async (path, options) => {
    calls.push({ path, options });
    if (!(path in files)) return { ok: false, status: 404, text: async () => '' };
    const body = files[path];
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, text: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const file = (id, data) => ({ [`./lists/${id}.json`]: typeof data === 'string' ? data : JSON.stringify(data) });

test('a published list loads, with the request made to this site only and without credentials or a referrer', async () => {
  const { id, text } = buildRegistryEntry('Sample list: animals', WORDS);
  assert.equal(id, ID);
  const f = fakeFetch(file(id, text));
  const list = await loadRegistryList(f, id);
  assert.deepEqual(list, { name: 'Sample list: animals', words: ['elephant', 'giraffe', 'penguin'] });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, `./lists/${id}.json`);
  assert.deepEqual(f.calls[0].options, { credentials: 'omit', referrerPolicy: 'no-referrer' });
});

test('an id that is not 22 URL-safe characters requests nothing', async () => {
  const stem = ID.slice(0, 21);
  for (const bad of ['', 'short', `${ID}x`, '../../../etc/passwd/aaaaaaa', `${stem}/`, `${stem}.`, null, undefined]) {
    const f = fakeFetch({});
    assert.equal(await loadRegistryList(f, bad), null, String(bad));
    assert.equal(f.calls.length, 0, `no request for ${String(bad)}`);
  }
});

test('a missing file, a failed fetch and a body that is not JSON all give null', async () => {
  assert.equal(await loadRegistryList(fakeFetch({}), ID), null);
  assert.equal(await loadRegistryList(fakeFetch(file(ID, new Error('offline'))), ID), null);
  assert.equal(await loadRegistryList(fakeFetch(file(ID, '<html>404</html>')), ID), null);
});

test('a file whose words do not hash to the id in the link is refused', async () => {
  const other = buildRegistryEntry('Other', ['apple', 'pear']);
  assert.equal(await loadRegistryList(fakeFetch(file(ID, other.text)), ID), null);
  const extra = { name: 'x', words: [...WORDS, 'zebra'] };
  assert.equal(await loadRegistryList(fakeFetch(file(ID, extra)), ID), null);
});

test('a file with a word the filter blocks, a bad word or a non-string is refused', async () => {
  for (const words of [[...WORDS, TOKEN], [...WORDS, 'no good'], [...WORDS, 7], [...WORDS, '<b>x</b>']]) {
    const id = listId(words.filter(w => typeof w === 'string'));
    assert.equal(await loadRegistryList(fakeFetch(file(id, { name: 'x', words })), id), null, JSON.stringify(words));
  }
});

test('a file with the wrong shape, forbidden keys or too much text is refused', async () => {
  for (const body of ['[]', '"x"', 'null', '{"name":"x"}', '{"name":"x","words":"a b"}',
    '{"name":"x","words":["elephant","giraffe","penguin"],"__proto__":{"a":1}}',
    '{"name":"x","words":["elephant","giraffe","penguin"],"constructor":{"a":1}}']) {
    assert.equal(await loadRegistryList(fakeFetch(file(ID, body)), ID), null, body);
  }
  const letters = 'abcdefghij';
  const tooMany = Array.from({ length: LIMITS.words + 1 }, (_, i) => (
    `word${letters[i % 10]}${letters[Math.floor(i / 10) % 10]}${letters[Math.floor(i / 100)]}`));
  assert.equal(await loadRegistryList(fakeFetch(file(ID, { name: 'x', words: tooMany })), ID), null);
  assert.equal(await loadRegistryList(fakeFetch(file(ID, ' '.repeat(LIMITS.unpacked + 1))), ID), null);
});

test('a list name with markup or a link is replaced by a plain one; the words still load', async () => {
  const body = { name: '<img src=x onerror=alert(1)>', words: WORDS };
  assert.deepEqual(await loadRegistryList(fakeFetch(file(ID, body)), ID), { name: 'Published list', words: WORDS });
  const link = { name: 'see https://example.com', words: WORDS };
  assert.equal((await loadRegistryList(fakeFetch(file(ID, link)), ID)).name, 'Published list');
});

test('buildRegistryEntry sorts and de-duplicates, and refuses blocked or invalid words and a bad name', () => {
  const { id, text } = buildRegistryEntry('Mixed', ['Penguin', 'elephant', 'giraffe', 'elephant']);
  assert.equal(id, ID);
  assert.deepEqual(JSON.parse(text), { name: 'Mixed', words: ['elephant', 'giraffe', 'penguin'] });
  assert.ok(text.endsWith('}\n'));
  assert.throws(() => buildRegistryEntry('x', ['apple', TOKEN]), /not allowed/);
  assert.throws(() => buildRegistryEntry('x', ['apple', 'a1b']), /not allowed/);
  assert.throws(() => buildRegistryEntry('x', []), /not allowed/);
  assert.throws(() => buildRegistryEntry('<b>', ['apple']), /name/);
});

test('every file in lists/ is a valid published list that answers only to its own file name', async () => {
  let dir = [];
  try { dir = readdirSync(join(root, 'lists')); } catch { /* no lists yet */ }
  assert.ok(dir.length > 0, 'lists/ holds at least the sample list');
  for (const name of dir) {
    assert.match(name, /^[A-Za-z0-9_-]{22}\.json$/, `${name} is named like a list id`);
    const id = name.slice(0, -5);
    const body = readFileSync(join(root, 'lists', name), 'utf8');
    const list = await loadRegistryList(fakeFetch(file(id, body)), id);
    assert.ok(list, `${name} loads`);
    assert.equal(body, buildRegistryEntry(list.name, list.words).text, `${name} is in the form the tool writes`);
  }
});

test('the publish tool writes lists/<id>.json and refuses a blocked word without writing anything', () => {
  const out = mkdtempSync(join(tmpdir(), 'bee-lists-'));
  try {
    const tool = join(root, 'tools/library/publish-list.mjs');
    const run = args => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
    const ok = run(['--name', 'Sample list: animals', '--words', WORDS.join(','), '--out', out]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(readdirSync(out), [`${ID}.json`]);
    assert.match(ok.stdout, new RegExp(`\\?mode=mine&l=${ID}`));
    assert.equal(readFileSync(join(out, `${ID}.json`), 'utf8'), buildRegistryEntry('Sample list: animals', WORDS).text);
    const bad = run(['--name', 'x', '--words', 'apple,a1b', '--out', join(out, 'none')]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /not allowed/);
    assert.deepEqual(readdirSync(out), [`${ID}.json`], 'nothing written for the refused list');
    assert.notEqual(run(['--name', 'x']).status, 0, 'usage error without words');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('an extra word list needs a source and a licence, keeps only plain lowercase words, and de-duplicates', () => {
  const text = ['# source: A teacher-owned list', '# licence: CC0 1.0', '', 'Apple, pear; kiwi', 'pear x 3d plum',
    '# a note', 'fig'].join('\n');
  const { header, words } = parseExtraWords(text);
  assert.deepEqual(header, { source: 'A teacher-owned list', licence: 'CC0 1.0' });
  assert.deepEqual(words, ['apple', 'pear', 'kiwi', 'plum', 'fig']);
  assert.throws(() => parseExtraWords('apple\npear'), /source/);
  assert.throws(() => parseExtraWords('# source: x\napple'), /licence/);
  assert.equal(parseExtraWords('# source: x\n# license: y\n').words.length, 0);
});
