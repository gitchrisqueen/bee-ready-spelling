import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = name => readFileSync(join(root, name), 'utf8');
const words = JSON.parse(read('words.json'));

test('word inventory is well-formed (adding or removing words must not break the build)', () => {
  assert.ok(words.length > 0);
  assert.equal(new Set(words.map(w => w.word.toLowerCase())).size, words.length, 'words must be unique');
  for (const w of words) {
    assert.ok(Number.isInteger(w.id));
    assert.ok(typeof w.word === 'string' && w.word.length);
    assert.ok(typeof w.definition === 'string' && w.definition.length);
    assert.ok(typeof w.group === 'string' && w.group.length);
    assert.ok(['Study', 'Challenge'].includes(w.level), `${w.word}: level must be Study or Challenge`);
  }
});

test('no two words share a clip file name', async () => {
  const { clipKey } = await import('../voice-service.js');
  const seen = new Map();
  for (const w of words) {
    const key = clipKey(w.word);
    assert.ok(!seen.has(key) || seen.get(key) === w.word, `"${seen.get(key)}" and "${w.word}" both map to ${key}`);
    seen.set(key, w.word);
    assert.match(key, /^[a-z0-9_-]+$/, `${w.word}: clip name must be plain ASCII`);
  }
});

test('entrypoint uses relative URLs that work in GitHub Pages project subpath', () => {
  const html=read('index.html');
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.match(read('app.js'), /fetch\('\.\/words\.json'\)/);
  assert.doesNotMatch(html, /<base\s+href="\/"/i);
});

test('voice choices and model download UI appear', () => {
  const html=read('index.html');
  for(const phrase of ['voiceDownload','downloadTrack','downloadPercent','downloadUseDevice','downloadRetry','previewVoice']) {
    assert.ok(html.includes(phrase), `Missing UI: ${phrase}`);
  }
  const service=read('voice-service.js');
  for(const engine of ['kokoro','piper','device']) assert.ok(service.includes(engine));
});

test('printable resources exist and match download links', () => {
  const html=read('index.html');
  for(const name of ['Spelling_Bee_Alphabetical_List.pdf','Spelling_Bee_Definitions_Reference.pdf','Spelling_Bee_Practice_Workbook.pdf']) {
    assert.ok(existsSync(join(root, 'assets', name)));
    assert.ok(html.includes(`./assets/${name}`));
  }
});

