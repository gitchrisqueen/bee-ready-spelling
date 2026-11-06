import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
