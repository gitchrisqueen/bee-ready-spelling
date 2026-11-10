// My words, photo import: a picture is never persisted. Everything the browser would supply is faked, and the fakes
// record
// what the import touches: storage (localStorage and IndexedDB), object URLs, the canvas, the bitmap and the worker.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';
import { readPhoto } from '../mine/ocr.js';

const root = resolve(import.meta.dirname, '..');
before(() => setBlocklist(parseBlocklist(readFileSync(join(root, 'mine/filter.sha256'), 'utf8'))));

function makeWorld({ text = '1. apple\n2. banana\nSpelling words\n', failRead = false, failLoad = false } = {}) {
  const log = { storageWrites: 0, idbOpens: 0, objectUrls: 0, revoked: 0, canvases: [], bitmaps: [], workers: [], modes: [] }; // preflight: ok
  const recorder = new Proxy({}, { get: (_t, name) => (...args) => { if (/^(setItem|removeItem|clear)$/.test(String(name))) log.storageWrites++; return null; } }); // preflight: ok
  const saved = {
    localStorage: globalThis.localStorage, indexedDB: globalThis.indexedDB,
    create: URL.createObjectURL, revoke: URL.revokeObjectURL,
  };
  globalThis.localStorage = recorder;
  globalThis.indexedDB = { open: () => { log.idbOpens++; throw new Error('IndexedDB must not be used'); } };
  URL.createObjectURL = () => { log.objectUrls++; return 'blob:x'; };
  URL.revokeObjectURL = () => { log.revoked++; };
  const env = {
    createImageBitmap: async () => { const b = { width: 3000, height: 2000, closed: false, close() { this.closed = true; } }; log.bitmaps.push(b); return b; }, // preflight: ok
    makeCanvas: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({
          drawImage() {},
          getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) }),
          putImageData() {},
        }),
      };
      log.canvases.push(canvas);
      return canvas;
    },
    loadTesseract: async () => {
      if (failLoad) throw new Error('library did not load');
      return {
        createWorker: async (lang, oem, options) => {
          const worker = {
            lang, oem, options, terminated: false,
            setParameters: async p => { log.modes.push(p.tessedit_pageseg_mode); },
            recognize: async canvas => { if (failRead) throw new Error('read failed'); worker.sawCanvas = canvas; return { data: { text } }; }, // preflight: ok
            terminate: async () => { worker.terminated = true; },
          };
          log.workers.push(worker);
          return worker;
        },
      };
    },
    options: { workerPath: 'https://example.github.io/x/worker.min.js', cacheMethod: 'none' },
  };
  const restore = () => {
    globalThis.localStorage = saved.localStorage; globalThis.indexedDB = saved.indexedDB;
    URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke;
  };
  return { env, log, restore };
}

test('a photo import writes nothing to localStorage or IndexedDB and creates no object URLs', async () => {
  const { env, log, restore } = makeWorld();
  try {
    const result = await readPhoto({ name: 'list.jpg', size: 1234 }, env);
    assert.deepEqual(result.words, ['apple', 'banana', 'spelling', 'words']);
  } finally { restore(); }
  assert.equal(log.storageWrites, 0, 'no localStorage write');
  assert.equal(log.idbOpens, 0, 'no IndexedDB use');
  assert.equal(log.objectUrls, log.revoked, 'every createObjectURL is matched by a revokeObjectURL');
  assert.equal(log.objectUrls, 0, 'and none is created at all');
});

test('the canvas is set to 0 by 0, the bitmap is closed and the worker is stopped when the import finishes', async () => { // preflight: ok
  const { env, log, restore } = makeWorld();
  try { await readPhoto({}, env); } finally { restore(); }
  assert.equal(log.canvases.length, 1);
  assert.equal(log.canvases[0].width, 0);
  assert.equal(log.canvases[0].height, 0);
  assert.equal(log.bitmaps[0].closed, true);
  assert.equal(log.workers[0].terminated, true);
  assert.equal(log.workers[0].lang, 'eng');
  assert.equal(log.workers[0].oem, 1);
  assert.equal(log.workers[0].options.cacheMethod, 'none');
});

test('the photo is drawn at no more than 2000 px on its long side before it is read', async () => {
  const { env, restore } = makeWorld();
  const sizes = [];
  const makeCanvas = env.makeCanvas;
  env.makeCanvas = () => {
    const c = makeCanvas();
    let w = 0, h = 0;
    Object.defineProperty(c, 'width', { get: () => w, set: v => { w = v; sizes.push(['w', v]); } });
    Object.defineProperty(c, 'height', { get: () => h, set: v => { h = v; sizes.push(['h', v]); } });
    return c;
  };
  try { await readPhoto({}, env); } finally { restore(); }
  assert.deepEqual(sizes.slice(0, 2), [['w', 2000], ['h', 1333]]);
  assert.deepEqual(sizes.slice(-2), [['w', 0], ['h', 0]]);
});

test('when the read fails everything is still released, and the error reaches the caller', async () => {
  const { env, log, restore } = makeWorld({ failRead: true });
  try { await assert.rejects(readPhoto({}, env), /read failed/); } finally { restore(); }
  assert.equal(log.canvases[0].width, 0);
  assert.equal(log.canvases[0].height, 0);
  assert.equal(log.bitmaps[0].closed, true);
  assert.equal(log.workers[0].terminated, true);
  assert.equal(log.storageWrites + log.idbOpens, 0);
});

test('when the OCR library cannot load, the canvas is still released', async () => {
  const { env, log, restore } = makeWorld({ failLoad: true });
  try { await assert.rejects(readPhoto({}, env), /did not load/); } finally { restore(); }
  assert.equal(log.canvases[0].width, 0);
  assert.equal(log.bitmaps[0].closed, true);
  assert.equal(log.workers.length, 0);
});

test('a single block is tried first, and automatic layout only if it finds no words', async () => {
  const one = makeWorld({ text: 'apple\n' });
  try { await readPhoto({}, one.env); } finally { one.restore(); }
  assert.deepEqual(one.log.modes, ['6']);
  const none = makeWorld({ text: '| |\n' });
  let result;
  try { result = await readPhoto({}, none.env); } finally { none.restore(); }
  assert.deepEqual(none.log.modes, ['6', '3']);
  assert.deepEqual(result.words, []);
});

test('stages are reported in order', async () => {
  const { env, restore } = makeWorld();
  const stages = [];
  try { await readPhoto({}, env, { onStage: s => stages.push(s) }); } finally { restore(); }
  assert.deepEqual(stages, ['opening', 'loading', 'reading']);
});
