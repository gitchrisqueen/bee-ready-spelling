// Generates pre-recorded MP3 clips for every word, its practice sentence, and the voice sample, with Kokoro.
//
//   node generate.mjs [--voice af_heart] [--limit 10] [--redo key1,key2]
//                     [--prune [--force-prune]] [--dry-run] [--max-minutes 280]
//
// --redo re-records the named clips (a key is the lowercase word, or `sentence_<hash>`; see clipKey and sentenceKey).
// --dry-run prints how many clips each voice still needs, without loading the model.
// --max-minutes stops cleanly between clips after that long (progress is saved, exit code 1: run again).
//
// Incremental: a clip is regenerated only when its text, voice, model revision, encoder
// label or the word's optional `say` (IPA override, see say.js) changes, so adding words to
// words.json only generates the new ones.
// Output: <repo>/clips/<kokoro voice>/<key>.mp3 plus clips/<voice>/manifest.json.
// Each word gets a word clip and a sentence clip (the "In a sentence" clue); the voice sample is one more clip.
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
import { PREVIEW_TEXT, VOICES, clipKey, sentenceKey } from '../../voice-service.js';
import { sentenceFor } from '../../sentences.js';
import { clipFingerprint, makeKokoroPhonemizer, sayIds, sayOf, sentenceIds, sentencePhonemes, splitAtWord } from './say.js';

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
const items = [];
for (const w of words) {
  // `say` (optional, validated here) is the word's sounds as IPA; see say.js and the README.
  let say;
  const sentence = sentenceFor(w);
  try {
    say = sayOf(w);
    if (say !== undefined && !splitAtWord(sentence, w.word)) {
      throw new Error(`${w.word}: cannot place "say" in the sentence (the word must appear once, as a whole word): ${sentence}`);
    }
  } catch (err) {
    // The kokoro-js import below installs a handler that prints a huge dump for uncaught errors; exit plainly instead.
    console.error(`words.json: ${err.message}`);
    process.exit(1);
  }
  items.push({ text: w.word, key: clipKey(w.word), word: w.word, say });
  items.push({ text: sentence, key: sentenceKey(sentence), word: w.word, say, sentence: true });
}
items.push({ text: PREVIEW_TEXT, key: '_preview' });

// Two different words must never share a file name.
const owners = new Map();
for (const { text, key } of items) {
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
let deadline = Infinity;
if (flag('max-minutes')) {
  const minutes = Number(option('max-minutes'));
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--max-minutes needs a number above 0');
  deadline = Date.now() + minutes * 60000;
}
let stoppedAtDeadline = false;
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

// A word with a `say` override adds it to the fingerprint, so adding, changing or removing `say` re-records
// exactly that word's word clip and sentence clip. Without `say` the text is exactly what it always was,
// so every existing fingerprint (and clip) stays valid.
const fingerprint = (text, voice, say) => clipFingerprint(text, voice, MODEL_REVISION, ENCODER, say);

if (flag('dry-run')) {
  for (const { kokoro: voice } of wanted) {
    const dir = join(root, 'clips', voice);
    const manifestPath = join(dir, 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
    const todo = items.filter(({ text, key, say }) => {
      return redo.has(key) || !(manifest[key] === fingerprint(text, voice, say) && existsSync(join(dir, `${key}.mp3`)));
    });
    const keep = new Set(items.map(item => item.key));
    const stale = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.mp3') && !keep.has(n.slice(0, -4))).length : 0;
    console.log(`${voice}: ${todo.length} clip(s) to generate, ${stale} stale clip(s) a --prune run would delete`);
    // "changed" = a clip is recorded already but its fingerprint no longer matches (new text, new `say`, or `say` removed).
    const changed = todo.filter(({ key }) => manifest[key] !== undefined && !redo.has(key));
    for (const { key, word, say, sentence } of changed.slice(0, 20)) {
      const kind = sentence ? 'sentence' : 'word';
      console.log(`  changed: ${key} (${kind} clip for "${word}"${say === undefined ? ', no say' : `, say "${say}"`})`);
    }
    if (changed.length > 20) console.log(`  ... and ${changed.length - 20} more changed clip(s)`);
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

// Audio for one clip. Without `say` this is exactly tts.generate (kokoro-js guesses the sounds). With `say` the
// guess is skipped: the sounds go straight to the tokenizer and the model (generate_from_ids is what generate
// calls last, with the same options), for the word clip and for the sentence clip alike.
let kokoroPhonemes = null;
const splitFallbacks = []; // "<voice>/<word>" for each sentence clip made with the split fallback (least verified path)
async function synthesize({ text, say, word, sentence }, voice) {
  if (say === undefined) return tts.generate(text, { voice, speed: SPEED });
  if (!sentence) return tts.generate_from_ids(sayIds(tts.tokenizer, say, word), { voice, speed: SPEED });
  // `phonemizer` is declared in package.json at the version kokoro-js uses; loaded only when a `say` needs it.
  kokoroPhonemes ??= makeKokoroPhonemizer((await import('phonemizer')).phonemize);
  const phonemes = await sentencePhonemes(text, word, say, kokoroPhonemes, {
    onFallback: w => {
      splitFallbacks.push(`${voice}/${w}`);
      console.warn(`${w}: its sounds were not found in the sentence, so the sentence was split at the word`);
      // One annotation per word on the run summary page (the word comes from words.json; strip workflow-command characters).
      if (process.env.GITHUB_ACTIONS) console.log(`::warning::${w.replace(/[\r\n%]/g, ' ')}: split fallback used`);
    },
  });
  return tts.generate_from_ids(sentenceIds(tts.tokenizer, phonemes, say, word), { voice, speed: SPEED });
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
  for (const item of items) {
    const { text, key, say } = item;
    const file = join(dir, `${key}.mp3`);
    const print = fingerprint(text, voice, say);
    if (!redo.has(key) && manifest[key] === print && existsSync(file)) continue;
    if (made >= limit) break;
    if (Date.now() > deadline) {
      stoppedAtDeadline = true;
      break;
    }
    try {
      const wav = join(work, `${voice}.wav`);
      const audio = await synthesize(item, voice);
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
    const keep = new Set(items.map(item => item.key));
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
if (stoppedAtDeadline) {
  console.error('Stopped at the --max-minutes limit. Finished clips are saved; run again to continue.');
  process.exitCode = 1;
}
if (splitFallbacks.length) {
  console.log(`${splitFallbacks.length} sentence clip(s) used the split fallback: ${splitFallbacks.join(', ')}`);
}
if (failures.length) {
  console.error(`${failures.length} clip(s) failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
}
