// My words: saved lists, backups, delete scope, and proof that the default keys are never touched.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBlocklist, setBlocklist } from '../mine/filter.js';
import {
  BAK_PREFIX, HISTORY_KEY, KEY, LOOKUP_KEY, STARS_KEY, addEntries, addList, backupKeys, deleteAll, deleteList,
  dropOldestBackup, emptyStore, exportJson, loadSettings, loadStore, parseExport, saveSettings, saveStore, starsStorage,
  updateList, writeBackup,
} from '../mine/lists.js';
import { entryFromBackup } from '../mine/import.js';
import { LIMITS, FIRST_CUSTOM_ID } from '../mine/validate.js';
import { loadStars, saveStars, toggleStar, clearStars } from '../stars.js';

const root = resolve(import.meta.dirname, '..');
before(() => setBlocklist(parseBlocklist(readFileSync(join(root, 'mine/filter.sha256'), 'utf8'))));

class FakeStorage {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); this.fail = false; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { if (this.fail) throw new Error('quota'); this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  keys() { return [...this.map.keys()]; }
}
const DEFAULT_HISTORY = JSON.stringify({ attempts: { 1: { correct: 2, missed: 0 } }, missed: {}, rounds: 3 });
const DEFAULT_STARS = JSON.stringify([1, 2, 3]);
const seeded = () => new FakeStorage({ 'bee-ready-history-v2': DEFAULT_HISTORY, 'bee-ready-starred-v1': DEFAULT_STARS, voice: 'x' });

test('ids: new words get ids from 1,000,000 up, and a default-list word keeps its default id', () => {
  const { store, list } = addList(emptyStore(), 'Week 1', [
    { word: 'apple', src: 'library', definition: 'A fruit.' }, { id: 7, word: 'abide', src: 'default' }, { word: 'pear' },
  ]);
  assert.deepEqual(list.entries.map(e => e.id), [FIRST_CUSTOM_ID, 7, FIRST_CUSTOM_ID + 1]);
  assert.equal(store.nextId, FIRST_CUSTOM_ID + 2);
  assert.equal(list.key, 'l-1');
  assert.equal(store.active, 'l-1');
});

test('a mine-mode session never writes or removes the default keys', () => {
  const s = seeded();
  let store = loadStore(s).store;
  store = addList(store, 'A', [{ word: 'apple' }, { word: 'pear' }]).store;
  store = addEntries(store, 'l-1', [{ word: 'plum' }, { id: 9, word: 'abide', src: 'default' }]);
  saveStore(s, store);
  const stars = starsStorage(s);
  const set = loadStars(stars);
  toggleStar(set, FIRST_CUSTOM_ID); saveStars(stars, set);
  s.setItem(HISTORY_KEY, JSON.stringify({ attempts: { [FIRST_CUSTOM_ID]: { correct: 1, missed: 0 } }, missed: {}, rounds: 1 }));
  saveSettings(s, { liveLookup: false });
  writeBackup(s, '{"corrupt":1');
  store = updateList(store, 'l-1', () => ({ name: 'Renamed' }));
  store = deleteList(s, store, 'l-1');
  clearStars(stars);
  deleteAll(s);
  assert.equal(s.getItem('bee-ready-history-v2'), DEFAULT_HISTORY);
  assert.equal(s.getItem('bee-ready-starred-v1'), DEFAULT_STARS);
  assert.equal(s.getItem('voice'), 'x');
  assert.deepEqual(s.keys().sort(), ['bee-ready-history-v2', 'bee-ready-starred-v1', 'voice']);
});

test('the stars adapter reads and writes only the custom stars key', () => {
  const s = seeded();
  const stars = starsStorage(s);
  assert.equal(stars.getItem('bee-ready-starred-v1'), null, 'the default stars are not visible in mine mode');
  stars.setItem('bee-ready-starred-v1', '[1000001]');
  stars.setItem('bee-ready-history-v2', 'x');
  stars.setItem('other', 'x');
  assert.equal(s.getItem(STARS_KEY), '[1000001]');
  assert.equal(s.getItem('bee-ready-starred-v1'), DEFAULT_STARS);
  assert.equal(s.getItem('bee-ready-history-v2'), DEFAULT_HISTORY);
  assert.equal(s.getItem('other'), null);
  stars.removeItem('bee-ready-starred-v1');
  assert.equal(s.getItem(STARS_KEY), null);
  assert.equal(s.getItem('bee-ready-starred-v1'), DEFAULT_STARS);
});

