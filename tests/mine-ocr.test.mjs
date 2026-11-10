// My words, photo import: the image maths, the words read from OCR text, the same-origin options, and the pinned OCR
// files.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';
import { OCR_DIR, fitSize, flattenIllumination, loadTesseract, ocrOptions, toGray, wordsFromOcrText } from '../mine/ocr.js'; // preflight: ok

const root = resolve(import.meta.dirname, '..');
const read = name => readFileSync(join(root, name), 'utf8');
before(() => setBlocklist(parseBlocklist(read('mine/filter.sha256'))));

test('big photos are scaled down to 2000 px on the long side, small ones are left alone', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(fitSize(3000, 4000), { width: 1500, height: 2000 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(1, 1), { width: 1, height: 1 });
  assert.deepEqual(fitSize(100000, 1), { width: 2000, height: 1 }, 'never below 1 px');
});

test('toGray uses the usual luminance weights', () => {
  const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 4, 1);
  assert.deepEqual([...g], [76, 150, 29, 255]);
});

// A page photographed in uneven light: white paper that is bright on the left and dim on the right, with dark "text"
// bars.
function makePhoto(width, height) {
  const gray = new Uint8ClampedArray(width * height);
  const bar = (x, y) => y % 40 > 14 && y % 40 < 24 && x > 30 && x < width - 30 && (x % 9) < 6;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const light = 250 - (130 * x) / width;
      gray[y * width + x] = bar(x, y) ? light * 0.3 : light;
    }
  }
  return { gray, bar };
}

test('flattening evens out uneven light: the paper level is the same across the page', () => {
  const w = 300, h = 200;
  const { gray, bar } = makePhoto(w, h);
  const flat = flattenIllumination(gray, w, h);
  const paper = (data, x0, x1) => {
    let sum = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (!bar(x, y) && y % 40 < 12) { sum += data[y * w + x]; n++; } // preflight: ok
    return sum / n;
  };
  const before = [paper(gray, 0, 60), paper(gray, w - 60, w)];
  const after = [paper(flat, 0, 60), paper(flat, w - 60, w)];
  assert.ok(before[0] - before[1] > 80, `the photo starts uneven: ${before}`);
  assert.ok(Math.abs(after[0] - after[1]) < 16, `the paper levels end up close (they began 80 or more apart): ${after}`); // preflight: ok
  assert.ok(after[0] > 235 && after[1] > 235, 'paper is near white everywhere');
});

test('flattening keeps the text dark and handles tiny, blank and one-pixel images', () => {
  const w = 300, h = 200;
  const { gray, bar } = makePhoto(w, h);
  const flat = flattenIllumination(gray, w, h);
  let darkest = 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bar(x, y)) darkest = Math.min(darkest, flat[y * w + x]);
  assert.ok(darkest < 120, `text stays dark: ${darkest}`);
  assert.equal(flattenIllumination(new Uint8ClampedArray([77]), 1, 1).length, 1);
  const blank = flattenIllumination(new Uint8ClampedArray(50 * 50).fill(200), 50, 50);
  assert.ok(blank.every(v => v >= 250), 'a blank sheet becomes white');
  assert.equal(flattenIllumination(new Uint8ClampedArray(0), 0, 0).length, 0);
});

test('words from OCR text: list numbers and stray letters go, junk and unsafe words are left for review or removed', () => { // preflight: ok
  const r = wordsFromOcrText('Spelling Words\n1. abdicate\n2) benevolent\na. cemetery\n  3 - deficit\nx\n| |\n4. ab3d\n'); // preflight: ok
  assert.deepEqual(r.words, ['spelling', 'words', 'abdicate', 'benevolent', 'cemetery', 'deficit']);
  assert.equal(r.rejected.length >= 1, true, 'a token with a digit inside is rejected');
  assert.deepEqual(wordsFromOcrText('').words, []);
  assert.deepEqual(wordsFromOcrText(undefined).words, []);
  assert.deepEqual(wordsFromOcrText('apple, banana apple').words, ['apple', 'banana'], 'duplicates go');
  const many = wordsFromOcrText(Array.from({ length: 300 }, (_, i) => `w${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}zz`).join('\n')); // preflight: ok
  assert.equal(many.words.length, 200);
  assert.equal(many.truncated, true);
});

