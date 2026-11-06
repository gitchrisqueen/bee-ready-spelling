// Downloads the pinned Kokoro model files into <outDir>/voice-assets so the site can
// serve them from its own origin. Run after `npm run build` (which recreates _site/).
// Every file is checked against a pinned size and SHA-256; any mismatch fails the run.
import { createHash } from 'node:crypto';
import {
  createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
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

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

const outDir = resolve(process.argv[2] ?? '_site');
const modelDir = join(outDir, 'voice-assets', 'models', MODEL);

for (const [name, size, expected] of FILES) {
  const target = join(modelDir, name);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && (await sha256(target)) === expected) {
    console.log(`ok (cached)  ${name}`);
    continue;
  }
  const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${name}`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const partial = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  if (statSync(partial).size !== size) throw new Error(`Size mismatch for ${name}: expected ${size}, got ${statSync(partial).size}`);
  const actual = await sha256(partial);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${name}: expected ${expected}, got ${actual}`);
  renameSync(partial, target);
  console.log(`ok (${(size / 1048576).toFixed(1)} MB)  ${name}`);
}

writeFileSync(
  join(outDir, 'voice-assets', 'NOTICE.txt'),
  `Kokoro-82M ONNX model files (${MODEL}), revision ${REVISION}.\n` +
    `Licensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0\n` +
    `Source: https://huggingface.co/${MODEL}\n` +
    `Files are served unmodified from this site so that voices load from one place.\n`,
);
console.log(`Voice assets ready in ${join(outDir, 'voice-assets')}`);
