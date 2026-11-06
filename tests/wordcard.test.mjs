import test from 'node:test';
import assert from 'node:assert/strict';
import { wordCardHtml, detailsData, detailsPanelId, toggleText, toggleLabel, ORIGIN_NOTE, BOOKLET_NOTE } from '../wordcard.js';
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
  assert.match(ORIGIN_NOTE, /study clue, not the full history/);
  assert.match(BOOKLET_NOTE, /fixed groups/);
  assert.match(BOOKLET_NOTE, /star/);
  assert.ok(html.includes('<dd>The king chose to abdicate.</dd>'), 'the full sentence shows, with the word visible');
  assert.match(html, /data-say-id="7"[^>]*>🔊 Listen<\/button>/);
  assert.match(html, /data-star-id="7" aria-pressed="false" aria-label="Star this word: abdicate">☆/);
  assert.match(html, /href="https:\/\/www\.merriam-webster\.com\/dictionary\/abdicate"/);
});

test('the toggle is a real button: closed by default, aria-expanded, aria-controls, visible text', () => {
  const html = card();
  const m = html.match(/<button type="button" class="details-btn"[^>]*>([^<]*)<\/button>/);
  assert.ok(m);
  assert.equal(m[1], 'Details');
  assert.match(m[0], /aria-expanded="false"/);
  const controls = m[0].match(/aria-controls="([^"]+)"/)[1];
  assert.equal(controls, detailsPanelId(7));
  assert.ok(html.includes(`<div class="word-details" id="${controls}" hidden>`));
  const open = card({}, { open: true });
  assert.match(open, /aria-expanded="true"[^>]*>Hide details<\/button>/);
  assert.ok(open.includes(`<div class="word-details" id="${controls}">`));
  assert.equal(toggleText(false), 'Details');
  assert.equal(toggleText(true), 'Hide details');
  assert.equal(toggleLabel(base, true), 'Hide details for abdicate');
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
  const html = card({}, { starred: true, starLabel: (w, on) => `${on ? 'On' : 'Off'} ${w.word}` });
  assert.match(html, /aria-pressed="true" aria-label="On abdicate">★/);
});

test('importing the module needs no DOM', () => {
  assert.equal(typeof document, 'undefined');
});
