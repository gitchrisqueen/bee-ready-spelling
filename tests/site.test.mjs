import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = name => readFileSync(join(root, name), 'utf8');
const words = JSON.parse(read('words.json'));

test('word inventory has all 1,155 original unique entries', () => {
  assert.equal(words.length, 1155);
  assert.equal(new Set(words.map(w => w.word.toLowerCase())).size, 1155);
  assert.equal(words.filter(w => w.level === 'Study').length, 911);
  assert.equal(words.filter(w => w.level === 'Challenge').length, 244);
  for (const w of words) {
    assert.ok(Number.isInteger(w.id));
    assert.ok(typeof w.word === 'string' && w.word.length);
    assert.ok(typeof w.definition === 'string' && w.definition.length);
    assert.ok(typeof w.group === 'string' && w.group.length);
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
