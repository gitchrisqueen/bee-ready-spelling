// Child-safety filter. The word list is `mine/filter.sha256`: one SHA-256 per line, so the repository holds
// no plain offensive words (see mine/FILTER-NOTICE.md for its source and licence).
// It fails closed: until a list has been loaded, every word and text counts as blocked.
import { sha256Hex } from './sha256.js';

let blocked = null;

export function setBlocklist(hashes) {
  blocked = new Set(hashes);
}
export const filterReady = () => blocked !== null;
// Back to the "not loaded" state (used by tests to check that the filter fails closed).
export function clearBlocklist() {
  blocked = null;
}

// Reads the one-hash-per-line file. Lines that are not 64 hex digits (comments, blanks) are ignored.
export function parseBlocklist(text) {
  return String(text).split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(l => /^[0-9a-f]{64}$/.test(l));
}

export async function loadBlocklist(fetchFn, url = './mine/filter.sha256') {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`filter list download failed (${response.status})`);
  const hashes = parseBlocklist(await response.text());
  if (!hashes.length) throw new Error('filter list is empty');
  setBlocklist(hashes);
  return hashes.length;
}

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
const deLeet = s => s.replace(/[0134579@$]/g, c => LEET[c] || c);

// Variants checked for each token: the word itself and simple plural or "-ing" and "-ed" forms.
function variants(token) {
  const base = token.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (!base) return [];
  const out = new Set([base]);
  if (base.endsWith('ies')) out.add(base.slice(0, -3) + 'y');
  if (base.endsWith('es')) out.add(base.slice(0, -2));
  if (base.endsWith('s')) out.add(base.slice(0, -1));
  if (base.endsWith('ing')) out.add(base.slice(0, -3));
  if (base.endsWith('ed')) out.add(base.slice(0, -2));
  if (base.endsWith('er')) out.add(base.slice(0, -2));
  return [...out].filter(v => v.length > 1);
}

export function isBlockedWord(word) {
  if (!blocked) return true;
  const raw = String(word ?? '');
  const candidates = new Set([...variants(raw), ...variants(deLeet(raw.toLowerCase()))]);
  for (const v of candidates) if (blocked.has(sha256Hex(v))) return true;
  return false;
}

// Every whitespace or punctuation separated token of a longer text is checked.
export function isBlockedText(text) {
  if (!blocked) return true;
  for (const token of String(text ?? '').split(/[^\p{L}\p{N}@$]+/u)) {
    if (token && isBlockedWord(token)) return true;
  }
  return false;
}
