// Generates pre-recorded MP3 clips for every word (and the voice sample) with Kokoro.
//
//   node generate.mjs [--voice af_heart] [--limit 10] [--redo key1,key2]
//                     [--prune [--force-prune]] [--dry-run]
//
// --redo re-records the named clips (a clip key is the lowercase word, see clipKey).
// --dry-run prints how many clips each voice still needs, without loading the model.
//
// Incremental: a clip is regenerated only when its text, voice, model revision or encoder
// label changes, so adding words to words.json only generates the new ones.
// Output: <repo>/clips/<kokoro voice>/<clipKey>.mp3 plus clips/<voice>/manifest.json.
// Requires ffmpeg (with libmp3lame) on PATH.
//
// Safety: the model is fetched at one pinned Hugging Face revision and its SHA-256 is checked
// before anything is generated. One bad word never stops the run; failures are listed at the
// end and the exit code is 1 so CI shows red, but every good clip is still written.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KokoroTTS } from 'kokoro-js';
import { PREVIEW_TEXT, VOICES, clipKey } from '../../voice-service.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const MODEL_SHA256 = 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478';
// Bump this label whenever FILTER, FFMPEG_ARGS, DTYPE, SPEED or kokoro-js changes, to regenerate all clips.
const ENCODER = 'mp3-mono-40k-trim-v2';
const FILTER =
  'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-50dB,areverse,' +
  'silenceremove=start_periods=1:start_silence=0.08:start_threshold=-50dB,areverse';
const FFMPEG_ARGS = ['-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '40k'];
const DTYPE = 'q8';
const SPEED = 1;
const MIN_CLIP_BYTES = 1200;
const MAX_PRUNE_FRACTION = 0.05;

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => (flag(name) ? args[args.indexOf(`--${name}`) + 1] : null);

const root = resolve(import.meta.dirname, '..', '..');
const words = JSON.parse(readFileSync(join(root, 'words.json'), 'utf8'));
const texts = [...words.map(w => w.word), PREVIEW_TEXT];

// Two different words must never share a file name.
const owners = new Map();
for (const text of texts) {
  const key = clipKey(text);
  if (owners.has(key) && owners.get(key) !== text) {
    throw new Error(`Clip name collision: "${owners.get(key)}" and "${text}" both map to "${key}"`);
  }
  owners.set(key, text);
}

const wanted = option('voice') ? VOICES.filter(v => v.kokoro === option('voice')) : VOICES;
if (!wanted.length) throw new Error(`Unknown voice: ${option('voice')}`);
const redo = new Set((option('redo') ?? '').split(',').map(k => k.trim()).filter(Boolean));
for (const key of redo) {
  if (!/^[a-z0-9_-]+$/.test(key)) throw new Error(`--redo: "${key}" is not a clip key`);
  if (!owners.has(key)) console.warn(`--redo: no word or sample has the key "${key}"`);
}
let limit = Infinity;
if (flag('limit')) {
  limit = Number(option('limit'));
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit needs a whole number of 1 or more');
}

const kokoroVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, 'node_modules', 'kokoro-js', 'package.json'), 'utf8'),
).version;
const settingsDigest = createHash('sha256')
  .update(JSON.stringify({ ENCODER, FILTER, FFMPEG_ARGS, DTYPE, SPEED, MODEL_REVISION, kokoroVersion }))
  .digest('hex');
const settingsPath = join(root, 'clips', 'settings.json');
if (existsSync(settingsPath)) {
  const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
  if (saved.encoder === ENCODER && saved.digest !== settingsDigest) {
    throw new Error(
      'Generator settings (filter, ffmpeg flags, dtype, speed, model revision or kokoro-js version) changed ' +
        `but ENCODER is still "${ENCODER}". Bump ENCODER in generate.mjs so every clip is regenerated.`,
    );
  }
}

const fingerprint = (text, voice) =>
  createHash('sha256').update(`${text}|${voice}|${MODEL_REVISION}|${ENCODER}`).digest('hex').slice(0, 16);

