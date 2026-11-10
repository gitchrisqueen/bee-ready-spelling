// My words: the live lookup and the static library, with a fake fetch (no network).
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';
import {
  CONCURRENCY, HOSTS, cleanLookupCache, entryUrl, libraryEntry, lookupMissing, lookupOne, lookupUrl, resetShardCache,
  shardUrl,
} from '../mine/lookup.js';

const root = resolve(import.meta.dirname, '..');
before(() => setBlocklist(parseBlocklist(readFileSync(join(root, 'mine/filter.sha256'), 'utf8'))));
beforeEach(() => resetShardCache());

const reply = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => headers[k.toLowerCase()] ?? null },
  json: async () => { if (body instanceof Error) throw body; return body; },
});
const page = extract => ({ query: { pages: [{ title: 't', extract }] } });
const MISSING = { query: { pages: [{ title: 't', missing: true }] } };
const SIMPLE = '\n== Noun ==\n\nA cat is a small animal.\nThe cat sat on the mat.';
const ENGLISH = '\n== English ==\n\n=== Etymology ===\nFrom Old English catt, from Latin cattus.\n\n=== Noun ===\ncat (plural cats)\n\nA small animal.';
const wordOf = url => new URL(url).searchParams.get('titles');
const hostOf = url => new URL(url).host;

test('lookupUrl only builds URLs for the two allowed hosts and encodes the title', () => {
  const url = new URL(lookupUrl('en.wiktionary.org', 'café'));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('titles'), 'café');
  assert.ok(url.href.includes('titles=caf%C3%A9'));
  assert.equal(url.searchParams.get('origin'), '*');
  assert.equal(url.searchParams.get('formatversion'), '2');
  assert.deepEqual([...HOSTS], ['simple.wiktionary.org', 'en.wiktionary.org']);
  for (const host of ['evil.example', 'wiktionary.org', 'en.wiktionary.org.evil.example', '']) {
    assert.throws(() => lookupUrl(host, 'cat'), /not allowed/, host);
  }
});

test('a word found on both hosts gives one entry with both credits', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return reply(page(hostOf(url).startsWith('simple') ? SIMPLE : ENGLISH)); };
  const r = await lookupOne(fetchFn, 'cat');
  assert.equal(r.status, 'found');
  assert.deepEqual(r.entry, {
    word: 'cat', src: 'live', definition: 'A cat is a small animal.', part: 'n', group: 'Latin',
    sentence: 'The cat sat on the mat.', credit: ['simple.wiktionary.org', 'en.wiktionary.org'],
  });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.ok(HOSTS.includes(hostOf(c.url)));
    assert.equal(c.init.credentials, 'omit');
    assert.match(c.init.headers['Api-User-Agent'], /^BeeReady\/1\.0 \(https:\/\/github\.com\//);
  }
});

test('a word on neither host is missing, not an error', async () => {
  const r = await lookupOne(async () => reply(MISSING), 'zzzz');
  assert.deepEqual(r, { status: 'missing' });
});

test('lookups run at most 3 at a time and every word is looked up once', async () => {
  let inFlight = 0, peak = 0;
  const seen = [];
  const fetchFn = async url => {
    inFlight++; peak = Math.max(peak, inFlight); seen.push(wordOf(url));
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return reply(page(SIMPLE.replace(/cat/g, wordOf(url))));
  };
  const words = ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh'];
  const progress = [];
  const { results, stopped } = await lookupMissing(words, { fetchFn, onProgress: (d, t) => progress.push([d, t]) });
  assert.equal(stopped, null);
  assert.equal(CONCURRENCY, 3);
  assert.ok(peak <= 3 && peak >= 2, `peak ${peak}`);
  assert.equal(Object.keys(results).length, 8);
  assert.equal(seen.length, 16, 'two hosts per word');
  assert.deepEqual(progress.at(-1), [8, 8]);
});

const failures = [
  ['a 403', () => reply({}, { status: 403 }), 'blocked'],
  ['a 500', () => reply({}, { status: 500 }), 'server'],
  ['a 502', () => reply({}, { status: 502 }), 'server'],
  ['a network error', () => { throw new TypeError('failed to fetch'); }, 'network'],
  ['a body that is not JSON', () => reply(new Error('bad json')), 'shape'],
  ['an answer with no page', () => reply({ query: {} }), 'shape'],
  ['an answer with no extract', () => reply({ query: { pages: [{ title: 'x' }] } }), 'shape'],
  ['a 429 with no Retry-After', () => reply({}, { status: 429 }), 'rate-limit'],
  ['a 429 that asks for a long wait', () => reply({}, { status: 429, headers: { 'retry-after': '31' } }), 'rate-limit'],
];
for (const [name, make, reason] of failures) {
  test(`${name} stops the whole lookup with "${reason}" and the later words are never requested`, async () => {
    const urls = [];
    const fetchFn = async url => { urls.push(url); return make(); };
    const words = Array.from({ length: 10 }, (_, i) => `w${'abcdefghij'[i]}x`);
    const { results, stopped } = await lookupMissing(words, { fetchFn });
    assert.equal(stopped, reason);
    assert.ok(urls.length <= CONCURRENCY, `${urls.length} requests started before the stop`);
    assert.deepEqual(results, {}, 'nothing is guessed');
  });
}