test('storage: corrupt data starts fresh, is backed up once, and backups are capped and never overwritten', () => {
  const s = new FakeStorage({ [KEY]: '{"version":1,"lists":' });
  const first = loadStore(s);
  assert.equal(first.status, 'corrupt');
  assert.equal(first.backup, 'ok');
  assert.deepEqual(first.store, emptyStore());
  assert.deepEqual(backupKeys(s), [`${BAK_PREFIX}1`]);
  assert.equal(loadStore(s).backup, 'duplicate', 'the same text is not written twice');
  assert.equal(backupKeys(s).length, 1);
  assert.equal(writeBackup(s, 'two'), 'ok');
  assert.equal(writeBackup(s, 'three'), 'ok');
  assert.equal(writeBackup(s, 'four'), 'full', `at most ${LIMITS.backups} backups`);
  assert.equal(backupKeys(s).length, 3);
  assert.equal(s.getItem(`${BAK_PREFIX}1`), '{"version":1,"lists":', 'an existing backup is never overwritten');
  assert.equal(dropOldestBackup(s), true);
  assert.equal(s.getItem(`${BAK_PREFIX}1`), null);
  assert.equal(writeBackup(s, 'four'), 'ok');
  assert.equal(s.getItem(`${BAK_PREFIX}1`), 'four', 'the lowest free number is reused only after a drop');
});

test('storage: a failed write is reported, not thrown', () => {
  const s = new FakeStorage();
  s.fail = true;
  assert.equal(saveStore(s, emptyStore()), false);
  assert.equal(writeBackup(s, 'x'), 'failed');
  assert.equal(saveSettings(s, { liveLookup: true }), false);
  assert.equal(loadStore({ getItem() { throw new Error('blocked'); }, length: 0, key: () => null }).status, 'empty');
});

test('storage: invalid but parseable data is treated as corrupt too', () => {
  const s = new FakeStorage({ [KEY]: JSON.stringify({ version: 9, lists: [] }) });
  assert.equal(loadStore(s).status, 'corrupt');
  const polluted = new FakeStorage({ [KEY]: '{"version":1,"lists":[],"__proto__":{"x":1}}' });
  assert.equal(loadStore(polluted).status, 'corrupt');
});

test('deleting a list removes its stars, history, cached lookups and every backup that holds or may hold it', () => {
  const s = seeded();
  let store = addList(emptyStore(), 'One', [{ word: 'apple' }, { word: 'shared' }]).store;
  store = addList(store, 'Two', [{ word: 'shared' }, { word: 'plum' }]).store;
  const one = store.lists[0], two = store.lists[1];
  const ids = { apple: one.entries[0].id, plum: two.entries[1].id };
  saveStore(s, store);
  s.setItem(STARS_KEY, JSON.stringify([ids.apple, ids.plum]));
  s.setItem(HISTORY_KEY, JSON.stringify({
    attempts: { [ids.apple]: { correct: 1, missed: 0 }, [ids.plum]: { correct: 1, missed: 0 } },
    missed: { [ids.apple]: true, [ids.plum]: true }, rounds: 2,
  }));
  s.setItem(LOOKUP_KEY, JSON.stringify({ apple: { definition: 'x' }, shared: { definition: 'y' }, plum: { definition: 'z' } }));
  const only = { version: 1, nextId: store.nextId, active: 'l-2', lists: [two] };
  s.setItem(`${BAK_PREFIX}1`, JSON.stringify(store));
  s.setItem(`${BAK_PREFIX}2`, '{"unreadable"');
  s.setItem(`${BAK_PREFIX}3`, JSON.stringify(only));
  const next = deleteList(s, store, 'l-1');
  assert.deepEqual(next.lists.map(l => l.key), ['l-2']);
  assert.equal(next.active, 'l-2');
  assert.deepEqual(JSON.parse(s.getItem(STARS_KEY)), [ids.plum]);
  const history = JSON.parse(s.getItem(HISTORY_KEY));
  assert.deepEqual(Object.keys(history.attempts), [String(ids.plum)]);
  assert.deepEqual(Object.keys(history.missed), [String(ids.plum)]);
  assert.deepEqual(Object.keys(JSON.parse(s.getItem(LOOKUP_KEY))).sort(), ['plum', 'shared'], 'only the unshared word leaves the cache');
  assert.deepEqual(backupKeys(s), [`${BAK_PREFIX}3`], 'backups that hold the list, or cannot be read, are dropped');
  assert.deepEqual(JSON.parse(s.getItem(KEY)).lists.map(l => l.key), ['l-2']);
  assert.equal(s.getItem('bee-ready-starred-v1'), DEFAULT_STARS);
});

