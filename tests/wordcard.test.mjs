import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  wordCardHtml, detailsData, detailsPanelId, wordTitleId, toggleLabel, starLabelDefault, ORIGIN_NOTE, BOOKLET_NOTE,
  UNKNOWN_ORIGIN, NOT_KNOWN_YET,
} from '../wordcard.js';
import { sentenceFor } from '../sentences.js';

const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', interj: 'interjection' };
const base = { id: 7, word: 'abdicate', part: 'v', definition: 'To give up a throne.', group: 'Latin', level: 'Study' };
const card = (w, o) => wordCardHtml({ ...base, ...w }, POS, sentenceFor, o);
const esc = s => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');

test('the card shows every label, the three audio buttons and the old buttons', () => {
  const html = card({ sentence: 'The king chose to abdicate.' });
  for (const t of ['Part of speech', 'Origin', 'Booklet list', 'In a sentence']) assert.ok(html.includes(`<dt>${t}</dt>`), t);
  for (const t of ['Hear the word', 'Hear it slowly', 'Hear the sentence']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('<dd>verb</dd>'));
  assert.ok(html.includes(`<dd>Latin<small class="details-note">${esc(ORIGIN_NOTE)}</small></dd>`));
  assert.ok(html.includes(`<dd>Study<small class="details-note">${esc(BOOKLET_NOTE)}</small></dd>`));
  assert.equal(ORIGIN_NOTE, 'This is only a hint. It is not the whole story of where the word came from.');
  assert.match(BOOKLET_NOTE, /fixed groups/);
  assert.match(BOOKLET_NOTE, /Star button/);
  assert.ok(html.includes('<dd>The king chose to abdicate.</dd>'), 'the full sentence shows, with the word visible');
  assert.match(html, /data-say-id="7"[^>]*><span aria-hidden="true">🔊<\/span> Listen<\/button>/);
  assert.match(html, /data-star-id="7" aria-pressed="false" aria-label="Star: abdicate"><span class="star-glyph" aria-hidden="true">☆<\/span><\/button>/);
  assert.match(html, /href="https:\/\/www\.merriam-webster\.com\/dictionary\/abdicate"/);
});

test('the toggle is a real button: closed by default, aria-expanded, aria-controls, visible text', () => {
  const html = card();
  const m = html.match(/<button type="button" class="details-btn"[^>]*>Details <span class="chev" aria-hidden="true">▸<\/span><\/button>/);
  assert.ok(m);
  assert.match(m[0], /aria-expanded="false"/);
  const controls = m[0].match(/aria-controls="([^"]+)"/)[1];
  assert.equal(controls, detailsPanelId(7));
  assert.ok(html.includes(`<div class="word-details" id="${controls}" hidden>`));
  const open = card({}, { open: true });
  assert.match(open, /aria-expanded="true"[^>]*>Details <span/);
  assert.ok(open.includes(`<div class="word-details" id="${controls}">`));
});

test('accessible names are fixed: the open/pressed state lives in aria-expanded and aria-pressed only', () => {
  assert.equal(toggleLabel(base), 'Details for abdicate');
  assert.equal(starLabelDefault(base), 'Star: abdicate');
  for (const o of [{}, { open: true, starred: true }]) {
    const html = card({}, o);
    assert.ok(html.includes('aria-label="Details for abdicate"'));
    assert.ok(html.includes('aria-label="Star: abdicate"'));
    for (const [, name] of html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)) assert.ok(!/^(Remove star|Hide details)/.test(name), name);
  }
  const names = o => [...card({}, o).matchAll(/aria-label="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(names({ open: true, starred: true }), names({}), 'every accessible name is identical in both states');
});

test('visible text is part of the accessible name (WCAG 2.5.3)', () => {
  const html = card();
  const listen = html.match(/<button[^>]*data-say-id="7"[^>]*aria-label="([^"]*)"/);
  assert.equal(listen[1], 'Listen to abdicate');
  let checked = 0;
  for (const [, name, inner] of html.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/button>/g)) {
    const visible = inner.replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, '').trim();
    if (!visible) continue;
    checked++;
    assert.ok(name.toLowerCase().startsWith(visible.toLowerCase()), `"${name}" must start with its visible text "${visible}"`);
  }
  assert.ok(checked >= 5, 'Listen, Details and the three audio buttons are checked');
  const link = html.match(/<a [^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/a>/);
  assert.equal(link[1], 'Dictionary entry for abdicate (opens in a new tab)');
  assert.ok(link[2].startsWith('Dictionary'));
});

