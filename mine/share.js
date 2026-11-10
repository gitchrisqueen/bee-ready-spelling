// Share links: ?mode=mine&l=<id>#w=<packed words>
// The id is the first 128 bits of SHA-256(salt + the unique, lowercased, code-point-sorted words), written as 22
// base64url
// characters. The same words always give the same id. The words travel in the URL fragment, which browsers do not send
// to the
// server. A hash cannot be turned back into words; a link that has only an id needs a saved list or a lists/<id>.json
// file.
import { SALT } from './salt.js';
import { sha256Bytes } from './sha256.js';
import { LIMITS, LIST_ID_RE, parseWords } from './validate.js';

const compareCodePoints = (a, b) => {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};
export const canonicalWords = words => [...new Set(words.map(w => String(w).normalize('NFC').toLocaleLowerCase('en-US')))].sort(compareCodePoints); // preflight: ok

export function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/={1,2}$/, '');
}
export function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('bad characters');
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function listId(words) {
  const text = `${SALT}\n${canonicalWords(words).join('\n')}`;
  return toBase64Url(sha256Bytes(text).slice(0, 16));
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Reads the decompressed stream chunk by chunk and stops at the cap, so a hostile link cannot inflate to a huge size.
async function inflateCapped(bytes, cap) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { await reader.cancel(); throw new Error('too big'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// Returns the fragment value: 'p' + base64url of the text, or 'z' + base64url of the deflated text if that is shorter.
export async function packWords(words) {
  const bytes = new TextEncoder().encode(canonicalWords(words).join('\n'));
  let best = 'p' + toBase64Url(bytes);
  if (typeof CompressionStream === 'function') {
    try { const z = 'z' + toBase64Url(await deflate(bytes)); if (z.length < best.length) best = z; } catch { /* keep plain */ } // preflight: ok
  }
  return best;
}

// Returns { words } (validated like any pasted text) or { error }. Never throws.
export async function unpackWords(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > LIMITS.fragment) return { error: 'too-long' };
  const format = value[0];
  if (format !== 'p' && format !== 'z') return { error: 'format' };
  try {
    let bytes = fromBase64Url(value.slice(1));
    if (format === 'z') {
      if (typeof DecompressionStream !== 'function') return { error: 'unsupported' };
      bytes = await inflateCapped(bytes, LIMITS.unpacked);
    } else if (bytes.length > LIMITS.unpacked) {
      return { error: 'too-long' };
    }
    const { words } = parseWords(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return words.length ? { words } : { error: 'empty' };
  } catch { return { error: 'corrupt' }; }
}

// Reads ?l= and #w= from a location. The id must match LIST_ID_RE before anything else uses it.
// Returns { id, packed } where either may be null, or null if the link has neither.
export function parseShareLocation(search, hash) {
  const l = new URLSearchParams(search).get('l');
  const w = new URLSearchParams(String(hash).replace(/^#/, '')).get('w');
  const id = l !== null && LIST_ID_RE.test(l) ? l : null;
  if (id === null && w === null) return null;
  return { id, packed: w };
}

export async function buildShareUrl(base, words) {
  const url = new URL(base);
  url.search = `?mode=mine&l=${listId(words)}`;
  url.hash = `w=${await packWords(words)}`;
  return url.toString();
}

// The registry path is built only from an id that passed LIST_ID_RE, so it can hold no "/", ".", "%" or "?".
export const registryPath = id => (LIST_ID_RE.test(id) ? `./lists/${id}.json` : null);

// A registry file or a share link is accepted only if its words hash back to the id in the link.
export const idMatches = (id, words) => LIST_ID_RE.test(id) && listId(words) === id;