test('public source contains no account keys or user-login requirements', () => {
  const js=read('voice-service.js');
  assert.doesNotMatch(js,/api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(js,/Authorization:\s*Bearer\s+\S+/i);
  assert.match(js,/KokoroTTS/);
  assert.match(js,/SpeechSynthesisUtterance/);
});

test('every clip listed in a voice manifest exists on disk', () => {
  const clipsDir = join(root, 'clips');
  if (!existsSync(clipsDir)) return;
  for (const voice of readdirSync(clipsDir)) {
    const manifest = join(clipsDir, voice, 'manifest.json');
    if (!existsSync(manifest)) continue;
    for (const key of Object.keys(JSON.parse(readFileSync(manifest, 'utf8')))) {
      assert.ok(existsSync(join(clipsDir, voice, `${key}.mp3`)), `${voice}/${key}.mp3 is listed but missing`);
    }
  }
});

test('clip folders, voices and the self-hosted voice files agree', async () => {
  const { VOICES } = await import('../voice-service.js');
  const ids = VOICES.map(v => v.kokoro);
  const fetchScript = read('scripts/fetch-voice-assets.mjs');
  for (const id of ids) assert.ok(fetchScript.includes(`'voices/${id}.bin'`), `${id}: add its voice file to fetch-voice-assets.mjs`);
  const clipsDir = join(root, 'clips');
  if (existsSync(clipsDir)) {
    for (const entry of readdirSync(clipsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) assert.ok(ids.includes(entry.name), `clips/${entry.name} is not a voice in VOICES`);
    }
  }
});

test('clip folders hold only mp3 files and a manifest', () => {
  const clipsDir = join(root, 'clips');
  if (!existsSync(clipsDir)) return;
  for (const voice of readdirSync(clipsDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
    for (const name of readdirSync(join(clipsDir, voice.name))) {
      assert.match(name, /^([a-z0-9_-]+\.mp3|manifest\.json)$/, `unexpected file clips/${voice.name}/${name}`);
    }
  }
});

test('the clip workflow can read the voice list from voice-service.js', async () => {
  const { VOICES } = await import('../voice-service.js');
  const found = [...read('voice-service.js').matchAll(/kokoro:'([a-z_]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(found, VOICES.map(v => v.kokoro).sort(), 'keep VOICES entries in the form kokoro:\'id\' (the workflow parses them)');
});

test('every practice sentence has its own plain-ASCII clip name', async () => {
  const { sentenceKey } = await import('../voice-service.js');
  const { sentenceFor } = await import('../sentences.js');
  const owners = new Map();
  for (const w of words) {
    const sentence = sentenceFor(w);
    assert.ok(typeof sentence === 'string' && sentence.length > 10, `${w.word}: sentence missing`);
    const key = sentenceKey(sentence);
    assert.match(key, /^sentence_[a-z0-9]+$/);
    assert.ok(!owners.has(key) || owners.get(key) === sentence, `sentence key collision for "${sentence}"`);
    owners.set(key, sentence);
  }
});

test('the workflow matrix takes its voices from VOICES, so no list can drift', () => {
  const workflow = read('.github/workflows/generate-clips.yml');
  assert.match(workflow, /fromJSON\(needs\.plan\.outputs\.voices\)/);
  assert.match(workflow, /kokoro:'\(\[a-z_\]\+\)'/);
});

test('a stored sentence is used, and a word without one still gets a fallback sentence', async () => {
  const { sentenceFor } = await import('../sentences.js');
  assert.equal(sentenceFor({ word: 'plaza', part: 'n', sentence: ' We met in the plaza. ' }), 'We met in the plaza.');
  assert.match(sentenceFor({ word: 'plaza', part: 'n' }), /plaza/);
});

test('every stored sentence uses its word exactly once, as a whole word', () => {
  for (const w of words) {
    if (typeof w.sentence !== 'string') continue;
    const low = w.sentence.toLowerCase();
    const word = w.word.toLowerCase();
    assert.equal(low.split(word).length - 1, 1, `${w.word}: the word must appear once and inside no other word: ${w.sentence}`);
    const whole = low.match(new RegExp(`(?<![\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu')) || [];
    assert.equal(whole.length, 1, `${w.word}: must appear exactly once as a whole word: ${w.sentence}`);
    assert.match(w.sentence, /[.!?][”"]?$/, `${w.word}: sentence must end with . ! or ?`);
  }
});

test('star controls are in the page and wired up', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of ['heroStarred', 'starFilter', 'starWord', 'clearStars']) assert.ok(html.includes(`id="${id}"`), `Missing UI: ${id}`);
  assert.match(html, /<option value="starred">My starred words<\/option>/);
  assert.match(html, /<label class="field">Show<select id="starFilter"><option value="all">All words<\/option><option value="starred">My starred words only<\/option>/);
  assert.doesNotMatch(html + app, /Remove star|Hide details/, 'state lives in aria-pressed / aria-expanded, never in a flipping name');
  assert.doesNotMatch(html + app, /[Tt]ap the ☆/, 'say "press the Star button (☆)", not the glyph alone');
  assert.match(html, /id="starWord"[^>]*aria-label="Star this word"/, 'the round star label must not reveal the word');
  assert.match(app, /from '\.\/stars\.js'/);
  assert.match(app, /type==='starred'/);
  assert.match(read('scripts/build.mjs'), /'stars\.js'/);
  assert.match(read('package.json'), /node --check stars\.js/);
});

test('word details are wired up: module is built and syntax-checked, and app.js uses it', () => {
  assert.match(read('scripts/build.mjs'), /'wordcard\.js'/);
  assert.match(read('package.json'), /node --check wordcard\.js/);
  const app = read('app.js');
  assert.match(app, /from '\.\/wordcard\.js'/);
  const hear = app.slice(app.indexOf('function hearFromCard'), app.indexOf('function renderWordBank'));
  assert.match(hear, /speedId:'slow'/);
  assert.ok(!hear.includes('select('), 'Hear it slowly must not change the saved speed');
});

test('status regions, focus moves and the clear-stars message are wired up', () => {
  const html = read('index.html'), app = read('app.js');
  assert.match(html, /id="resultCount" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /id="clearStarsStatus"[^>]*role="status"/);
  assert.match(html, /<button id="clearStars" class="text-btn">Clear this device's starred words<\/button>/);
  assert.doesNotMatch(app, /Starred words cleared ✓/, 'the button text must never change');
  assert.match(app, /setClearStatus\('Starred words cleared\.'\)/);
  assert.doesNotMatch(html, /id="roundArea"[^>]*aria-live/, 'the star button must stay out of a live region');
  assert.match(app, /You have no starred words yet\.<\/h2><p>Go to the Word bank and press the Star button on a word\./);
  assert.match(app, /id="emptyPoolHeading" tabindex="-1"/);
  assert.match(app, /removed from your starred words\. /);
  assert.match(app, /n===1\?'1 word'/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(app, /behavior:'smooth'/);
  assert.match(read('styles.css'), /animation-iteration-count:1!important/);
  assert.match(read('styles.css'), /scroll-padding-bottom:120px/);
});

test('fonts are hosted in the repo and the page makes no request to a font CDN', () => {
  const css = read('styles.css');
  const html = read('index.html');
  assert.doesNotMatch(css + html + read('app.js'), /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  for (const file of ['fonts/dm-sans-latin.woff2', 'fonts/fredoka-latin.woff2', 'fonts/OFL-DM-Sans.txt', 'fonts/OFL-Fredoka.txt']) {
    assert.ok(existsSync(join(root, file)), `${file} is missing`);
    assert.ok(statSync(join(root, file)).size > 1000, `${file} is empty`);
  }
  assert.equal(readFileSync(join(root, 'fonts/dm-sans-latin.woff2')).subarray(0, 4).toString(), 'wOF2');
  assert.match(css, /@font-face\{font-family:'DM Sans'/);
  assert.match(css, /@font-face\{font-family:'Fredoka'/);
  assert.match(read('scripts/build.mjs'), /'fonts'/);
});
