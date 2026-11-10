// My words: a child's own words must not be sent to this site's host as clip file names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedClipKeys, createClipGuard, installClipGuard } from '../mine/clipguard.js';
import { clipKey, sentenceKey } from '../voice-service.js';
import { sentenceFor } from '../sentences.js';

const defaults = [
  { id: 1, word: 'abdicate', part: 'v', sentence: 'The king chose to abdicate.' },
  { id: 2, word: 'blasé', part: 'adj' },
];
const allowed = allowedClipKeys(defaults, { sentenceFor, clipKey, sentenceKey });
const BASE = 'https://example.github.io/bee-ready-spelling';

test('a clip for a default-list word, its sentence or the voice sample goes through', async () => {
  const seen = [];
  const guarded = createClipGuard(async url => { seen.push(String(url)); return new Response('ok'); }, allowed);
  const sentence = sentenceKey('The king chose to abdicate.');
  for (const key of ['abdicate', 'blase', '_preview', sentence]) {
    const r = await guarded(`${BASE}/clips/af_heart/${key}.mp3`);
    assert.equal(r.status, 200, key);
  }
  assert.equal(seen.length, 4);
  assert.equal((await guarded(new URL(`${BASE}/clips/am_michael/abdicate.mp3`))).status, 200, 'a URL object works too');
});

test('a clip for any other word is answered locally with a 404 and never reaches the network', async () => {
  const seen = [];
  const guarded = createClipGuard(async url => { seen.push(String(url)); return new Response('ok'); }, allowed);
  for (const key of ['zzzxq', 'quay', sentenceKey('A custom sentence about quay.'), 'abdicate%2Fx', '..%2Fx']) {
    const r = await guarded(`${BASE}/clips/af_heart/${key}.mp3`);
    assert.equal(r.status, 404, key);
  }
  assert.deepEqual(seen, [], 'no request was made');
});

test('requests that are not clip requests pass through untouched', async () => {
  const seen = [];
  const guarded = createClipGuard(async url => { seen.push(String(url)); return new Response('ok'); }, allowed);
  await guarded(`${BASE}/words.json`);
  await guarded(`${BASE}/library/q.json`);
  await guarded(`${BASE}/clips/settings.json`);
  assert.equal(seen.length, 3);
});

test('installClipGuard replaces fetch on the scope it is given', async () => {
  const scope = { fetch: async () => new Response('real') };
  installClipGuard(scope, allowed);
  assert.equal((await scope.fetch(`${BASE}/clips/af_heart/quay.mp3`)).status, 404);
  assert.equal(await (await scope.fetch(`${BASE}/words.json`)).text(), 'real');
});
