// Published lists: `lists/<id>.json` files the repository owner chose to publish (docs/my-words-plan.md).
// A link that has only an id (no #w=) is looked up here. The file is untrusted input like any other: it goes
// through the same validator, and its words must hash back to the id in the link, so a file can never answer
// to a different id.
import { idMatches, listId, registryPath } from './share.js';
import { LIMITS, cleanField, hasForbiddenKeys, parseWords } from './validate.js';

// Returns { name, words } for a valid published list, or null (no file, not JSON, too big, wrong shape, a word
// the validator or the filter drops, or words that do not hash to `id`). Nothing is requested if `id` is not a
// 22-character id.
export async function loadRegistryList(fetchFn, id) {
  const path = registryPath(id);
  if (!path) return null;
  let data = null;
  try {
    const response = await fetchFn(path, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > LIMITS.unpacked) return null;
    data = JSON.parse(text);
  } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || hasForbiddenKeys(data)) return null;
  if (!Array.isArray(data.words) || data.words.length > LIMITS.words) return null;
  if (data.words.some(w => typeof w !== 'string')) return null;
  const words = parseWords(data.words.join('\n')).words;
  if (words.length !== data.words.length || !idMatches(id, words)) return null;
  return { name: cleanField(data.name, LIMITS.listName) || 'Published list', words };
}

// The file a published list is stored as: { id, text }, where text is the contents of lists/<id>.json.
// Words are checked like typed words, sorted by code point, and the id is the list id.
// Throws if any word is not allowed.
export function buildRegistryEntry(name, rawWords) {
  const parsed = parseWords(rawWords.join('\n'));
  if (parsed.rejected.length || parsed.blocked.length || parsed.truncated || !parsed.words.length) {
    const bad = [...parsed.rejected, ...parsed.blocked].join(', ') || 'none left';
    throw new Error(`these words are not allowed: ${bad}`);
  }
  const title = cleanField(name, LIMITS.listName);
  if (!title) throw new Error('the list needs a short plain name (letters and punctuation, no markup or links)');
  const id = listId(parsed.words);
  const sorted = [...new Set(parsed.words)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { id, text: `${JSON.stringify({ name: title, words: sorted }, null, 2)}\n` };
}
