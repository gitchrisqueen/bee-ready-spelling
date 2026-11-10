// Photo import (docs/my-words-plan.md). A photo of a word list is read on the device with Tesseract.js. The OCR files
// are served from this site (see scripts/fetch-voice-assets.mjs), so no one else is asked, and the picture is never
// uploaded or saved: it is drawn to a canvas, read, and the canvas is shrunk to nothing when the read finishes.
// This module has no access to storage and creates no object URLs.
import { parseWords } from './validate.js';

export const OCR_DIR = './voice-assets/ocr/';
export const MAX_SIDE = 2000;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 80000000;
export const READ_TIMEOUT_MS = 120000;

// Every Tesseract.js path is set to this site (all three default to a CDN), no blob: worker is needed, and the library
// keeps nothing in IndexedDB.
export function ocrOptions(base) {
  const at = path => new URL(path, base).href;
  return {
    workerPath: at('worker.min.js'), corePath: at('core/'), langPath: at('lang/'),
    gzip: true, cacheMethod: 'none', workerBlobURL: false,
  };
}

// Loads tesseract.min.js (a same-origin script) once and returns the global it defines.
export function loadTesseract(doc, base) {
  const scope = doc.defaultView;
  if (scope.Tesseract) return Promise.resolve(scope.Tesseract);
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = new URL('tesseract.min.js', base).href;
    script.onload = () => (scope.Tesseract ? resolve(scope.Tesseract) : reject(new Error('OCR library did not start')));
    script.onerror = () => reject(new Error('OCR library did not load'));
    doc.head.append(script);
  });
}

export function fitSize(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// RGBA bytes -> one grey byte per pixel.
export function toGray(rgba, width, height) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return gray;
}

// Evens out uneven lighting (a phone photo of a page): the paper level is estimated per block as the brightness that
// 95 percent of its pixels do not exceed, smoothed, spread to every pixel, and each pixel is divided by it. Plain
// contrast stretching and a global threshold did not fix this in the spike (docs/my-words-phase0-findings.md).
export function flattenIllumination(gray, width, height, block = 24) {
  const gx = Math.max(1, Math.ceil(width / block)), gy = Math.max(1, Math.ceil(height / block));
  let grid = new Float32Array(gx * gy);
  for (let by = 0; by < gy; by++) {
    for (let bx = 0; bx < gx; bx++) {
      const hist = new Uint32Array(256);
      let count = 0;
      for (let y = by * block; y < Math.min(height, (by + 1) * block); y++) {
        for (let x = bx * block; x < Math.min(width, (bx + 1) * block); x++) { hist[gray[y * width + x]]++; count++; }
      }
      let seen = 0, level = 255;
      for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= count * 0.95) { level = v; break; } }
      grid[by * gx + bx] = Math.max(level, 1);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(grid.length);
    for (let y = 0; y < gy; y++) {
      for (let x = 0; x < gx; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < gx && yy < gy) { sum += grid[yy * gx + xx]; n++; }
          }
        }
        next[y * gx + x] = sum / n;
      }
    }
    grid = next;
  }
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(gy - 1, Math.max(0, (y + 0.5) / block - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gy - 1, y0 + 1); // preflight: ok
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(gx - 1, Math.max(0, (x + 0.5) / block - 0.5)), x0 = Math.floor(fx), x1 = Math.min(gx - 1, x0 + 1); // preflight: ok
      const tx = fx - x0;
      const top = grid[y0 * gx + x0] * (1 - tx) + grid[y0 * gx + x1] * tx;
      const bottom = grid[y1 * gx + x0] * (1 - tx) + grid[y1 * gx + x1] * tx;
      const background = top * (1 - ty) + bottom * ty;
      out[y * width + x] = Math.min(255, (gray[y * width + x] / background) * 255);
    }
  }
  return out;
}

// OCR text -> words, through the same validator as typed text. List numbers ("1." or "a)") are dropped, and so are
// single letters (stray marks). Headings and anything else that is not a word stay for the review screen to remove.
export function wordsFromOcrText(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.replace(/^\s*(?:\d{1,3}|[A-Za-z])\s*[.):-]\s+/, ''));
  const parsed = parseWords(lines.join('\n'));
  return { ...parsed, words: parsed.words.filter(w => Array.from(w).length >= 2) };
}

// Reads a photo. `env` supplies the browser pieces (so tests can fake them): createImageBitmap, makeCanvas,
// loadTesseract and the Tesseract options. The bitmap is closed, the canvas is set to 0 by 0, and the worker is
// stopped whether the read works, fails or runs out of time (READ_TIMEOUT_MS).
export async function readPhoto(file, env, { onStage = () => {}, timeoutMs = READ_TIMEOUT_MS } = {}) {
  const state = { bitmap: null, canvas: null, worker: null, finished: false };
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The picture took too long to read.')), timeoutMs);
  });
  const work = run(file, env, onStage, state);
  work.catch(() => {}); // a read that is still running when the time is up is stopped below; its error is not needed
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    state.finished = true;
    state.bitmap?.close?.();
    if (state.canvas) { state.canvas.width = 0; state.canvas.height = 0; }
    try { await state.worker?.terminate(); } catch { /* already stopped */ }
  }
}

async function run(file, env, onStage, state) {
  onStage('opening');
  const bitmap = await env.createImageBitmap(file);
  state.bitmap = bitmap;
  if (state.finished) { bitmap.close?.(); throw new Error('The read was stopped.'); }
  if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('The picture is too large.');
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = env.makeCanvas();
  state.canvas = canvas;
  if (state.finished) { canvas.width = 0; canvas.height = 0; throw new Error('The read was stopped.'); }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const flat = flattenIllumination(toGray(image.data, width, height), width, height);
  for (let i = 0; i < flat.length; i++) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = flat[i];
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  onStage('loading');
  const tesseract = await env.loadTesseract();
  const worker = await tesseract.createWorker('eng', 1, env.options);
  state.worker = worker;
  // A worker that finished starting after the time was up is stopped here, because the caller has already cleaned up.
  if (state.finished) { await worker.terminate(); throw new Error('The read was stopped.'); }
  onStage('reading');
  // A single block first (lists are usually one block); automatic layout only if that finds nothing.
  let result = null;
  for (const mode of ['6', '3']) {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const { data } = await worker.recognize(canvas);
    result = wordsFromOcrText(data.text);
    if (result.words.length) break;
  }
  return result;
}
