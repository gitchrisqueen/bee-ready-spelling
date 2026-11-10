// The one validator every entry path uses: typed or pasted text, share links, JSON backups, the lists/<id>.json
// registry, backup keys, and data read back from storage. Limits are in docs/my-words-plan.md; they may be
// tightened but never raised. Pure functions: no DOM, no storage, no network.
import { isBlockedText, isBlockedWord } from './filter.js';
import { isSensitiveText } from './sensitive.js';

export const LIMITS = Object.freeze({
  words: 200, lists: 20, wordChars: 40, fragment: 8000, unpacked: 16384,
  definition: 200, origin: 40, sentence: 160, backups: 3, lookupEntries: 500, listName: 40,
});
// The only hosts a looked-up definition can be credited to.
export const HOSTS = Object.freeze(['simple.wiktionary.org', 'en.wiktionary.org']);
export const LIST_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const PARTS = new Set(['n', 'v', 'adj', 'adv', 'interj']);
export const SOURCES = new Set(['default', 'library', 'live', 'manual']);
// Custom word ids are integers above every default id, so the existing practice code (which expects numbers) works
// unchanged.
export const FIRST_CUSTOM_ID = 1000000;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// True if any object anywhere inside `value` has a prototype-polluting key.
export function hasForbiddenKeys(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(v => hasForbiddenKeys(v, depth + 1));
  return Object.keys(value).some(k => FORBIDDEN_KEYS.includes(k) || hasForbiddenKeys(value[k], depth + 1));
}

// Lowercase, NFC, and strip anything that is not a letter from both ends ("1." and "word," become "word").
export function normalizeWord(s) {
  return String(s ?? '').normalize('NFC').trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/’/g, "'").toLocaleLowerCase('en-US'); // preflight: ok
}
export function isValidWord(w) {
  return typeof w === 'string' && w.length > 0 && Array.from(w).length <= LIMITS.wordChars && /^\p{L}[\p{L}'-]*$/u.test(w); // preflight: ok
}

// Splits text on spaces, commas, semicolons and new lines. Returns the unique valid words (in order), and what was left
// out.
export function parseWords(text) {
  const words = [], rejected = [], blocked = [];
  const seen = new Set();
  let truncated = false;
  for (const token of String(text ?? '').split(/[\s,;]+/)) {
    const w = normalizeWord(token);
    if (!w) continue;
    if (!isValidWord(w)) { rejected.push(token.slice(0, LIMITS.wordChars)); continue; }
    if (isBlockedWord(w)) { blocked.push(w); continue; }
    if (seen.has(w)) continue;
    if (words.length >= LIMITS.words) { truncated = true; continue; }
    seen.add(w); words.push(w);
  }
  return { words, rejected, blocked, truncated };
}

// A display field (definition, origin, sentence, list name). Returns the cleaned string, or null if it must not be
// shown:
// wrong type, empty, over its cap, markup, a link, or a filter hit. Fails closed.
export function cleanField(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s || Array.from(s).length > max) return null;
  if (/[<>]/.test(s) || /:\/\//.test(s) || /\b(?:javascript|data|vbscript|https?|ftp|file):/i.test(s)) return null;
  if (isBlockedText(s)) return null;
  return s;
}

// Like cleanField, and also held back if it touches a sensitive topic (mine/sensitive.js). Used for text that came
// from the library or a dictionary lookup, never for text a grown-up typed.
export function cleanSourceField(value, max, options) {
  const s = cleanField(value, max);
  return s && !isSensitiveText(s, options) ? s : null;
}

// The word must appear exactly once, as a whole word (letters, hyphens and apostrophes join a word).
export function sentenceHasWordOnce(sentence, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}'-])${escaped}(?![\\p{L}'-])`, 'giu');
  return (String(sentence).match(re) || []).length === 1;
}

// One stored or imported word entry. Returns a clean copy with only known keys, or null if the entry is unusable.
// A bad optional field is dropped (not shown); a bad id or word drops the entry.
export function validateEntry(e) {
  if (!isPlainObject(e) || hasForbiddenKeys(e)) return null;
  const word = normalizeWord(e.word);
  if (!Number.isInteger(e.id) || e.id < 1 || !isValidWord(word) || isBlockedWord(word)) return null;
  const out = { id: e.id, word, src: SOURCES.has(e.src) ? e.src : 'manual' };
  const clean = out.src === 'library' || out.src === 'live' ? cleanSourceField : cleanField;
  if (PARTS.has(e.part)) out.part = e.part;
  const definition = clean(e.definition, LIMITS.definition);
  if (definition) out.definition = definition;
  const group = clean(e.group, LIMITS.origin);
  if (group) out.group = group;
  const sentence = clean(e.sentence, LIMITS.sentence, { example: true });
  if (sentence && sentenceHasWordOnce(sentence, word)) out.sentence = sentence;
  if (out.src === 'live' && Array.isArray(e.credit)) {
    const credit = [...new Set(e.credit.filter(h => HOSTS.includes(h)))];
    if (credit.length) out.credit = credit;
  }
  return out;
}

export function validateList(l) {
  if (!isPlainObject(l) || hasForbiddenKeys(l) || !/^l-\d{1,9}$/.test(String(l.key)) || !Array.isArray(l.entries)) return null; // preflight: ok
  const seen = new Set(), entries = [];
  for (const raw of l.entries) {
    const e = validateEntry(raw);
    if (e && !seen.has(e.word) && entries.length < LIMITS.words) { seen.add(e.word); entries.push(e); }
  }
  const name = cleanField(l.name, LIMITS.listName) || 'My words';
  return { key: l.key, name, entries };
}

// The whole saved object. Returns a clean store, or null if it is not usable (the caller then treats storage as empty).
export function validateStore(s) {
  if (!isPlainObject(s) || hasForbiddenKeys(s) || s.version !== 1 || !Array.isArray(s.lists)) return null;
  const lists = [], keys = new Set();
  for (const raw of s.lists) {
    const l = validateList(raw);
    if (l && !keys.has(l.key) && lists.length < LIMITS.lists) { keys.add(l.key); lists.push(l); }
  }
  const maxId = lists.reduce((m, l) => l.entries.reduce((n, e) => Math.max(n, e.id), m), FIRST_CUSTOM_ID - 1);
  const nextId = Number.isInteger(s.nextId) && s.nextId > maxId ? s.nextId : maxId + 1;
  const active = typeof s.active === 'string' && keys.has(s.active) ? s.active : (lists[0]?.key ?? null);
  return { version: 1, nextId, active, lists };
}
