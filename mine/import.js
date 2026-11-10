// Turns a list of words into review "chips": each word is matched against the default list (kept as it is, with its
// recorded clip), then the static library, and what is still missing is left for manual entry or a live lookup that the
// grown-up asks for. Nothing here touches the network except the library files from this site, and nothing saves anything.
import { libraryEntry, loadShard } from './lookup.js';
import { HOSTS, normalizeWord } from './validate.js';

// A chip is { word, status: 'default' | 'library' | 'live' | 'missing', entry?, suggestion? }.
// `defaultByWord` is a Map of lowercase word -> the words.json entry.

function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// The closest known word within two letters, from the default list and the library shard for the same first letter.
export async function suggest(word, { defaultByWord, fetchFn }) {
  if (word.length < 4) return null;
  const pool = new Set();
  for (const w of defaultByWord.keys()) if (w[0] === word[0]) pool.add(w);
  const shard = await loadShard(fetchFn, word[0]);
  if (shard) for (const w of Object.keys(shard)) pool.add(w);
  let best = null;
  for (const w of pool) {
    const d = distance(word, w, 2);
    if (d > 0 && d <= 2 && (best === null || d < best.d)) best = { w, d };
  }
  return best ? best.w : null;
}

export async function resolveWords(words, { defaultByWord, fetchFn }) {
  const chips = [];
  for (const raw of words) {
    const word = normalizeWord(raw);
    if (defaultByWord.has(word)) { chips.push({ word, status: 'default', entry: defaultByWord.get(word) }); continue; }
    const lib = await libraryEntry(fetchFn, word);
    if (lib) { chips.push({ word, status: 'library', entry: lib }); continue; }
    chips.push({ word, status: 'missing', suggestion: await suggest(word, { defaultByWord, fetchFn }) });
  }
  return chips;
}

// Chips -> entries ready for lists.addList. Default-list words keep their default id and are re-read from words.json
// when the list is shown, so only the word and its id are stored for them.
export function chipsToEntries(chips) {
  return chips.map(chip => {
    if (chip.status === 'default') return { id: chip.entry.id, word: chip.word, src: 'default' };
    const e = chip.entry ?? {};
    return {
      word: chip.word, src: chip.status === 'missing' ? 'manual' : chip.status,
      part: e.part, definition: e.definition, group: e.group, sentence: e.sentence, credit: e.credit,
    };
  });
}

// What the practice screen reads: the same fields as a words.json entry, plus `custom` and a Mine level.
export function toPracticeWord(entry, defaultById) {
  if (entry.src === 'default') {
    const d = defaultById.get(entry.id);
    if (d) return { ...d, custom: true, level: 'Mine' };
  }
  return {
    id: entry.id, word: entry.word, part: entry.part ?? '', custom: true, level: 'Mine',
    ...(entry.credit?.length ? { credit: entry.credit.filter(h => HOSTS.includes(h)) } : {}),
    definition: entry.definition ?? 'No definition yet. Use the Dictionary link to look it up.',
    group: entry.group ?? 'Origin not available', ...(entry.sentence ? { sentence: entry.sentence } : {}),
  };
}

// An entry from a backup file: a word that is in the default list goes back to its default id and recorded clip.
export function entryFromBackup(entry, defaultByWord) {
  const d = defaultByWord.get(entry.word);
  return d ? { id: d.id, word: entry.word, src: 'default' } : { ...entry };
}
