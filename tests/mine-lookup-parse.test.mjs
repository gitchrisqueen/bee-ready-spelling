// My words, Phase 1 entry check (docs/my-words-phase0-findings.md): the parser over 50 named words, on recorded
// responses from both Wiktionary hosts (tests/fixtures/wiktionary-extracts.json, CC BY-SA 4.0, see its NOTICE.md).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';
import { mergeResults, parseExtract } from '../mine/lookup.js';
import { LIMITS, cleanField, sentenceHasWordOnce } from '../mine/validate.js';
import { originLabel } from '../mine/origin.js';

const root = resolve(import.meta.dirname, '..');
const fixtures = JSON.parse(readFileSync(join(root, 'tests/fixtures/wiktionary-extracts.json'), 'utf8'));
const WORDS = Object.keys(fixtures);
before(() => setBlocklist(parseBlocklist(readFileSync(join(root, 'mine/filter.sha256'), 'utf8'))));

const parseSimple = w => (fixtures[w].simple ? parseExtract(fixtures[w].simple, w) : null);
const parseEnglish = w => (fixtures[w].en ? parseExtract(fixtures[w].en, w, { english: true }) : null);
const LABELS = new Set(['Latin', 'Greek', 'French', 'German', 'Dutch', 'Spanish', 'Italian', 'Portuguese', 'Arabic', 'Persian', // preflight: ok
  'Hebrew', 'Yiddish', 'Sanskrit', 'Hindi', 'Turkish', 'Russian', 'Polish', 'Japanese', 'Chinese', 'Norse', 'Celtic',
  'Hungarian', 'Malay', 'Hawaiian', 'Nahuatl', 'Quechua', 'Tamil', 'Swahili', 'Korean', 'Old English']);

test('there are at least 50 named words, each with a recorded answer from both hosts', () => {
  assert.ok(WORDS.length >= 50, `${WORDS.length} words`);
  assert.equal(new Set(WORDS).size, WORDS.length);
  for (const w of WORDS) assert.ok('simple' in fixtures[w] && 'en' in fixtures[w], w);
});

test('every parse result is clean: a short label or nothing, never unparsed text', () => {
  for (const w of WORDS) {
    for (const r of [parseSimple(w), parseEnglish(w)]) {
      if (!r) continue;
      assert.ok(r.part === null || ['n', 'v', 'adj', 'adv', 'interj'].includes(r.part), `${w} part ${r.part}`);
      if (r.definition) assert.equal(cleanField(r.definition, LIMITS.definition), r.definition, `${w} definition`);
      if (r.example) assert.ok(sentenceHasWordOnce(r.example, w), `${w} example has the word once`);
      if (r.origin) assert.ok(LABELS.has(r.origin), `${w} origin "${r.origin}"`);
      assert.ok(r.definition || r.origin, `${w} gives something or is null`);
    }
  }
});

test('the Simple English extract gives a child-readable definition for nearly every word', () => {
  const found = WORDS.filter(w => parseSimple(w)?.definition);
  assert.ok(found.length >= 45, `${found.length} of ${WORDS.length}`);
  assert.equal(parseSimple('cemetery').definition, 'A place where dead people are buried; a place for graves.');
  assert.match(parseSimple('guitar').definition, /^A guitar is a stringed musical instrument/);
  assert.match(parseSimple('water').definition, /^Water is a clear liquid/);
  assert.match(parseSimple('noodle').definition, /^A noodle is a long thin food/);
  assert.equal(parseSimple('benevolent').example?.startsWith('Even though fairies'), true);
});

test('stacked leading labels such as "(countable) (music)" never reach the child', () => {
  for (const w of WORDS) {
    const d = parseSimple(w)?.definition ?? parseEnglish(w)?.definition;
    if (d) assert.equal(d.startsWith('('), false, `${w}: ${d.slice(0, 30)}`);
    if (d) assert.equal(/Synonyms?:|Antonyms?:/.test(d), false, w);
  }
});