test('every OCR path is on this site, there is no blob worker and nothing is cached by the library', () => {
  const base = 'https://example.github.io/bee-ready-spelling/';
  const o = ocrOptions(new URL(OCR_DIR, base).href);
  for (const key of ['workerPath', 'corePath', 'langPath']) {
    assert.ok(o[key].startsWith('https://example.github.io/bee-ready-spelling/voice-assets/ocr/'), `${key}: ${o[key]}`);
  }
  assert.equal(o.workerPath.endsWith('worker.min.js'), true);
  assert.equal(o.corePath.endsWith('/core/'), true);
  assert.equal(o.langPath.endsWith('/lang/'), true);
  assert.equal(o.workerBlobURL, false);
  assert.equal(o.cacheMethod, 'none');
  assert.equal(o.gzip, true);
});

test('loadTesseract adds one same-origin script and reuses the library once it is there', async () => {
  const appended = [];
  const scope = {};
  const doc = {
    defaultView: scope,
    createElement: () => ({}),
    head: { append: s => { appended.push(s); scope.Tesseract = { createWorker() {} }; s.onload(); } },
  };
  const base = 'https://example.github.io/bee-ready-spelling/voice-assets/ocr/';
  const first = await loadTesseract(doc, base);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, `${base}tesseract.min.js`);
  assert.equal(await loadTesseract(doc, base), first);
  assert.equal(appended.length, 1);
  const failing = { defaultView: {}, createElement: () => ({}), head: { append: s => s.onerror() } };
  await assert.rejects(loadTesseract(failing, base), /did not load/);
});

// ---- the deploy-time fetch of the OCR files ----
const script = read('scripts/fetch-voice-assets.mjs');
const BASES = Object.fromEntries([...script.matchAll(/const (NPM|JS|CORE|LANG) = ([^;]+);/g)].map(m => [m[1], m[2]]));
const expand = text => text.replace(/\$\{(\w+)\}/g, (_m, k) => expand(BASES[k].replace(/^[`']|[`']$/g, '')));
const ROWS = [...script.matchAll(/\['((?:core\/|lang\/)?[\w.-]+)', `([^`]+)`,\s*(\d+),\s*'([0-9a-f]{64})'\]/g)]
  .map(m => ({ path: m[1], url: expand(m[2]), size: Number(m[3]), sha: m[4] }));

test('the fetch script pins every OCR file by exact version, size and SHA-256', () => {
  assert.deepEqual(ROWS.map(r => r.path), [
    'tesseract.min.js', 'worker.min.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js', 'lang/eng.traineddata.gz',
  ]);
  for (const r of ROWS) {
    assert.match(r.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:tesseract\.js@7\.0\.0|tesseract\.js-core@7\.0\.0|@tesseract\.js-data\/eng@1\.0\.0)\//, r.url); // preflight: ok
    assert.ok(Number.isInteger(r.size) && r.size > 0 && r.size < 5e6, r.path);
  }
  assert.match(script, /const NPM = 'https:\/\/cdn\.jsdelivr\.net\/npm';/);
  assert.match(script, /process\.argv\.includes\('--only-ocr'\)/);
  assert.match(script, /existsSync\(target\) && \(await sha256\(target\)\) === expected/);
});

test('docs/my-words-plan.md lists the same OCR files, sizes and hashes as the script', () => {
  const plan = read('docs/my-words-plan.md');
  for (const r of ROWS) {
    assert.ok(plan.includes(r.sha), `${r.path}: SHA-256 in the plan`);
    assert.ok(plan.includes(r.size.toLocaleString('en-US')), `${r.path}: size in the plan`);
  }
});

test('the deploy notice credits Tesseract.js and its Apache-2.0 licence', () => {
  assert.match(script, /Tesseract\.js 7\.0\.0 and tesseract\.js-core 7\.0\.0/);
  assert.match(script, /@tesseract\.js-data\/eng 1\.0\.0/);
  assert.match(script, /Licensed under the Apache License 2\.0/);
});

test('README lists exactly the OCR files the script fetches, and says how a failed read is diagnosed', () => {
  const readme = read('README.md');
  const line = readme.match(/for f in ([^;]+); do curl/)?.[1].split(' ') ?? [];
  assert.deepEqual(line, ROWS.map(r => r.path));
  assert.match(readme, /My words photo import failed:/);
  assert.match(readme, /does not stop the deploy from fetching the OCR files/);
  assert.match(read('docs/my-words-plan.md'), /does not stop the deploy from fetching the OCR files/);
});