test('each card is labelled by its own heading, with a unique id', () => {
  const html = card();
  assert.ok(html.includes(`<article class="word-card" aria-labelledby="${wordTitleId(7)}">`));
  assert.ok(html.includes(`<h3 id="${wordTitleId(7)}">abdicate</h3>`));
  assert.notEqual(wordTitleId(7), wordTitleId(8));
});

test('the page has a hidden h2 before the word grid, and the hidden-text class exists', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<h2 class="sr-only">Words<\/h2><div id="wordGrid"/);
  assert.match(readFileSync(new URL('../styles.css', import.meta.url), 'utf8'), /\.sr-only\{position:absolute/);
});

test('audio buttons are real buttons with a clear aria-label that names the word', () => {
  const html = card();
  for (const kind of ['word', 'slow', 'sentence']) assert.match(html, new RegExp(`<button type="button" class="mini-btn" data-hear="${kind}" data-hear-id="7" aria-label="Hear `));
  assert.ok(html.includes('aria-label="Hear the word: abdicate"'));
  assert.ok(html.includes('aria-label="Hear it slowly: abdicate"'));
  assert.ok(html.includes('aria-label="Hear the sentence for abdicate"'));
});

test('hostile text is escaped everywhere', () => {
  const evil = `<script>alert("x")</script>'&`;
  const html = card({ id: '9"><img src=x>', word: evil, definition: evil, group: evil, level: evil, sentence: evil, part: evil });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('alert("x")'), 'double quotes are escaped');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&amp;'));
  const attrs = [...html.matchAll(/ (?:id|aria-controls|data-[a-z-]+|aria-label)="([^"]*)"/g)].map(x => x[1]);
  assert.ok(attrs.length > 8);
  for (const a of attrs) assert.ok(!/[<>"]/.test(a), a);
  assert.equal((html.match(/<article/g) || []).length, 1);
  assert.equal((html.match(/<button/g) || []).length, 6, 'no extra element is injected');
});

test('a stored sentence wins; without one the fallback sentence is shown', () => {
  assert.ok(card({ sentence: 'Stored sentence for abdicate.' }).includes('<dd>Stored sentence for abdicate.</dd>'));
  const without = card({ sentence: undefined });
  assert.ok(without.includes('<dd>In the story, the character decided to abdicate.</dd>'));
  assert.equal(detailsData(base, POS, () => '  ').sentence, 'No sentence yet.');
  assert.equal(detailsData(base, POS, () => { throw new Error('x'); }).sentence, 'No sentence yet.');
});

test('every part of speech is spelled out; an unknown part is safe', () => {
  for (const [k, v] of Object.entries(POS)) {
    assert.equal(detailsData({ ...base, part: k }, POS, sentenceFor).part, v);
    assert.ok(card({ part: k }).includes(`<dd>${v}</dd>`));
  }
  for (const part of ['zzz', undefined, null, '', 'constructor', '__proto__', 'toString']) {
    assert.equal(detailsData({ ...base, part }, POS, sentenceFor).part, 'Not listed', String(part));
    const html = card({ part });
    assert.ok(html.includes('<dd>Not listed</dd>'));
    assert.ok(html.includes(' · word</div>'), 'the small line keeps its old "word" fallback');
  }
});

test('the booklet list shows Study or Challenge, and tolerates odd values', () => {
  assert.equal(detailsData({ ...base, level: 'Challenge' }, POS, sentenceFor).booklet, 'Challenge');
  assert.equal(detailsData({ ...base, level: undefined }, POS, sentenceFor).booklet, 'Not listed');
  assert.equal(detailsData({ ...base, group: ' ' }, POS, sentenceFor).origin, 'Not listed');
});

test('panel ids are unique per word, and aria-controls always matches a panel id', () => {
  const ids = [1, 2, 3, 10, 11, 100].map(detailsPanelId);
  assert.equal(new Set(ids).size, ids.length);
  const html = [1, 2, 3, 10, 11].map(id => card({ id })).join('');
  const panels = [...html.matchAll(/<div class="word-details" id="([^"]+)"/g)].map(m => m[1]);
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(panels).size, 5);
  assert.deepEqual(controls, panels);
  const all = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(all).size, all.length, 'no duplicate ids in the whole list');
});

