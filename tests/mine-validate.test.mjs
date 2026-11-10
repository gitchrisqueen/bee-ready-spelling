// My words: the SHA-256, the child-safety filter and the validator that every entry path uses.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256Hex } from '../mine/sha256.js';
import { isSensitiveText, isSensitiveWord } from '../mine/sensitive.js';
import { clearBlocklist, isBlockedText, isBlockedWord, parseBlocklist, setBlocklist } from '../mine/filter.js';
import {
  FIRST_CUSTOM_ID, HOSTS, LIMITS, LIST_ID_RE, cleanField, cleanSourceField, hasForbiddenKeys, isValidWord, normalizeWord, parseWords,
  sentenceHasWordOnce, validateEntry, validateList, validateStore,
} from '../mine/validate.js';

const root = resolve(import.meta.dirname, '..');
const real = () => parseBlocklist(readFileSync(join(root, 'mine/filter.sha256'), 'utf8'));
// A harmless made-up token stands in for an unsafe word, so no offensive word appears in this file.
const TOKEN = 'zzqblocked';

const load = () => setBlocklist([...real(), sha256Hex(TOKEN)]);
before(load);

test('the filter fails closed until a list is loaded', () => {
  clearBlocklist();
  try {
    assert.equal(isBlockedWord('apple'), true);
    assert.equal(isBlockedText('a perfectly kind sentence'), true);
    assert.deepEqual(parseWords('apple banana').words, [], 'no word passes while the filter is not ready');
    assert.equal(cleanField('A kind sentence.', 200), null);
  } finally { load(); }
});

test('sha256Hex matches node:crypto for empty, short, block-edge, long and non-ASCII input', () => {
  for (const input of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'café \u{1f41d}']) {
    assert.equal(sha256Hex(input), createHash('sha256').update(input).digest('hex'), JSON.stringify(input.slice(0, 12)));
  }
});

test('the filter blocks the token, simple variants and leetspeak, and lets ordinary words through', () => {
  assert.equal(isBlockedWord(TOKEN), true);
  assert.equal(isBlockedWord(`${TOKEN}s`), true, 'plural');
  assert.equal(isBlockedWord('ZZQ-BLOCKED'), true, 'case and punctuation');
  assert.equal(isBlockedWord('zzqbl0cked'), true, 'a digit standing in for a letter');
  assert.equal(isBlockedText(`this has a ${TOKEN} in it`), true);
  for (const ok of ['apple', 'house', 'class', 'assess', 'scunthorpe', 'cemetery']) assert.equal(isBlockedWord(ok), false, ok);
  assert.equal(isBlockedText('A place where dead people are buried; a place for graves.'), false);
});

test('mine/filter.sha256 holds only hashes and comments, and enough of them', () => {
  const lines = readFileSync(join(root, 'mine/filter.sha256'), 'utf8').split('\n').filter(Boolean);
  assert.ok(lines.filter(l => /^[0-9a-f]{64}$/.test(l)).length >= 100);
  for (const l of lines) assert.ok(l.startsWith('#') || /^[0-9a-f]{64}$/.test(l), 'only comments and hashes');
});

test('limits are the numbers in docs/my-words-plan.md', () => {
  assert.deepEqual({ ...LIMITS }, {
    words: 200, lists: 20, wordChars: 40, fragment: 8000, unpacked: 16384,
    definition: 200, origin: 40, sentence: 160, backups: 3, lookupEntries: 500, listName: 40,
  });
  assert.deepEqual([...HOSTS], ['simple.wiktionary.org', 'en.wiktionary.org']);
});

test('words: typed or pasted text is split, normalised, de-duplicated and checked', () => {
  const r = parseWords("1. apple, Banana\nbanana; cherry's  <b>x</b> ab3d pre-school étude 7");
  assert.deepEqual(r.words, ['apple', 'banana', "cherry's", 'pre-school', 'étude']);
  assert.equal(r.rejected.length, 2, 'the markup and the word with a digit inside are left out');
  assert.equal(parseWords(`${TOKEN} kind`).words.join(), 'kind');
  assert.deepEqual(parseWords(`${TOKEN} kind`).blocked, [TOKEN]);
  assert.equal(normalizeWord('  "Hello!" '), 'hello');
  assert.equal(isValidWord('a'.repeat(41)), false);
  assert.equal(isValidWord('a'.repeat(40)), true);
  assert.equal(isValidWord("-bad"), false);
});

