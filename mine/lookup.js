// Word data from outside the default list: the static library (library/<letter>.json, same origin) and, only after a
// grown-up taps "Look up the missing words", the Wiktionary API on two hosts (see docs/my-words-plan.md).
// Everything returned has been through the validator and the child-safety filter; anything that fails is left out.
import { originLabel } from './origin.js';
import { HOSTS, LIMITS, cleanSourceField, isValidWord, normalizeWord, sentenceHasWordOnce, validateEntry } from './validate.js'; // preflight: ok

export { HOSTS };
export const API_USER_AGENT = 'BeeReady/1.0 (https://github.com/gitchrisqueen/bee-ready-spelling)';
export const REQUEST_TIMEOUT_MS = 8000;
export const CONCURRENCY = 3;
export const MAX_RETRY_AFTER_S = 30;
const POS_TITLES = { noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv', interjection: 'interj' };

export function lookupUrl(host, word) {
  if (!HOSTS.includes(host)) throw new Error('host is not allowed');
  return `https://${host}/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(word)}`
    + '&format=json&formatversion=2&origin=*';
}
export function entryUrl(host, word) {
  if (!HOSTS.includes(host)) throw new Error('host is not allowed');
  return `https://${host}/wiki/${encodeURIComponent(word)}`;
}

// ---- parsing a plain-text page extract -------------------------------------------------------------------------
function headings(text) {
  const out = [], re = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
  let m;
  while ((m = re.exec(text))) out.push({ level: m[1].length, title: m[2], start: m.index, bodyStart: m.index + m[0].length }); // preflight: ok
  return out.map((h, i) => ({ ...h, body: text.slice(h.bodyStart, i + 1 < out.length ? out[i + 1].start : text.length) })); // preflight: ok
}
// Drops a leading "(label)" and anything from "Synonym:" or "Antonym:" on, then shortens a long definition at a
// clause boundary (or, failing that, at a word boundary with an ellipsis) so it fits the cap.
function stripLeadingLabel(text) {
  if (!text.startsWith('(')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(i + 1).trim();
  }
  return text;
}
function stripLeadingLabels(line) {
  let t = line.trim();
  for (let n = 0; n < 4; n++) {
    const next = stripLeadingLabel(t).replace(/^[;:,\s]+/, '');
    if (next === t) break;
    t = next;
  }
  return t;
}
function cutDefinition(line) {
  let d = stripLeadingLabels(line);
  const marker = d.search(/(?:Synonyms?|Antonyms?|Compare):/i);
  if (marker > 0) d = d.slice(0, marker).trim();
  if (Array.from(d).length > LIMITS.definition) {
    const cut = d.slice(0, LIMITS.definition - 1);
    const at = Math.max(cut.lastIndexOf('; '), cut.lastIndexOf('. '), cut.lastIndexOf(', '));
    d = at > 40 ? `${cut.slice(0, at).replace(/[;.,]$/, '')}.` : `${cut.slice(0, cut.lastIndexOf(' '))}\u2026`;
  }
  return d;
}

// Returns { part, definition, example, origin } (each may be null) from one page extract, or null if the page has no
// usable entry. `word` is the word that was asked for. Never returns text that failed the validator or the filter.
export function parseExtract(text, word, { english = false } = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const all = headings(text);
  const englishAt = all.findIndex(h => h.level === 2 && h.title.toLowerCase() === 'english');
  let region = all;
  if (englishAt >= 0) {
    const next = all.findIndex((h, i) => i > englishAt && h.level === 2);
    region = all.slice(englishAt + 1, next < 0 ? all.length : next);
  } else if (english) {
    // An English Wiktionary page for a word that only exists in other languages has nothing for us.
    return null;
  }
  // "Noun" or "Noun 2": only the first word of a title names the part of speech.
  const posKey = h => h.title.trim().split(' ')[0].toLowerCase();
  const pos = region.find(h => Object.hasOwn(POS_TITLES, posKey(h)));
  const etym = region.find(h => /^etymology/i.test(h.title));
  let part = null, definition = null, example = null;
  if (pos) {
    part = POS_TITLES[posKey(pos)];
    const lines = pos.body.split('\n').map(l => l.trim()).filter(Boolean);
    const head = new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (lines.length && head.test(lines[0]) && /\(/.test(lines[0])) lines.shift();
    const usable = lines.filter(l => !/^\(Can we verify/i.test(l));
    if (usable.length) definition = cleanSourceField(cutDefinition(usable[0]), LIMITS.definition);
    const ex = usable.slice(1).find(l => sentenceHasWordOnce(l, word) && Array.from(l).length <= LIMITS.sentence);
    if (ex) example = cleanSourceField(ex, LIMITS.sentence, { example: true });
  }
  const origin = etym ? cleanSourceField(originLabel(etym.body) ?? '', LIMITS.origin) : null;
  if (!definition && !origin) return null;
  return { part, definition, example, origin };
}

// Merges what two pages said about one word. The Simple English page is preferred for the definition and example;
// the English page fills gaps and supplies the origin.
export function mergeResults(word, simple, english) {
  const part = simple?.part ?? english?.part ?? null;
  const definition = simple?.definition ?? english?.definition ?? null;
  if (!definition) return null;
  const out = { word, src: 'live', definition };
  if (part) out.part = part;
  const group = english?.origin ?? simple?.origin ?? null;
  if (group) out.group = group;
  const sentence = simple?.example ?? english?.example ?? null;
  if (sentence && sentenceHasWordOnce(sentence, word)) out.sentence = sentence;
  out.credit = [simple ? 'simple.wiktionary.org' : null, english ? 'en.wiktionary.org' : null].filter(Boolean);
  return out;
}

// ---- network (the caller passes fetch, so tests use a fake) ------------------------------------------------------
class Stop extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// An abort signal that fires on the caller's cancel or after `ms`, without AbortSignal.any or AbortSignal.timeout
// (older Safari versions lack them). Call done() to clear the timer.
function withTimeout(outer, ms) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  const onAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => { clearTimeout(timer); outer?.removeEventListener('abort', onAbort); },
  };
}

async function fetchHost(fetchFn, host, word, { signal, timeoutMs, retried = false }) {
  const guard = withTimeout(signal, timeoutMs);
  let response;
  try {
    response = await fetchFn(lookupUrl(host, word), {
      signal: guard.signal, headers: { 'Api-User-Agent': API_USER_AGENT }, credentials: 'omit', referrerPolicy: 'no-referrer', // preflight: ok
    });
  } catch {
    if (signal?.aborted) throw new Stop('cancelled');
    throw new Stop(guard.timedOut() ? 'timeout' : 'network');
  } finally {
    guard.done();
  }
  if (response.status === 429) {
    const raw = response.headers?.get?.('retry-after');
    const wait = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    if (!retried && Number.isFinite(wait) && wait >= 0 && wait <= MAX_RETRY_AFTER_S) {
      await sleep(wait * 1000);
      return fetchHost(fetchFn, host, word, { signal, timeoutMs, retried: true });
    }
    throw new Stop('rate-limit');
  }
  if (response.status === 403) throw new Stop('blocked');
  if (!response.ok) throw new Stop('server');
  let data;
  try { data = await response.json(); } catch { throw new Stop('shape'); }
  const page = data?.query?.pages?.[0];
  if (!page || typeof page !== 'object') throw new Stop('shape');
  if (page.missing) return null;
  if (typeof page.extract !== 'string') throw new Stop('shape');
  return parseExtract(page.extract, word, { english: host === HOSTS[1] });
}

// Looks one word up on both hosts. Returns { status: 'found', entry } or { status: 'missing' }; throws { reason } on a
// hard failure.
export async function lookupOne(fetchFn, word, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const simple = await fetchHost(fetchFn, HOSTS[0], word, { signal: opts.signal, timeoutMs });
  const english = await fetchHost(fetchFn, HOSTS[1], word, { signal: opts.signal, timeoutMs });
  const entry = mergeResults(word, simple, english);
  return entry ? { status: 'found', entry } : { status: 'missing' };
}

// Runs the lookups for the words still missing: at most CONCURRENCY at a time, results cached by the caller's `cache`
// (a plain object keyed by word, kept in `bee-ready-mine-lookup-v1`). The first hard failure stops everything, and the
// words not yet done stay as they were. Returns { results: {word: entry|null}, stopped: reason|null }.
export async function lookupMissing(words, { fetchFn, cache = {}, signal, onProgress = () => {}, timeoutMs } = {}) {
  const results = {};
  const todo = [];
  for (const w of words) {
    if (Object.hasOwn(cache, w)) results[w] = cache[w];
    else todo.push(w);
  }
  let stopped = null, done = words.length - todo.length;
  onProgress(done, words.length);
  let next = 0;
  async function worker() {
    while (!stopped && next < todo.length) {
      const word = todo[next++];
      try {
        const r = await lookupOne(fetchFn, word, { signal, timeoutMs });
        results[word] = r.status === 'found' ? r.entry : null;
        cache[word] = results[word];
      } catch (err) {
        stopped ??= err instanceof Stop ? err.reason : 'network';
        return;
      }
      onProgress(++done, words.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { results, stopped };
}

// ---- the static library ------------------------------------------------------------------------------------------
const shards = new Map();
export const shardUrl = letter => (/^[a-z]$/.test(letter) ? `./library/${letter}.json` : null);
// Returns the shard (an object keyed by word) or null. Cached; a failed download is cached as null for this page view.
export async function loadShard(fetchFn, letter) {
  const url = shardUrl(letter);
  if (!url) return null;
  if (!shards.has(letter)) {
    shards.set(letter, (async () => {
      try {
        const r = await fetchFn(url);
        if (!r.ok) return null;
        const data = await r.json();
        return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
      } catch { return null; }
    })());
  }
  return shards.get(letter);
}
export function resetShardCache() { shards.clear(); }

export async function libraryEntry(fetchFn, word) {
  const w = normalizeWord(word);
  const shard = await loadShard(fetchFn, w[0]?.normalize('NFD')[0] ?? '');
  if (!shard || !Object.hasOwn(shard, w)) return null;
  const raw = shard[w];
  if (!raw || typeof raw !== 'object') return null;
  const definition = cleanSourceField(raw.definition, LIMITS.definition);
  if (!definition) return null;
  const out = { word: w, src: 'library', definition };
  if (['n', 'v', 'adj', 'adv', 'interj'].includes(raw.part)) out.part = raw.part;
  const group = cleanSourceField(raw.group, LIMITS.origin);
  if (group) out.group = group;
  const sentence = cleanSourceField(raw.sentence, LIMITS.sentence, { example: true });
  if (sentence && sentenceHasWordOnce(sentence, w)) out.sentence = sentence;
  return out;
}

// The cached lookups come back from storage that other pages on the same origin can write, so each one is validated
// like any other entry: a bad entry is dropped, a `null` ("not found") is kept, and unknown keys and credit hosts go.
export function cleanLookupCache(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const word of Object.keys(raw).slice(0, LIMITS.lookupEntries)) {
    if (!isValidWord(word) || word !== normalizeWord(word)) continue;
    const value = raw[word];
    if (value === null) { out[word] = null; continue; }
    const e = validateEntry({ ...(typeof value === 'object' ? value : {}), word, id: 1, src: 'live' });
    if (e && e.definition) { const { id, ...rest } = e; out[word] = rest; }
  }
  return out;
}
