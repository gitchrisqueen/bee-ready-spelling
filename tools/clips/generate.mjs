// Generates pre-recorded MP3 clips for every word (and the voice sample) with Kokoro.
//
//   node generate.mjs [--voice af_heart] [--limit 10] [--prune]
//
// Incremental: a clip is regenerated only when its text, voice, model revision or encoder
// settings change, so adding words to words.json only generates the new ones.
// Output: <repo>/clips/<kokoro voice>/<clipKey>.mp3 plus clips/<voice>/manifest.json.
// Requires ffmpeg on PATH.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KokoroTTS } from 'kokoro-js';
import { PREVIEW_TEXT, VOICES, clipKey } from '../../voice-service.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const ENCODER = 'mp3-mono-40k-trim-v2';
const FILTER =
  'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-50dB,areverse,' +
  'silenceremove=start_periods=1:start_silence=0.08:start_threshold=-50dB,areverse';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);

const root = resolve(import.meta.dirname, '..', '..');
const words = JSON.parse(readFileSync(join(root, 'words.json'), 'utf8'));
const texts = [...words.map(w => w.word), PREVIEW_TEXT];
const wanted = option('voice') ? VOICES.filter(v => v.kokoro === option('voice')) : VOICES;
if (!wanted.length) throw new Error(`Unknown voice: ${option('voice')}`);
const limit = Number(option('limit')) || Infinity;

const fingerprint = (text, voice) =>
  createHash('sha256').update(`${text}|${voice}|${MODEL_REVISION}|${ENCODER}`).digest('hex').slice(0, 16);

const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' });
const work = mkdtempSync(join(tmpdir(), 'bee-clips-'));

for (const { kokoro: voice } of wanted) {
  const dir = join(root, 'clips', voice);
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  let made = 0;
  const started = Date.now();
  for (const text of texts) {
    const key = clipKey(text);
    const file = join(dir, `${key}.mp3`);
    const print = fingerprint(text, voice);
    if (manifest[key] === print && existsSync(file)) continue;
    if (made >= limit) break;
    const wav = join(work, `${voice}.wav`);
    const audio = await tts.generate(text, { voice, speed: 1 });
    await audio.save(wav);
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-i', wav, '-af', FILTER,
      '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '40k', file,
    ]);
    manifest[key] = print;
    made++;
    if (made % 25 === 0) {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 0) + '\n');
      const rate = (Date.now() - started) / made / 1000;
      console.log(`${voice}: ${made} new clips (${rate.toFixed(2)} s each)`);
    }
  }
  if (flag('prune')) {
    const keep = new Set(texts.map(clipKey));
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.mp3') && !keep.has(name.slice(0, -4))) {
        rmSync(join(dir, name));
        delete manifest[name.slice(0, -4)];
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 0) + '\n');
  const total = readdirSync(dir).filter(n => n.endsWith('.mp3')).reduce((s, n) => s + statSync(join(dir, n)).size, 0);
  console.log(`${voice}: generated ${made}, ${Object.keys(manifest).length} clips, ${(total / 1048576).toFixed(1)} MB`);
}
rmSync(work, { recursive: true, force: true });
