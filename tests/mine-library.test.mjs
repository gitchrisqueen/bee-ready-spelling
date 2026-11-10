// Checks the generated static library (library/*.json), its notice, its pinned sources and the filter hash file.
// The real filter list is loaded from mine/filter.sha256, so a shard is held to the same rules as the page applies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isBlockedWord, parseBlocklist, setBlocklist } from '../mine/filter.js';
import { LIMITS, PARTS, cleanSourceField, sentenceHasWordOnce } from '../mine/validate.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const SHARD_MAX = 150000;
const TOTAL_MAX = 3000000;
const FIELDS = new Set(['part', 'definition', 'group', 'sentence']);

const filterText = read('mine/filter.sha256');
const hashes = parseBlocklist(filterText);
setBlocklist(hashes);

const sources = JSON.parse(read('tools/library/sources.json'));
const shards = Object.fromEntries(LETTERS.map(l => [l, JSON.parse(read(`library/${l}.json`))]));

test('mine/filter.sha256 holds only comments and SHA-256 hashes, sorted and unique', () => {
  assert.ok(hashes.length >= 100, `only ${hashes.length} hashes`);
  for (const line of filterText.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    assert.match(line, /^[0-9a-f]{64}$/, 'a line that is neither a comment nor a hash');
  }
  assert.deepEqual(hashes, [...new Set(hashes)].sort());
});

test('mine/FILTER-NOTICE.md exists and names the source and licence', () => {
  const notice = read('mine/FILTER-NOTICE.md');
  assert.match(notice, /CC BY 4\.0/);
  assert.match(notice, /LDNOOBW/);
  assert.match(notice, /build-filter\.mjs/);
});

test('tools/library/sources.json pins every input with a size and a SHA-256', () => {
  assert.ok(Array.isArray(sources.inputs) && sources.inputs.length >= 3);
  const ids = new Set();
  for (const input of sources.inputs) {
    assert.ok(input.id && !ids.has(input.id), 'each input has a unique id');
    ids.add(input.id);
    assert.match(input.sha256, /^[0-9a-f]{64}$/, `${input.name}: sha256`);
    assert.ok(Number.isInteger(input.bytes) && input.bytes > 0, `${input.name}: bytes`);
    assert.match(input.url, /^https:\/\//, `${input.name}: url`);
    assert.ok(input.name && input.licence && input.licenceUrl && input.file && input.measured, `${input.name}: fields`);
  }
});

test('library/ holds exactly a.json to z.json and NOTICE.md', () => {
  const expected = [...LETTERS.map(l => `${l}.json`), 'NOTICE.md'].sort();
  assert.deepEqual(readdirSync(new URL('../library/', import.meta.url)).sort(), expected);
});

test('every shard is a plain object of lowercase words that start with the shard letter', () => {
  for (const [letter, shard] of Object.entries(shards)) {
    assert.ok(shard !== null && typeof shard === 'object' && !Array.isArray(shard), `${letter}.json is not an object`);
    assert.equal(Object.getPrototypeOf(shard), Object.prototype);
    const keys = Object.keys(shard);
    assert.deepEqual(keys, [...keys].sort(), `${letter}.json keys are not sorted`);
    for (const word of keys) {
      assert.match(word, /^[a-z]{2,40}$/, `bad key in ${letter}.json`);
      assert.ok(word.startsWith(letter), `"${word}" is in the wrong shard (${letter}.json)`);
    }
  }
});

test('every entry passes the same checks as mine/validate.js, with the real filter loaded', () => {
  let count = 0;
  for (const [letter, shard] of Object.entries(shards)) {
    for (const [word, entry] of Object.entries(shard)) {
      count++;
      const where = `${letter}.json "${word}"`;
      assert.ok(!isBlockedWord(word), `${where}: the filter blocks the word`);
      assert.ok(entry !== null && typeof entry === 'object' && !Array.isArray(entry), `${where}: not an object`);
      for (const key of Object.keys(entry)) assert.ok(FIELDS.has(key), `${where}: unexpected key "${key}"`);
      assert.ok(PARTS.has(entry.part), `${where}: part`);
      assert.equal(cleanSourceField(entry.definition, LIMITS.definition), entry.definition, `${where}: definition`);
      if ('group' in entry) assert.equal(cleanSourceField(entry.group, LIMITS.origin), entry.group, `${where}: group`);
      if ('sentence' in entry) {
        assert.equal(cleanSourceField(entry.sentence, LIMITS.sentence, { example: true }), entry.sentence, `${where}: sentence`);
        assert.ok(sentenceHasWordOnce(entry.sentence, word), `${where}: sentence needs the word exactly once`);
      }
    }
  }
  assert.ok(count >= 1000, `library has only ${count} words`);
});

test('every shard is under 150,000 bytes and the whole library under 3,000,000', () => {
  let total = 0;
  for (const letter of LETTERS) {
    const size = statSync(new URL(`../library/${letter}.json`, import.meta.url)).size;
    assert.ok(size < SHARD_MAX, `${letter}.json is ${size} bytes`);
    total += size;
  }
  assert.ok(total < TOTAL_MAX, `library is ${total} bytes`);
});

test('library/NOTICE.md names every source and the licences', () => {
  const notice = read('library/NOTICE.md');
  for (const input of sources.inputs) assert.ok(notice.includes(input.name), `NOTICE.md does not name ${input.name}`);
  assert.match(notice, /CC BY-SA 4\.0/);
  assert.match(notice, /CC BY 4\.0/);
  assert.match(notice, /Princeton/);
  assert.match(notice, /WordNet 3\.1 Copyright 2011 by Princeton University/);
});