test('words: at most 200 per list', () => {
  const many = Array.from({ length: 205 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${'q'.repeat(1 + Math.floor(i / 26))}`);
  const r = parseWords(many.join(' '));
  assert.equal(r.words.length, 200);
  assert.equal(r.truncated, true);
});

test('fields: markup, links, over-length text and filter hits are never shown', () => {
  assert.equal(cleanField('A place where dead people are buried.', 200), 'A place where dead people are buried.');
  for (const bad of ['<b>x</b>', 'see https://example.com', 'go to //x ://y', 'javascript:alert(1)', 'data: text',
    `a ${TOKEN} b`, '', '   ', 'x'.repeat(201)]) assert.equal(cleanField(bad, 200), null, bad.slice(0, 20));
  assert.equal(cleanField(5, 200), null);
  assert.equal(cleanField('x'.repeat(40), 40), 'x'.repeat(40));
  assert.equal(cleanField('x'.repeat(41), 40), null);
});

test('sentences must contain the word exactly once as a whole word', () => {
  assert.equal(sentenceHasWordOnce('We saw a cat today.', 'cat'), true);
  assert.equal(sentenceHasWordOnce('The cat and the cat.', 'cat'), false);
  assert.equal(sentenceHasWordOnce('A category of things.', 'cat'), false);
  assert.equal(sentenceHasWordOnce("It's a cat's life.", 'cat'), false, "cat's is a different word");
  assert.equal(sentenceHasWordOnce('No match here.', 'cat'), false);
});

test('entries: only known keys survive and bad optional fields are dropped', () => {
  const e = validateEntry({
    id: 1000001, word: 'Cat', src: 'live', part: 'n', definition: 'A small animal.', group: 'Old English',
    sentence: 'A cat sat.', credit: ['simple.wiktionary.org', 'evil.example'], extra: 'x', href: 'javascript:1',
  });
  assert.deepEqual(e, {
    id: 1000001, word: 'cat', src: 'live', part: 'n', definition: 'A small animal.', group: 'Old English',
    sentence: 'A cat sat.', credit: ['simple.wiktionary.org'],
  });
  const dropped = validateEntry({ id: 5, word: 'cat', definition: '<b>x</b>', group: 'x'.repeat(41), sentence: 'No match.' });
  assert.deepEqual(dropped, { id: 5, word: 'cat', src: 'manual' });
  assert.equal(validateEntry({ id: 0, word: 'cat' }), null);
  assert.equal(validateEntry({ id: 1.5, word: 'cat' }), null);
  assert.equal(validateEntry({ id: 2, word: TOKEN }), null);
  assert.equal(validateEntry({ id: 2, word: 'a b' }), null);
  assert.equal(validateEntry('cat'), null);
  assert.equal(validateEntry({ id: 2, word: 'cat', credit: ['simple.wiktionary.org'], src: 'library' }).credit, undefined,
    'credit only belongs to looked-up words');
});

test('prototype-polluting keys are rejected everywhere', () => {
  assert.equal(hasForbiddenKeys(JSON.parse('{"a":{"__proto__":{"x":1}}}')), true);
  assert.equal(hasForbiddenKeys(JSON.parse('{"constructor":1}')), true);
  assert.equal(hasForbiddenKeys(JSON.parse('[{"prototype":1}]')), true);
  assert.equal(hasForbiddenKeys({ a: [1, { b: 2 }] }), false);
  assert.equal(validateEntry(JSON.parse('{"id":2,"word":"cat","__proto__":{"x":1}}')), null);
  assert.equal(validateStore(JSON.parse('{"version":1,"lists":[],"constructor":{}}')), null);
});

test('stores and lists: shape, caps and ids', () => {
  const wordFor = i => `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}zz`;
  const entries = n => Array.from({ length: n }, (_, i) => ({ id: FIRST_CUSTOM_ID + i, word: wordFor(i) }));
  assert.equal(validateStore(null), null);
  assert.equal(validateStore({ version: 2, lists: [] }), null);
  assert.equal(validateStore({ version: 1, lists: 'x' }), null);
  const list = validateList({ key: 'l-1', name: 'Week 1', entries: entries(250) });
  assert.equal(list.entries.length, 200);
  assert.equal(validateList({ key: '../x', entries: [] }), null);
  const lists = Array.from({ length: 25 }, (_, i) => ({ key: `l-${i + 1}`, name: 'x', entries: [] }));
  const store = validateStore({ version: 1, nextId: 1, lists });
  assert.equal(store.lists.length, 20);
  assert.equal(store.nextId, FIRST_CUSTOM_ID, 'a bad nextId is repaired');
  const withIds = validateStore({ version: 1, nextId: 5, lists: [{ key: 'l-1', name: 'a', entries: [{ id: 1000050, word: 'cat' }] }] });
  assert.equal(withIds.nextId, 1000051);
  assert.equal(withIds.active, 'l-1');
});

test('the list id pattern is exactly 22 base64url characters', () => {
  assert.equal(LIST_ID_RE.test('A'.repeat(22)), true);
  for (const bad of ['../x', 'a%2Fb', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}/`, `${'A'.repeat(21)}.`, '']) {
    assert.equal(LIST_ID_RE.test(bad), false, bad);
  }
});

test('library and dictionary text that touches a sensitive topic is held back; a grown-up\'s own text is not', () => {
  for (const text of ['A gun is a weapon.', 'Kills the engine.', 'Cancer is a disease.']) {
    assert.equal(cleanSourceField(text, 200), null, text);
    assert.equal(cleanField(text, 200), text, 'typed text only goes through the profanity filter');
  }
  for (const text of ['He died last year.', 'It is stupid.']) {
    assert.equal(cleanSourceField(text, 200), text, 'allowed in a definition');
    assert.equal(cleanSourceField(text, 200, { example: true }), null, 'held back in an example sentence');
  }
  assert.equal(isSensitiveText('A place where dead people are buried.'), false, 'the cemetery definition is fine');
  assert.equal(cleanSourceField('A habit is something you do often.', 200), 'A habit is something you do often.');
  assert.equal(isSensitiveWord('Shooting'), true);
  assert.equal(isSensitiveWord('shoot'), true);
  assert.equal(isSensitiveWord('shout'), false);
  assert.equal(isSensitiveText('We went to the cemetery to remember her.'), false);
  const base = { id: 1000001, word: 'cat', definition: 'A cat can kill a mouse.', sentence: 'The cat sat.' };
  assert.equal(validateEntry({ ...base, src: 'library', sentence: 'The cat died.' }).sentence, undefined);
  assert.equal(validateEntry({ ...base, src: 'library' }).definition, undefined, 'a stored library entry is checked again');
  assert.equal(validateEntry({ ...base, src: 'live' }).definition, undefined);
  assert.equal(validateEntry({ ...base, src: 'manual' }).definition, 'A cat can kill a mouse.');
  assert.equal(validateEntry({ ...base, src: 'library' }).sentence, 'The cat sat.');
});