test('origin labels for words whose source language is well known', () => {
  const expected = {
    abdicate: 'Latin', algebra: 'Latin', pizza: 'Italian', coffee: 'Dutch', kindergarten: 'German', tomato: 'Spanish',
    tsunami: 'Japanese', safari: 'Swahili', yogurt: 'Turkish', croissant: 'French', island: 'Dutch', jungle: 'Hindi',
    dinosaur: 'Greek', octopus: 'Latin', bamboo: 'Dutch',
  };
  for (const [w, label] of Object.entries(expected)) assert.equal(parseEnglish(w)?.origin, label, w);
});

test('words whose etymology names no listed language correctly report that origin is not available', () => {
  for (const w of ['igloo', 'kangaroo', 'sandwich', 'fluorescent']) {
    assert.equal(parseEnglish(w)?.origin ?? null, null, w);
    const merged = mergeResults(w, parseSimple(w), parseEnglish(w));
    assert.equal(merged?.group, undefined, `${w} has no origin field`);
  }
});

test('the merge prefers the Simple definition and example and the English origin', () => {
  const m = mergeResults('abdicate', parseSimple('abdicate'), parseEnglish('abdicate'));
  assert.match(m.definition, /^When a ruler abdicates/);
  assert.equal(m.group, 'Latin');
  assert.equal(m.sentence, 'After the war, the king was forced to abdicate.');
  assert.deepEqual(m.credit, ['simple.wiktionary.org', 'en.wiktionary.org']);
  assert.equal(m.src, 'live');
});

test('pages with no usable entry give null', () => {
  assert.equal(parseExtract('', 'cat'), null);
  assert.equal(parseExtract('\n== Latin ==\n\n=== Noun ===\ncat\n\nA thing.', 'cat', { english: true }), null,
    'an English Wiktionary page with only other languages');
  assert.equal(parseExtract(undefined, 'cat'), null);
  assert.equal(parseExtract('\n== Noun ==\n\n(Can we verify this sense?)', 'cat'), null);
});

test('originLabel: first non-English language wins; older English only gives Old English; nothing gives null', () => {
  assert.equal(originLabel('From Middle English cimiterie, from Old French cimitiere, from Late Latin coemeterium.'), 'French'); // preflight: ok
  assert.equal(originLabel('From Old English wæter.'), 'Old English');
  assert.equal(originLabel('Of unknown origin.'), null);
  assert.equal(originLabel(''), null);
  assert.equal(originLabel(undefined), null);
  assert.equal(originLabel('Borrowed from Neapolitan pizza.'), 'Italian');
});

test('the figures quoted in docs/my-words-phase0-findings.md ("Phase 1 results") come from these fixtures', () => {
  const tally = { words: 0, simpleMissingPage: 0, simpleDefinition: 0, simpleExample: 0, englishDefinition: 0, englishOrigin: 0 }; // preflight: ok
  for (const w of WORDS) {
    tally.words++;
    if (!fixtures[w].simple) tally.simpleMissingPage++;
    const s = parseSimple(w), e = parseEnglish(w);
    if (s?.definition) tally.simpleDefinition++;
    if (s?.example) tally.simpleExample++;
    if (e?.definition) tally.englishDefinition++;
    if (e?.origin) tally.englishOrigin++;
  }
  assert.deepEqual(tally, {
    words: 50, simpleMissingPage: 1, simpleDefinition: 49, simpleExample: 32, englishDefinition: 50, englishOrigin: 46,
  });
});

test('hostile page text does not make the parser slow', () => {
  const started = performance.now();
  const hostile = ['='.repeat(200000), `== ${' '.repeat(200000)} ==`, '== a ==\n'.repeat(20000),
    `== English ==\n=== Noun ===\n${'x '.repeat(100000)}`, `=== ${'= '.repeat(50000)}`];
  for (const text of hostile) parseExtract(text, 'cat', { english: true });
  assert.ok(performance.now() - started < 3000, `${Math.round(performance.now() - started)} ms`);
});
