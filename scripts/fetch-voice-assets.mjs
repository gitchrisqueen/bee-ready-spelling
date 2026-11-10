// Downloads the pinned Kokoro model files into <outDir>/voice-assets so the site can
// serve them from its own origin. Run after `npm run build` (which recreates _site/).
// Every file is checked against a pinned size and SHA-256; any mismatch fails the run.
// Each file gets up to three attempts with a per-attempt timeout and a growing pause between
// attempts, and a download is cut off as soon as it delivers more bytes than the pinned size.
// A file that is already on disk (for example restored from the deploy cache) is re-hashed and
// only kept when it matches, so a tampered cache fails closed and the file is downloaded again.
import { createHash } from 'node:crypto';
import {
  createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const FILES = [
  ['config.json', 44, 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f'],
  ['tokenizer.json', 3497, '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'],
  ['tokenizer_config.json', 113, 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20'],
  ['onnx/model_quantized.onnx', 92361116, 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'],
  ['voices/af_heart.bin', 522240, 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'],
  ['voices/af_bella.bin', 522240, 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'],
  ['voices/am_michael.bin', 522240, '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'],
  ['voices/am_fenrir.bin', 522240, 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43'],
];

// Tesseract.js, for "My words" photo import (docs/my-words-plan.md). Served from this site so the page asks no one else.
// Pinned by exact package version, with size and SHA-256 checked like the model files. All Apache-2.0.
// [path under voice-assets/ocr/, URL, size in bytes, SHA-256]
const NPM = 'https://cdn.jsdelivr.net/npm';
const OCR_FILES = [
  ['tesseract.min.js', `${NPM}/tesseract.js@7.0.0/dist/tesseract.min.js`, 62961,
    '000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e'],
  ['worker.min.js', `${NPM}/tesseract.js@7.0.0/dist/worker.min.js`, 111307,
    '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d'],
  ['core/tesseract-core-relaxedsimd-lstm.wasm.js', `${NPM}/tesseract.js-core@7.0.0/tesseract-core-relaxedsimd-lstm.wasm.js`, // preflight: ok
    3905767, '861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3'],
  ['core/tesseract-core-simd-lstm.wasm.js', `${NPM}/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js`,
    3899472, 'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38'],
  ['core/tesseract-core-lstm.wasm.js', `${NPM}/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js`,
    3896484, 'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680'],
  ['lang/eng.traineddata.gz', `${NPM}/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz`,
    2952873, '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91'],
];

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
const BIG_FILE_BYTES = 10 * 1048576;
const BIG_TIMEOUT_MS = 300_000;
const SMALL_TIMEOUT_MS = 60_000;

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

// Passes bytes through and fails the stream once more than `limit` bytes have arrived.
function byteLimit(limit, name) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length;
      if (seen > limit) callback(new Error(`${name}: more than the pinned ${limit} bytes arrived`));
      else callback(null, chunk);
    },
  });
}

async function downloadOnce(url, partial, name, size, expected) {
  const timeout = size > BIG_FILE_BYTES ? BIG_TIMEOUT_MS : SMALL_TIMEOUT_MS;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body), byteLimit(size, name), createWriteStream(partial));
  const got = statSync(partial).size;
  if (got !== size) throw new Error(`Size mismatch for ${name}: expected ${size}, got ${got}`);
  const actual = await sha256(partial);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${name}: expected ${expected}, got ${actual}`);
}

async function download(url, target, name, size, expected) {
  const partial = `${target}.part`;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await downloadOnce(url, partial, name, size, expected);
      renameSync(partial, target);
      return;
    } catch (error) {
      lastError = error;
      rmSync(partial, { force: true });
      console.warn(`attempt ${attempt}/${MAX_ATTEMPTS} failed for ${name}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

const outDir = resolve(process.argv[2] ?? '_site');
const modelDir = join(outDir, 'voice-assets', 'models', MODEL);
// `--only-ocr` fetches just the photo-import files (for local testing); the deploy fetches everything.
const onlyOcr = process.argv.includes('--only-ocr');

for (const [name, size, expected] of onlyOcr ? [] : FILES) {
  const target = join(modelDir, name);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && (await sha256(target)) === expected) {
    console.log(`ok (cached)  ${name}`);
    continue;
  }
  rmSync(target, { force: true });
  await download(`https://huggingface.co/${MODEL}/resolve/${REVISION}/${name}`, target, name, size, expected);
  console.log(`ok (${(size / 1048576).toFixed(1)} MB)  ${name}`);
}

const ocrDir = join(outDir, 'voice-assets', 'ocr');
for (const [name, url, size, expected] of OCR_FILES) {
  const target = join(ocrDir, name);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && (await sha256(target)) === expected) {
    console.log(`ok (cached)  ocr/${name}`);
    continue;
  }
  rmSync(target, { force: true });
  await download(url, target, `ocr/${name}`, size, expected);
  console.log(`ok (${(size / 1048576).toFixed(1)} MB)  ocr/${name}`);
}

writeFileSync(
  join(outDir, 'voice-assets', 'NOTICE.txt'),
  `Kokoro-82M ONNX model files (${MODEL}), revision ${REVISION}.\n` +
    `Licensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0\n` +
    `Source: https://huggingface.co/${MODEL}\n` +
    `Files are served unmodified from this site so that voices load from one place.\n\n` +
    `Tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (voice-assets/ocr/), and the English model\n` +
    `@tesseract.js-data/eng 1.0.0 (tessdata_best_int, 4.0.0), used to read a photo of a word list on the device.\n` +
    `Licensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0\n` +
    `Sources: https://github.com/naptha/tesseract.js, https://github.com/tesseract-ocr/tessdata_best\n` +
    `Files are served unmodified from this site; nothing is sent to anyone else.\n`,
);
console.log(`Voice assets ready in ${join(outDir, 'voice-assets')}`);
