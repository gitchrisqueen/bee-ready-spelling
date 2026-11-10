// My words: the privacy rules in docs/my-words-plan.md, checked as source text so they run under `npm test`.
// This is static analysis: a URL built at runtime could evade it, so tools/device-test also watches real requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = name => readFileSync(join(root, name), 'utf8');
const mineFiles = readdirSync(join(root, 'mine')).filter(f => f.endsWith('.js')).map(f => `mine/${f}`);
const hostsIn = text => [...new Set([...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map(m => m[1]))];

// Hosts the default page already named before My words existed (the optional live voice, the dictionary link, the SVG
// namespace).
// foundation.wikimedia.org is a link-out to a privacy policy, never a request.
const DEFAULT_PAGE_HOSTS = new Set(['huggingface.co', 'www.merriam-webster.com', 'esm.sh', 'cdn.jsdelivr.net', 'www.w3.org', // preflight: ok
  'foundation.wikimedia.org']);
const DEFAULT_PAGE_FILES = ['index.html', 'app.js', 'voice-service.js', 'stars.js', 'wordcard.js', 'sentences.js', 'styles.css']; // preflight: ok
// github.com appears in mine/ only inside the User-Agent contact text; it is never requested.
const MINE_HOSTS = new Set(['simple.wiktionary.org', 'en.wiktionary.org', 'github.com']);

test('the default page files name no host beyond the ones they already used', () => {
  for (const file of DEFAULT_PAGE_FILES) {
    for (const host of hostsIn(read(file))) assert.ok(DEFAULT_PAGE_HOSTS.has(host), `${file} names ${host}`);
  }
});

test('default mode loads only the tiny config file from mine/; the rest is imported only for ?mode=mine', () => {
  const app = read('app.js');
  const staticImports = [...app.matchAll(/^import .* from '(\.\/mine\/[^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(staticImports, ['./mine/config.js']);
  const dynamic = [...app.matchAll(/import\('\.\/mine\/([^']+)'\)/g)].map(m => m[1]);
  assert.deepEqual(dynamic, ['ui.js']);
  assert.match(app, /if\(MINE_ENABLED&&new URLSearchParams\(location\.search\)\.get\('mode'\)==='mine'\)\{try\{mine=await import/); // preflight: ok
  assert.equal(/^import /m.test(read('mine/config.js')), false, 'config.js imports nothing');
});

test('mine/ names no host beyond the two dictionary hosts, and makes no request to a literal URL', () => {
  for (const file of mineFiles) {
    const text = read(file);
    for (const host of hostsIn(text)) assert.ok(MINE_HOSTS.has(host), `${file} names ${host}`);
    assert.equal(/fetch(Fn)?\(\s*['"`]https?:/.test(text), false, `${file} fetches a literal URL`);
  }
  assert.equal((read('mine/lookup.js').match(/https:\/\/\$\{host\}/g) || []).length, 2, 'two templated URLs, both built from HOSTS'); // preflight: ok
});

test('mine/ uses no way to send data or run text as code', () => {
  const banned = [/XMLHttpRequest/, /WebSocket/, /sendBeacon/, /new Image\(/, /importScripts/, /\beval\(/, /new Function/, // preflight: ok
    /innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /\bimport\(/, /EventSource/, /postMessage/];
  for (const file of mineFiles) {
    const text = read(file);
    for (const re of banned) assert.equal(re.test(text), false, `${file} uses ${re}`);
  }
});

test('mine/ never touches the default history or stars keys, except to map the stars key', () => {
  for (const file of mineFiles) {
    const text = read(file);
    assert.equal(text.includes('bee-ready-history-v2'), false, `${file} names the default history key`);
    if (file !== 'mine/lists.js') assert.equal(text.includes('bee-ready-starred-v1'), false, `${file} names the default stars key`); // preflight: ok
  }
  assert.equal(read('app.js').includes("mine?'bee-ready-mine-history-v1':'bee-ready-history-v2'"), true);
  assert.match(read('app.js'), /mine\?mine\.starsStorage\(localStorage\):localStorage/);
});

test('a dictionary request starts only from the "Look up the missing words" button, and only if the switches are on', () => { // preflight: ok
  const ui = read('mine/ui.js');
  assert.equal((ui.match(/lookupMissing\(/g) || []).length, 1, 'one call site');
  assert.match(ui, /async function onLookup\(\) \{[\s\S]*?await lookupMissing\(/);
  assert.match(ui, /\$\('mineLookup'\)\.addEventListener\('click', onLookup\)/);
  assert.match(ui, /LIVE_LOOKUP_ENABLED && state\.settings\.liveLookup/);
  for (const file of mineFiles.filter(f => f !== 'mine/ui.js' && f !== 'mine/lookup.js')) {
    assert.equal(/lookupMissing|lookupOne/.test(read(file)), false, `${file} must not start a lookup`);
  }
  assert.equal(/lookupMissing|lookupOne/.test(read('mine/import.js')), false, 'checking words never calls the dictionary'); // preflight: ok
});

test('the kill switches exist and their shipped values are as documented', () => {
  const config = read('mine/config.js');
  for (const name of ['MINE_ENABLED', 'LIVE_LOOKUP_ENABLED', 'OCR_ENABLED']) assert.match(config, new RegExp(`export const ${name} =`)); // preflight: ok
  assert.match(config, /export const OCR_ENABLED = true;/, 'photo import ships with Phase 2');
  assert.match(config, /export const MINE_ENABLED = true;/);
  assert.match(config, /export const LIVE_LOOKUP_ENABLED = true;/);
});

test('the page tells grown-ups what is sent, where, and how to turn it off', () => {
  const html = read('index.html');
  assert.match(html, /Ask a grown-up before you press this/);
  assert.match(html, /sends the words that were not found, and this device's IP address, to Wiktionary/);
  assert.match(html, /first letter of each word you check/);
  assert.match(html, /id="mineLookup"[^>]*aria-describedby="mineDisclosure"/);
  assert.match(html, /id="mineLive"/);
  assert.match(html, /If a grown-up uses "Look up the missing words" in My words, those words and the IP address go to Wiktionary/); // preflight: ok
});

test('a grown-up must confirm before the first Wikimedia request, and custom words never reach the site host as clip names', () => { // preflight: ok
  const ui = read('mine/ui.js');
  assert.match(ui, /async function onLookup\(\) \{[\s\S]*?if \(!confirm\(CONFIRM_LOOKUP\)\)[\s\S]*?await lookupMissing\(/); // preflight: ok
  assert.match(ui, /installClipGuard\(globalThis, allowedClipKeys\(defaultWords/);
  assert.match(read('mine/lookup.js'), /referrerPolicy: 'no-referrer'/);
  assert.match(read('mine/lookup.js'), /credentials: 'omit'/);
});

test('a failed My words load is visible, and a share link is taken out of the address bar', () => {
  const app = read('app.js');
  assert.match(app, /console\.error\('My words could not load'/);
  assert.match(app, /function writeHistory\(\)\{\s*try\{if\(!mineFailed\)localStorage\.setItem\(historyKey/);
  assert.match(app, /return mineFailed\?NO_SAVE:mine\?mine\.starsStorage/);
  assert.match(app, /if\(mineFailed\)\$\('roundBuilder'\)\.insertAdjacentHTML\([^)]*My words could not load/);
  assert.match(app, /history\.replaceState\(null,'',location\.pathname\+location\.search\)/);
});

test('photo import reads on the device from this site only, and keeps nothing', () => {
  const code = read('mine/ocr.js').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of [/https?:\/\//, /localStorage/, /sessionStorage/, /indexedDB/, /createObjectURL/, /fetch\(/, /XMLHttpRequest/]) { // preflight: ok
    assert.equal(banned.test(code), false, `mine/ocr.js uses ${banned}`);
  }
  assert.match(code, /workerBlobURL: false/);
  assert.match(code, /cacheMethod: 'none'/);
  assert.match(code, /workerPath: at\('worker\.min\.js'\), corePath: at\('core\/'\), langPath: at\('lang\/'\)/);
  assert.match(code, /new URL\(path, base\)\.href/);
  assert.match(code, /state\.canvas\.width = 0; state\.canvas\.height = 0;/);
  const ui = read('mine/ui.js');
  assert.match(ui, /\$\('minePhotoBlock'\)\.hidden = !OCR_ENABLED/);
  assert.match(ui, /new URL\(OCR_DIR, document\.baseURI\)\.href/);
  assert.match(read('index.html'), /This page never sends or saves the picture\./);
  assert.match(read('index.html'), /may stay in your phone's own photo gallery/);
  assert.match(read('index.html'), /The first picture downloads about 7 MB from this site\./);
  assert.match(ui, /console\.warn\('My words photo import failed:', error\?\.name, error\?\.message\)/);
  assert.equal(/console\.[a-z]+\([^)]*file/.test(ui.slice(ui.indexOf('async function onPhoto'), ui.indexOf('// ---- list actions'))), false, 'the log never names the file'); // preflight: ok
});
