// The self-hosted model wrapper may fall back to Hugging Face, but only to the pinned revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BeeVoiceService } from '../voice-service.js';

const root = resolve(import.meta.dirname, '..');
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const HF = `https://huggingface.co/${MODEL}/resolve`;
const revision = readFileSync(join(root, 'scripts', 'fetch-voice-assets.mjs'), 'utf8').match(/const REVISION = '([0-9a-f]{40})'/)[1];

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.location = { href: 'https://example.test/' };

const requested = [];
let localAnswer = { ok: false, status: 404 };
// The wrapper installs itself on top of whatever fetch exists when it first runs.
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  requested.push(url);
  if (url.includes('/voice-assets/')) return url.endsWith('config.json') && init?.method === 'HEAD' ? { ok: true, status: 200 } : localAnswer;
  return { ok: true, status: 200, url };
};

function serviceThatFetches(urls, results) {
  const loadKokoro = async () => ({
    KokoroTTS: {
      from_pretrained: async () => {
        for (const url of urls) {
          try { results.push(await globalThis.fetch(url)); } catch (error) { results.push(error); }
        }
        return { generate: async () => ({ toBlob: () => new Blob(['wav']) }) };
      },
    },
  });
  return new BeeVoiceService({ settings: { voiceId: 'heart', speedId: 'normal', mode: 'auto' }, loadKokoro, loadPiper: async () => { throw Error('unused'); } });
}

test('voice-service.js pins the same model revision as the fetch script', () => {
  const source = readFileSync(join(root, 'voice-service.js'), 'utf8');
  assert.equal(source.match(/MODEL_REVISION='([0-9a-f]{40})'/)?.[1], revision);
});

test('a missing self-hosted file falls back to the pinned revision, never to resolve/main', async () => {
  const results = [];
  const svc = serviceThatFetches([`${HF}/main/onnx/model_quantized.onnx`, `${HF}/main/config.json?download=1`], results);
  assert.equal(await svc.prepare(), 'kokoro');
  const remote = requested.filter(u => u.startsWith('https://huggingface.co/'));
  assert.equal(remote.length, 2);
  assert.equal(remote[0], `${HF}/${revision}/onnx/model_quantized.onnx`);
  assert.equal(remote[1], `${HF}/${revision}/config.json?download=1`, 'the query string is kept');
  for (const url of remote) assert.ok(!url.includes('/resolve/main/'), `${url} must not use resolve/main`);
});

test('a self-hosted file that exists is served locally and Hugging Face is not asked', async () => {
  requested.length = 0;
  localAnswer = { ok: true, status: 200, local: true };
  const results = [];
  await serviceThatFetches([`${HF}/main/tokenizer.json`], results).prepare();
  assert.equal(results[0].local, true);
  assert.equal(requested.filter(u => u.startsWith('https://huggingface.co/')).length, 0);
});

test('paths that climb out of the model folder are refused, plain or encoded', async () => {
  requested.length = 0;
  localAnswer = { ok: false, status: 404 };
  const results = [];
  await serviceThatFetches([`${HF}/main/../other/file`, `${HF}/main/%2e%2e/other/file`], results).prepare();
  assert.ok(results.every(r => r instanceof TypeError), 'both requests must be refused');
  assert.equal(requested.filter(u => u.startsWith('https://huggingface.co/')).length, 0);
});

test('requests for other hosts or other models pass through untouched', async () => {
  requested.length = 0;
  const results = [];
  await serviceThatFetches(['https://example.test/other.js', 'https://huggingface.co/someone/else/resolve/main/x'], results).prepare();
  assert.deepEqual(requested.filter(u => !u.includes('/voice-assets/')), ['https://example.test/other.js', 'https://huggingface.co/someone/else/resolve/main/x']);
});