if (flag('dry-run')) {
  for (const { kokoro: voice } of wanted) {
    const dir = join(root, 'clips', voice);
    const manifestPath = join(dir, 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
    const todo = texts.filter(text => {
      const key = clipKey(text);
      return redo.has(key) || !(manifest[key] === fingerprint(text, voice) && existsSync(join(dir, `${key}.mp3`)));
    });
    const keep = new Set(texts.map(clipKey));
    const stale = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.mp3') && !keep.has(n.slice(0, -4))).length : 0;
    console.log(`${voice}: ${todo.length} clip(s) to generate, ${stale} stale clip(s) a --prune run would delete`);
  }
  process.exit(0);
}

// kokoro-js asks Hugging Face for "main". Ask for the pinned revision instead.
const realFetch = globalThis.fetch.bind(globalThis);
const FROM = `https://huggingface.co/${MODEL}/resolve/main/`;
const TO = `https://huggingface.co/${MODEL}/resolve/${MODEL_REVISION}/`;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  return realFetch(url?.startsWith(FROM) ? TO + url.slice(FROM.length) : input, init);
};

const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' });

const modelFile = join(
  import.meta.dirname, 'node_modules', '@huggingface', 'transformers', '.cache', MODEL, 'onnx', 'model_quantized.onnx',
);
if (!existsSync(modelFile)) throw new Error(`Cannot verify the model: ${modelFile} not found`);
const modelHash = createHash('sha256').update(readFileSync(modelFile)).digest('hex');
if (modelHash !== MODEL_SHA256) {
  throw new Error(`Model SHA-256 mismatch: expected ${MODEL_SHA256}, got ${modelHash}. Refusing to generate.`);
}

const work = mkdtempSync(join(tmpdir(), 'bee-clips-'));
const failures = [];

for (const { kokoro: voice } of wanted) {
  const dir = join(root, 'clips', voice);
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const save = () => {
    writeFileSync(manifestPath, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1) + '\n');
  };
  let made = 0;
  const started = Date.now();
  for (const text of texts) {
    const key = clipKey(text);
    const file = join(dir, `${key}.mp3`);
    const print = fingerprint(text, voice);
    if (!redo.has(key) && manifest[key] === print && existsSync(file)) continue;
    if (made >= limit) break;
    try {
      const wav = join(work, `${voice}.wav`);
      const audio = await tts.generate(text, { voice, speed: SPEED });
      await audio.save(wav);
      // Encode outside clips/ and copy in only after the clip is checked, so an interrupted run
      // can never leave a truncated file behind or overwrite a good clip with a bad one.
      const encoded = join(work, `${voice}.mp3`);
      rmSync(encoded, { force: true });
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-af', FILTER, ...FFMPEG_ARGS, encoded]);
      if (!existsSync(encoded) || statSync(encoded).size < MIN_CLIP_BYTES) throw new Error('clip is empty or too small');
      copyFileSync(encoded, file);
      manifest[key] = print;
      made++;
    } catch (err) {
      failures.push(`${voice}/${key}: ${err.message}`);
      console.error(`FAILED ${voice}/${key}: ${err.message}`);
    }
    if (made > 0 && made % 25 === 0) {
      save();
      console.log(`${voice}: ${made} new clips (${((Date.now() - started) / made / 1000).toFixed(2)} s each)`);
    }
  }
  save();
  if (flag('prune')) {
    const keep = new Set(texts.map(clipKey));
    const stale = readdirSync(dir).filter(n => n.endsWith('.mp3') && !keep.has(n.slice(0, -4)));
    const total = readdirSync(dir).filter(n => n.endsWith('.mp3')).length;
    if (stale.length > total * MAX_PRUNE_FRACTION && !flag('force-prune')) {
      // Do not stop the other voices or lose this run's work: record it and carry on without pruning.
      const message =
        `${voice}: refusing to prune ${stale.length} of ${total} clips (over ${MAX_PRUNE_FRACTION * 100}%). ` +
        'Check words.json, or re-run with --force-prune.';
      failures.push(message);
      console.error(`FAILED ${message}`);
    } else {
      for (const name of stale) {
        rmSync(join(dir, name));
        delete manifest[name.slice(0, -4)];
      }
      save();
    }
  }
  const mp3s = readdirSync(dir).filter(n => n.endsWith('.mp3'));
  const bytes = mp3s.reduce((sum, n) => sum + statSync(join(dir, n)).size, 0);
  console.log(`${voice}: generated ${made}, ${mp3s.length} clips, ${(bytes / 1048576).toFixed(1)} MB`);
}

mkdirSync(join(root, 'clips'), { recursive: true });
writeFileSync(
  settingsPath,
  JSON.stringify({ encoder: ENCODER, digest: settingsDigest, kokoroJs: kokoroVersion, modelRevision: MODEL_REVISION }, null, 1) + '\n',
);
rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`${failures.length} clip(s) failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
}
