// Keeps a child's own words off the network. A word that is not in the default list has no recorded clip, so the voice
// code would ask this site's host for ./clips/<voice>/<word>.mp3 and get a 404 that still lands in the host's request log.
// This wraps fetch: a request for a clip is passed on only if its file name belongs to a default-list word or sentence (or
// the voice sample). Any other clip request is answered with a local 404, so the voice falls back to the device voice
// exactly as it does for a real 404, and nothing leaves the device.
const CLIP_URL = /\/clips\/[^/]+\/([^/?#]+)\.mp3(?:[?#]|$)/;

export function allowedClipKeys(defaultWords, { sentenceFor, clipKey, sentenceKey }) {
  const keys = new Set(['_preview']);
  for (const w of defaultWords) {
    keys.add(clipKey(w.word));
    try { keys.add(sentenceKey(sentenceFor(w))); } catch { /* no sentence */ }
  }
  return keys;
}

export function createClipGuard(realFetch, allowed) {
  return function guardedFetch(input, init) {
    let url = '';
    try { url = typeof input === 'string' ? input : (input?.url ?? String(input)); } catch { url = ''; }
    const m = CLIP_URL.exec(url);
    if (m) {
      let key = m[1];
      try { key = decodeURIComponent(key); } catch { /* keep as is */ }
      if (!allowed.has(key)) return Promise.resolve(new Response(null, { status: 404, statusText: 'Not recorded' }));
    }
    return realFetch(input, init);
  };
}

// Installs the guard on the page's fetch. Call once, before any round starts.
export function installClipGuard(scope, allowed) {
  const real = scope.fetch.bind(scope);
  scope.fetch = createClipGuard(real, allowed);
}