test('a 429 with Retry-After 0 is retried once, then works', async () => {
  let n = 0;
  const fetchFn = async url => (hostOf(url).startsWith('simple') && n++ === 0
    ? reply({}, { status: 429, headers: { 'retry-after': '0' } }) : reply(page(hostOf(url).startsWith('simple') ? SIMPLE : ENGLISH)));
  const { results, stopped } = await lookupMissing(['cat'], { fetchFn });
  assert.equal(stopped, null);
  assert.equal(results.cat.definition, 'A cat is a small animal.');
});

test('a second 429 after the one retry stops the lookup', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return reply({}, { status: 429, headers: { 'retry-after': '0' } }); };
  const { stopped } = await lookupMissing(['cat'], { fetchFn });
  assert.equal(stopped, 'rate-limit');
  assert.equal(calls, 2);
});

test('a request that takes too long is a timeout, and a cancel is a cancel', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.equal((await lookupMissing(['cat'], { fetchFn: hang, timeoutMs: 20 })).stopped, 'timeout');
  const controller = new AbortController();
  const run = lookupMissing(['cat'], { fetchFn: hang, timeoutMs: 5000, signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  assert.equal((await run).stopped, 'cancelled');
});

test('cached words are not requested again, and an empty or fully cached list makes no request', async () => {
  let calls = 0;
  const fetchFn = async url => { calls++; return reply(page(SIMPLE)); };
  const cache = { cat: { word: 'cat', definition: 'cached' }, nope: null };
  const { results } = await lookupMissing(['cat', 'nope'], { fetchFn, cache });
  assert.equal(calls, 0);
  assert.deepEqual(results, cache);
  assert.deepEqual(await lookupMissing([], { fetchFn }), { results: {}, stopped: null });
  assert.equal(calls, 0);
  await lookupMissing(['cat2'.replace('2', 'x')], { fetchFn, cache });
  assert.ok('catx' in cache, 'new results are written to the cache');
});

test('text from the dictionary goes through the validator: unsafe definitions and examples are left out', async () => {
  const evil = '\n== Noun ==\n\nA cat is <b>bold</b> see https://evil.example now.\nThe cat <img src=x> sat.';
  const r = await lookupOne(async () => reply(page(evil)), 'cat');
  assert.deepEqual(r, { status: 'missing' });
});

test('the library: one shard download per letter, fields validated, bad or unknown words give nothing', async () => {
  let downloads = 0;
  const shard = {
    apple: { part: 'n', definition: 'A round fruit.', group: 'Old English', sentence: 'An apple fell.', extra: 'x' },
    arrow: { part: 'n', definition: '<b>x</b>' },
    ant: { part: 'bogus', definition: 'A tiny insect.', sentence: 'No match here.' },
  };
  const fetchFn = async url => { downloads++; assert.equal(url, './library/a.json'); return reply(shard); };
  assert.deepEqual(await libraryEntry(fetchFn, 'Apple'), {
    word: 'apple', src: 'library', definition: 'A round fruit.', part: 'n', group: 'Old English', sentence: 'An apple fell.',
  });
  assert.deepEqual(await libraryEntry(fetchFn, 'ant'), { word: 'ant', src: 'library', definition: 'A tiny insect.' });
  assert.equal(await libraryEntry(fetchFn, 'arrow'), null);
  assert.equal(await libraryEntry(fetchFn, 'avocado'), null);
  assert.equal(downloads, 1);
  assert.equal(shardUrl('a'), './library/a.json');
  for (const bad of ['', '1', 'ab', '/', '.', '%']) assert.equal(shardUrl(bad), null, bad);
});

test('a failed or malformed shard download gives nothing and does not throw', async () => {
  assert.equal(await libraryEntry(async () => reply({}, { status: 404 }), 'apple'), null);
  resetShardCache();
  assert.equal(await libraryEntry(async () => { throw new TypeError('offline'); }, 'apple'), null);
  resetShardCache();
  assert.equal(await libraryEntry(async () => reply([1, 2]), 'apple'), null);
});

test('a lookup request sends no referrer and no cookies', async () => {
  let init = null;
  await lookupOne(async (url, i) => { init = i; return reply(MISSING); }, 'cat');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.credentials, 'omit');
});

test('credit links are built only for the two allowed hosts', () => {
  assert.equal(entryUrl('simple.wiktionary.org', 'cat'), 'https://simple.wiktionary.org/wiki/cat');
  for (const host of ['evil.example', '../x', '']) assert.throws(() => entryUrl(host, 'cat'), /not allowed/);
});

test('the cached lookups are validated on read: bad entries, hosts and shapes are dropped', () => {
  const raw = {
    cat: { word: 'cat', definition: 'A small animal.', part: 'n', credit: ['simple.wiktionary.org', 'evil.example'] },
    dog: { definition: 'x', credit: { length: 1 } },
    fish: { definition: '<b>x</b>' },
    bird: null,
    'not a word': { definition: 'x' },
    toString: { definition: 'x' },
    cow: 'a string', pig: 5, hen: [1, 2],
  };
  const clean = cleanLookupCache(raw);
  assert.deepEqual(clean.cat, { word: 'cat', src: 'live', part: 'n', definition: 'A small animal.', credit: ['simple.wiktionary.org'] });
  assert.deepEqual(clean.dog, { word: 'dog', src: 'live', definition: 'x' }, 'a credit that is not an array is dropped');
  assert.equal('fish' in clean, false);
  assert.equal(clean.bird, null, 'a "not found" is kept');
  for (const k of ['not a word', 'cow', 'pig', 'hen']) assert.equal(k in clean, false, k);
  assert.deepEqual(cleanLookupCache(null), {});
  assert.deepEqual(cleanLookupCache([1]), {});
  assert.deepEqual(cleanLookupCache('x'), {});
});
