// Saved lists: load, save, backups, delete and JSON export/import. Every function takes a Storage-like object
// (getItem, setItem, removeItem, key, length) so it runs in tests with a fake one. None of them throws.
// Keys: lists `bee-ready-mine-v1`, history `bee-ready-mine-history-v1`, stars `bee-ready-mine-starred-v1`,
// cached lookups `bee-ready-mine-lookup-v1`, backups `bee-ready-mine-v1.bak.<n>`. The default keys are never touched.
import { FIRST_CUSTOM_ID, LIMITS, cleanField, hasForbiddenKeys, validateEntry, validateStore } from './validate.js';

export const KEY = 'bee-ready-mine-v1';
export const HISTORY_KEY = 'bee-ready-mine-history-v1';
export const STARS_KEY = 'bee-ready-mine-starred-v1';
export const LOOKUP_KEY = 'bee-ready-mine-lookup-v1';
export const BAK_PREFIX = 'bee-ready-mine-v1.bak.';
export const SETTINGS_KEY = 'bee-ready-mine-settings-v1';
export const EXPORT_KIND = 'bee-ready-my-words';
export const MAX_IMPORT_BYTES = 200000;
const DEFAULT_STARS_KEY = 'bee-ready-starred-v1';

export const emptyStore = () => ({ version: 1, nextId: FIRST_CUSTOM_ID, active: null, lists: [] });

const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage.setItem(key, value); return true; } catch { return false; } };
const remove = (storage, key) => { try { storage.removeItem(key); return true; } catch { return false; } };
function allKeys(storage) {
  const keys = [];
  try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (typeof k === 'string') keys.push(k); } } catch { /* blocked storage */ }
  return keys;
}
export const backupKeys = storage => allKeys(storage).filter(k => k.startsWith(BAK_PREFIX));

// Writes the text to the next free `.bak.<n>`. Returns 'ok', 'duplicate' (the same text is already kept),
// 'full' (already at the limit: the caller must offer the JSON export and ask before dropping the oldest) or 'failed'.
export function writeBackup(storage, text) {
  const keys = backupKeys(storage);
  if (keys.some(k => read(storage, k) === text)) return 'duplicate';
  if (keys.length >= LIMITS.backups) return 'full';
  const used = new Set(keys.map(k => Number(k.slice(BAK_PREFIX.length))));
  let n = 1;
  while (used.has(n)) n++;
  return write(storage, BAK_PREFIX + n, text) ? 'ok' : 'failed';
}
// Drops the oldest backup (lowest number). Only called after the grown-up agrees.
export function dropOldestBackup(storage) {
  const keys = backupKeys(storage).sort((a, b) => Number(a.slice(BAK_PREFIX.length)) - Number(b.slice(BAK_PREFIX.length)));
  return keys.length ? remove(storage, keys[0]) : false;
}

// status: 'empty' (nothing saved), 'ok', or 'corrupt' (unreadable data: the raw text was kept as a backup if there was room).
export function loadStore(storage) {
  const raw = read(storage, KEY);
  if (raw === null) return { store: emptyStore(), status: 'empty' };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const store = validateStore(parsed);
  if (store) return { store, status: 'ok' };
  return { store: emptyStore(), status: 'corrupt', backup: writeBackup(storage, raw), raw };
}
export function saveStore(storage, store) {
  try { return write(storage, KEY, JSON.stringify(store)); } catch { return false; }
}

const sameSet = (a, b) => a.length === b.length && a.every(w => b.includes(w));
export const findListByWords = (store, words) => store.lists.find(l => sameSet(l.entries.map(e => e.word), words)) ?? null;

// Adds a list. `entries` have no id yet (or a default id for words that matched the default list); new ids come from store.nextId.
export function addList(store, name, entries) {
  if (store.lists.length >= LIMITS.lists) return { store, list: null, reason: 'full' };
  const n = store.lists.reduce((m, l) => Math.max(m, Number(l.key.slice(2))), 0) + 1;
  let nextId = store.nextId;
  const seen = new Set(), clean = [];
  for (const e of entries) {
    const entry = validateEntry({ ...e, id: Number.isInteger(e.id) ? e.id : nextId });
    if (!entry || seen.has(entry.word) || clean.length >= LIMITS.words) continue;
    if (!Number.isInteger(e.id)) nextId++;
    seen.add(entry.word); clean.push(entry);
  }
  const list = { key: `l-${n}`, name: cleanField(name, LIMITS.listName) || 'My words', entries: clean };
  return { store: { ...store, nextId, active: list.key, lists: [...store.lists, list] }, list };
}

// Adds entries to a list (skipping words it already has, up to the word limit). Words that matched the default list
// keep their default id; the rest get new ids from store.nextId.
export function addEntries(store, key, entries) {
  const list = store.lists.find(l => l.key === key);
  if (!list) return store;
  const have = new Set(list.entries.map(e => e.word));
  const merged = [...list.entries];
  let nextId = store.nextId;
  for (const e of entries) {
    if (merged.length >= LIMITS.words) break;
    const entry = validateEntry({ ...e, id: Number.isInteger(e.id) ? e.id : nextId });
    if (!entry || have.has(entry.word)) continue;
    if (!Number.isInteger(e.id)) nextId++;
    have.add(entry.word);
    merged.push(entry);
  }
  return { ...store, nextId, lists: store.lists.map(l => (l.key === key ? { ...l, entries: merged } : l)) };
}

