// Starred words: a child's own saved list, kept only in this browser.
// Pure helpers that take a Storage-like object (getItem/setItem/removeItem), so they run in tests with no DOM.
// Separate from the practice-history key on purpose: clearing history must not clear stars.
export const STAR_KEY = 'bee-ready-starred-v1';

// Returns a Set of word ids (integers). Missing, corrupt, non-array or unreadable storage gives an empty Set.
export function loadStars(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STAR_KEY));
    return new Set(Array.isArray(raw) ? raw.filter(Number.isInteger) : []);
  } catch { return new Set(); }
}

// Never throws (quota full, private mode, storage blocked). Returns true if the write went through.
export function saveStars(storage, set) {
  try {
    storage.setItem(STAR_KEY, JSON.stringify([...set].filter(Number.isInteger).sort((a, b) => a - b)));
    return true;
  } catch { return false; }
}

// Flips one id in place. Returns true if the word is now starred.
export function toggleStar(set, id) {
  if (set.has(id)) { set.delete(id); return false; }
  set.add(id);
  return true;
}

// Removes only the stars key. Never throws.
export function clearStars(storage) {
  try { storage.removeItem(STAR_KEY); return true; } catch { return false; }
}