test('the star state and label come from the caller', () => {
  const html = card({}, { starred: true, starLabel: w => `Mine ${w.word}` });
  assert.match(html, /aria-pressed="true" aria-label="Mine abdicate"><span class="star-glyph" aria-hidden="true">★/);
});

test('importing the module needs no DOM', () => {
  assert.equal(typeof document, 'undefined');
});

test('a My words card has no booklet row, and credits only the two Wiktionary hosts', () => {
  const html = card({ custom: true, level: 'Mine', credit: ['simple.wiktionary.org', 'evil.example', '"><script>'], word: 'cat' }); // preflight: ok
  assert.equal(html.includes('Booklet list'), false);
  assert.ok(html.includes('<dt>Origin</dt>'));
  assert.ok(html.includes('<a href="https://simple.wiktionary.org/wiki/cat" target="_blank" rel="noopener noreferrer">'
    + 'simple.wiktionary.org<span class="sr-only"> (opens in a new tab)</span></a>'));
  assert.ok(html.includes('(CC BY-SA 4.0)'));
  assert.equal(html.includes('evil.example'), false);
  assert.equal(html.includes('<script>'), false);
  assert.ok(card({ word: 'cat' }).includes('Booklet list'), 'a default card is unchanged');
  assert.equal(card({ word: 'cat' }).includes('source-credit'), false);
});

test('a My words card prints only what is known: no "Mine" tag and no placeholder "word" next to the title', () => {
  const meta = html => /<div class="word-meta">([^<]*)<\/div>/.exec(html)[1];
  const mine = { custom: true, level: 'Mine', word: 'tear' };
  assert.equal(meta(card({ ...mine, group: 'Old English', part: 'n' })), 'Old English · noun');
  assert.equal(meta(card({ ...mine, group: UNKNOWN_ORIGIN, part: 'n' })), 'noun');
  assert.equal(meta(card({ ...mine, group: 'Latin', part: '' })), 'Latin');
  assert.equal(meta(card({ ...mine, group: UNKNOWN_ORIGIN, part: '' })), 'My word');
  for (const part of ['', undefined, 'zzz']) {
    assert.equal(/Mine|· word</.test(card({ ...mine, group: UNKNOWN_ORIGIN, part })), false, String(part));
  }
  assert.equal(meta(card({ word: 'cat' })), 'Latin · Study · verb', 'a default card keeps its three tags');
});

test('a My words card says "Not known yet" for an unknown part or origin, not a repeated label', () => {
  const html = card({ custom: true, level: 'Mine', word: 'quay', group: UNKNOWN_ORIGIN, part: '' });
  assert.ok(html.includes(`<dt>Part of speech</dt><dd>${NOT_KNOWN_YET}</dd>`));
  assert.ok(html.includes(`<dt>Origin</dt><dd>${NOT_KNOWN_YET}`));
  assert.equal(html.includes('Origin not available'), false);
  assert.equal(html.includes('details-note'), false, 'no hint under an origin that is not known');
  assert.equal(detailsData({ ...base, part: '' }, POS, sentenceFor).part, 'Not listed', 'a default card is unchanged');
});

test('the page ships the My words speller screens closed: words are behind "for grown-ups" controls', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="mineLinkCard"[^>]* hidden>/, 'the link card starts hidden');
  assert.match(html, /<details id="mineWordsBox"[^>]*>(?!.*\bopen\b)/s, 'the saved words start closed');
  assert.equal(/<details id="mineWordsBox"[^>]*\bopen\b/.test(html), false);
  assert.equal(/<details id="mineLinkGrownups"[^>]*\bopen\b/.test(html), false);
  assert.match(html, /Grown-ups: check the words first/);
  assert.match(html, /id="mineLinkStart"[^>]*>Start my spelling bee</);
  const card = /<div id="mineLinkCard"[\s\S]*?<\/details>\s*<\/div>/.exec(html)[0];
  assert.equal(/mineChips|mineWordList/.test(card), false, 'the link card holds no word list');
});