export function updateList(store, key, change) {
  return { ...store, lists: store.lists.map(l => (l.key === key ? { ...l, ...change(l) } : l)) };
}

function readSet(storage, key) {
  try { const v = JSON.parse(read(storage, key)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function readObject(storage, key) {
  try { const v = JSON.parse(read(storage, key)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

// Deletes one list and everything that only it needed: its stars, its history, cached lookups no other list uses,
// and every backup that holds it. A backup that cannot be read or validated is dropped too, because it cannot be shown
// to be free of the list. A backup that holds several lists is dropped entirely (not rewritten).
export function deleteList(storage, store, key) {
  const gone = store.lists.find(l => l.key === key);
  if (!gone) return store;
  const lists = store.lists.filter(l => l.key !== key);
  const next = { ...store, lists, active: store.active === key ? (lists[0]?.key ?? null) : store.active };
  const ids = new Set(gone.entries.map(e => e.id).filter(id => id >= FIRST_CUSTOM_ID));
  const keepIds = new Set(lists.flatMap(l => l.entries.map(e => e.id)));
  const stars = readSet(storage, STARS_KEY).filter(id => !ids.has(id) || keepIds.has(id));
  write(storage, STARS_KEY, JSON.stringify(stars));
  const history = readObject(storage, HISTORY_KEY);
  for (const part of ['attempts', 'missed']) {
    if (history[part] && typeof history[part] === 'object') for (const id of ids) if (!keepIds.has(id)) delete history[part][id];
  }
  write(storage, HISTORY_KEY, JSON.stringify(history));
  const stillUsed = new Set(lists.flatMap(l => l.entries.map(e => e.word)));
  const cache = readObject(storage, LOOKUP_KEY);
  for (const w of Object.keys(cache)) if (!stillUsed.has(w) && gone.entries.some(e => e.word === w)) delete cache[w];
  write(storage, LOOKUP_KEY, JSON.stringify(cache));
  for (const bak of backupKeys(storage)) {
    let parsed = null;
    try { parsed = JSON.parse(read(storage, bak)); } catch { parsed = null; }
    const valid = validateStore(parsed);
    if (!valid || valid.lists.some(l => l.key === key)) remove(storage, bak);
  }
  saveStore(storage, next);
  return next;
}

// "Delete all my words": every key this feature owns. Never touches the default history or stars.
export function deleteAll(storage) {
  for (const k of [KEY, HISTORY_KEY, STARS_KEY, LOOKUP_KEY, SETTINGS_KEY, ...backupKeys(storage)]) remove(storage, k);
  return emptyStore();
}

// A storage object for the existing star code: it reads and writes the custom stars key where the default code asks for
// the default one, and ignores every other key. In mine mode the default stars key can therefore never be written.
export function starsStorage(storage) {
  return {
    getItem: k => (k === DEFAULT_STARS_KEY ? read(storage, STARS_KEY) : null),
    setItem: (k, v) => { if (k === DEFAULT_STARS_KEY) storage.setItem(STARS_KEY, v); },
    removeItem: k => { if (k === DEFAULT_STARS_KEY) storage.removeItem(STARS_KEY); },
  };
}

export function loadSettings(storage) {
  const o = readObject(storage, SETTINGS_KEY);
  return { liveLookup: o.liveLookup !== false };
}
export function saveSettings(storage, settings) {
  return write(storage, SETTINGS_KEY, JSON.stringify({ liveLookup: settings.liveLookup !== false }));
}

// JSON backup. The file holds words and their fields, never ids. `version` lets a later schema read old files.
export function exportJson(store) {
  const lists = store.lists.map(l => ({
    name: l.name,
    words: l.entries.map(({ word, part, definition, group, sentence, src }) => ({ word, part, definition, group, sentence, src })),
  }));
  return JSON.stringify({ kind: EXPORT_KIND, version: 1, lists }, null, 2);
}

// Validates a backup file like every other entry path. Returns { lists: [{ name, entries }] } (entries without ids) or { error }.
export function parseExport(text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) return { error: 'That file is too big to be a Bee Ready backup.' };
  let data = null;
  try { data = JSON.parse(text); } catch { return { error: 'That file is not a Bee Ready backup.' }; }
  if (!data || data.kind !== EXPORT_KIND || data.version !== 1 || !Array.isArray(data.lists) || hasForbiddenKeys(data)) {
    return { error: 'That file is not a Bee Ready backup.' };
  }
  const lists = [];
  for (const raw of data.lists.slice(0, LIMITS.lists)) {
    if (!raw || !Array.isArray(raw.words)) continue;
    const entries = [];
    raw.words.slice(0, LIMITS.words).forEach((w, i) => {
      const entry = validateEntry({ ...w, id: i + 1 });
      if (entry) { const { id, ...rest } = entry; entries.push(rest); }
    });
    if (entries.length) lists.push({ name: cleanField(raw.name, LIMITS.listName) || 'My words', entries });
  }
  return lists.length ? { lists } : { error: 'No usable words were found in that file.' };
}
