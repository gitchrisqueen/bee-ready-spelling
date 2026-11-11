import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillEntry, needsDefinition } from '../mine/import.js';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';

// The safety list loads from this site in the page; here it is read from disk. Without it every text counts as blocked.
setBlocklist(parseBlocklist(readFileSync(new URL('../mine/filter.sha256', import.meta.url), 'utf8')));

test('needsDefinition: only a saved word with no definition, never a default-list word', () => {
  assert.equal(needsDefinition({ word: 'quay', src: 'manual' }), true);
  assert.equal(needsDefinition({ word: 'quay', src: 'manual', definition: '   ' }), true);
  assert.equal(needsDefinition({ word: 'quay', src: 'manual', definition: 'A landing place.' }), false);
  assert.equal(needsDefinition({ word: 'abide', src: 'default', id: 4 }), false);
});

test('fillEntry fills what is empty and keeps what a grown-up typed', () => {
  const entry = { id: 1000001, word: 'quay', src: 'manual', group: 'Typed origin' };
  const found = { definition: 'A place where boats load.', part: 'n', group: 'French', sentence: 'The boat reached the quay.' }; // preflight: ok
  const out = fillEntry(entry, found, 'library');
  assert.equal(out.definition, 'A place where boats load.');
  assert.equal(out.part, 'n');
  assert.equal(out.group, 'Typed origin', 'a typed origin is kept');
  assert.equal(out.sentence, 'The boat reached the quay.');
  assert.equal(out.src, 'library');
  assert.equal(out.id, 1000001, 'the id is kept, so stars and history still match');
});

test('fillEntry keeps a lookup credit only for a Wiktionary result, and only the two known hosts', () => {
  const entry = { id: 1000002, word: 'quay', src: 'manual' };
  const found = { definition: 'A landing place.', credit: ['simple.wiktionary.org', 'evil.example'] };
  assert.deepEqual(fillEntry(entry, found, 'live').credit, ['simple.wiktionary.org']);
  assert.equal(fillEntry(entry, found, 'library').credit, undefined);
});

test('fillEntry leaves the entry alone when the result is not usable', () => {
  const entry = { id: 1000003, word: 'quay', src: 'manual' };
  assert.equal(fillEntry(entry, null, 'live'), entry);
  assert.equal(fillEntry(entry, { definition: 42 }, 'live'), entry);
  assert.equal(fillEntry(entry, { definition: '<b>bad</b> markup' }, 'live'), entry, 'markup is refused');
  assert.equal(fillEntry(entry, { definition: 'See http://x.example for it' }, 'live'), entry, 'a link is refused');
});

test('the page explains share, backup and restore in plain words, with fixed button names', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, />Save a backup file</);
  assert.match(html, />Restore from a backup file<input id="mineImportFile"/);
  assert.match(html, />Copy a link to share this list</);
  assert.equal(/Download a backup|Open a backup/.test(html), false, 'the old, unclear labels are gone');
  assert.match(html, /<h3[^>]*>Share this list<\/h3>/);
  assert.match(html, /<h3[^>]*>Back up or move all your lists<\/h3>/);
  assert.match(html, /A backup is a file with all your lists and their definitions/);
  assert.match(html, /never replaces or deletes them/);
  assert.match(html, /carries only the words\. On the other device, open the Word bank and press Get missing definitions/);
  assert.match(html, /id="mineFillResult"[^>]*role="status"/, 'the result has its own live line beside the button');
  assert.match(html, /id="mineFill"[^>]*aria-describedby="mineFillNote"[^>]*>Get missing definitions</);
  assert.match(html, /id="mineFillBlock"[^>]* hidden>/, 'the definitions block starts hidden');
  assert.match(html, /Ask a grown-up before you press it/);
});
