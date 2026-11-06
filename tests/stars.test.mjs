import test from 'node:test';
import assert from 'node:assert/strict';
import { STAR_KEY, loadStars, saveStars, toggleStar, clearStars } from '../stars.js';

// Minimal Storage-like object backed by a Map.
const fakeStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
  };
};
const blockedStorage = () => ({
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
});

test('the storage key is the documented one', () => {
  assert.equal(STAR_KEY, 'bee-ready-starred-v1');
});

test('loadStars gives an empty Set when nothing is saved', () => {
  const s = loadStars(fakeStorage());
  assert.ok(s instanceof Set);
  assert.equal(s.size, 0);
});

test('save then load round-trips ids as numbers', () => {
  const storage = fakeStorage();
  assert.equal(saveStars(storage, new Set([42, 7, 1155])), true);
  assert.equal(storage.getItem(STAR_KEY), '[7,42,1155]');
  const back = loadStars(storage);
  assert.deepEqual([...back].sort((a, b) => a - b), [7, 42, 1155]);
  assert.ok(back.has(42) && !back.has('42'));
});

test('toggleStar adds, removes and reports the new state', () => {
  const s = new Set();
  assert.equal(toggleStar(s, 5), true);
  assert.ok(s.has(5));
  assert.equal(toggleStar(s, 5), false);
  assert.ok(!s.has(5));
  assert.equal(s.size, 0);
});

test('clearStars removes the stars key', () => {
  const storage = fakeStorage();
  saveStars(storage, new Set([1, 2]));
  assert.equal(clearStars(storage), true);
  assert.equal(storage.getItem(STAR_KEY), null);
  assert.equal(loadStars(storage).size, 0);
});

test('corrupt JSON loads as an empty Set', () => {
  for (const bad of ['{not json', '[1,2', '', 'undefined']) {
    assert.equal(loadStars(fakeStorage({ [STAR_KEY]: bad })).size, 0, `bad value: ${JSON.stringify(bad)}`);
  }
});

test('JSON that is not an array loads as an empty Set', () => {
  for (const bad of ['{"1":true}', '5', '"abc"', 'null', 'true']) {
    assert.equal(loadStars(fakeStorage({ [STAR_KEY]: bad })).size, 0, `bad value: ${bad}`);
  }
});

test('junk entries are ignored, integer ids are kept', () => {
  const s = loadStars(fakeStorage({ [STAR_KEY]: JSON.stringify([3, '4', 5.5, null, true, {}, [6], -1, 8, NaN, 'x']) }));
  assert.deepEqual([...s].sort((a, b) => a - b), [-1, 3, 8]);
});

test('storage that throws never breaks load, save or clear', () => {
  const storage = blockedStorage();
  assert.equal(loadStars(storage).size, 0);
  assert.equal(saveStars(storage, new Set([1])), false);
  assert.equal(clearStars(storage), false);
  assert.equal(loadStars(null).size, 0);
  assert.equal(loadStars(undefined).size, 0);
  assert.equal(saveStars(null, new Set([1])), false);
  assert.equal(clearStars(null), false);
});

test('a full or blocked save leaves the in-memory set usable', () => {
  const s = new Set();
  toggleStar(s, 9);
  assert.equal(saveStars(blockedStorage(), s), false);
  assert.ok(s.has(9));
});

test('clearing practice history keys does not remove stars, and saving stars does not touch history', () => {
  const historyKey = 'bee-ready-history-v2';
  const history = JSON.stringify({ attempts: { 1: { correct: 1, missed: 0 } }, missed: { 2: true }, rounds: 1 });
  const storage = fakeStorage({ [historyKey]: history });
  saveStars(storage, new Set([10, 20]));
  assert.equal(storage.getItem(historyKey), history, 'saving stars leaves history alone');
  // What the Grown-ups "Clear practice history" button does: overwrite the history key only.
  storage.setItem(historyKey, JSON.stringify({ attempts: {}, missed: {}, rounds: 0 }));
  storage.removeItem(historyKey);
  assert.deepEqual([...loadStars(storage)].sort((a, b) => a - b), [10, 20]);
  // And clearing stars leaves history alone.
  storage.setItem(historyKey, history);
  clearStars(storage);
  assert.equal(storage.getItem(historyKey), history);
  assert.equal(loadStars(storage).size, 0);
});