test('"Delete all my words" removes every key this feature owns, including every backup', () => {
  const s = seeded();
  saveStore(s, addList(emptyStore(), 'One', [{ word: 'apple' }]).store);
  for (const k of [HISTORY_KEY, STARS_KEY, LOOKUP_KEY, 'bee-ready-mine-settings-v1', `${BAK_PREFIX}1`, `${BAK_PREFIX}2`, `${BAK_PREFIX}9`]) {
    s.setItem(k, '1');
  }
  deleteAll(s);
  assert.deepEqual(s.keys().sort(), ['bee-ready-history-v2', 'bee-ready-starred-v1', 'voice']);
});

test('adding words: duplicates are skipped and a list stops at 200 words', () => {
  let store = addList(emptyStore(), 'A', [{ word: 'apple' }]).store;
  store = addEntries(store, 'l-1', [{ word: 'Apple' }, { word: 'pear' }]);
  assert.deepEqual(store.lists[0].entries.map(e => e.word), ['apple', 'pear']);
  const many = Array.from({ length: 300 }, (_, i) => ({ word: `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}zz` }));
  store = addEntries(store, 'l-1', many);
  assert.equal(store.lists[0].entries.length, LIMITS.words);
  let full = emptyStore();
  for (let i = 0; i < 20; i++) full = addList(full, `L${i}`, []).store;
  assert.equal(addList(full, 'one more', []).list, null, `at most ${LIMITS.lists} lists`);
});

test('settings default to live lookup on and persist', () => {
  const s = new FakeStorage();
  assert.deepEqual(loadSettings(s), { liveLookup: true });
  saveSettings(s, { liveLookup: false });
  assert.deepEqual(loadSettings(s), { liveLookup: false });
});

test('backup file: export then import round-trips, default words return to their default ids', () => {
  const { store } = addList(emptyStore(), 'Week 1', [
    { word: 'apple', src: 'library', definition: 'A round fruit.', part: 'n', group: 'Old English', sentence: 'An apple fell.' },
    { id: 3, word: 'academy', src: 'default' },
  ]);
  const text = exportJson(store);
  assert.equal(JSON.parse(text).version, 1);
  assert.equal(text.includes('"id"'), false, 'the file holds no ids');
  const parsed = parseExport(text);
  assert.equal(parsed.lists[0].name, 'Week 1');
  assert.equal(parsed.lists[0].entries[0].definition, 'A round fruit.');
  const defaults = new Map([['academy', { id: 3, word: 'academy' }]]);
  assert.deepEqual(entryFromBackup(parsed.lists[0].entries[1], defaults), { id: 3, word: 'academy', src: 'default' });
});

test('backup file: hostile or oversized files are refused', () => {
  assert.ok(parseExport('not json').error);
  assert.ok(parseExport('x'.repeat(200001)).error);
  assert.ok(parseExport(JSON.stringify({ kind: 'other', version: 1, lists: [] })).error);
  assert.ok(parseExport('{"kind":"bee-ready-my-words","version":1,"lists":[],"__proto__":{"a":1}}').error);
  const hostile = parseExport(JSON.stringify({
    kind: 'bee-ready-my-words', version: 1,
    lists: [{ name: '<b>x</b>', words: [{ word: 'cat', definition: 'see https://evil.example', sentence: '<img src=x>' }] }],
  }));
  assert.equal(hostile.lists[0].name, 'My words');
  assert.deepEqual(hostile.lists[0].entries, [{ word: 'cat', src: 'manual' }], 'unsafe fields are dropped, not shown');
  assert.ok(parseExport(JSON.stringify({ kind: 'bee-ready-my-words', version: 1, lists: [{ words: [] }] })).error);
});
