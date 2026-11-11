// The "My words" screen. app.js loads this module only for ?mode=mine, and hands it the default word list and a
// function that swaps the practice screen's word source. Text is set with textContent and DOM calls only; no markup
// is built from imported or looked-up text here. Nothing is sent to Wikimedia until a grown-up taps "Look up the
// missing words" and confirms (docs/my-words-plan.md, "Third-party requests").
import { sentenceFor } from '../sentences.js';
import { clipKey, sentenceKey } from '../voice-service.js';
import { allowedClipKeys, installClipGuard } from './clipguard.js';
import { LIVE_LOOKUP_ENABLED, OCR_ENABLED } from './config.js';
import { filterReady, loadBlocklist } from './filter.js';
import {
  chipsToEntries, entryFromBackup, fillEntry, needsDefinition, resolveWords, toPracticeWord,
} from './import.js';
import {
  LOOKUP_KEY, MAX_IMPORT_BYTES, addEntries, addList, deleteAll, deleteList, dropOldestBackup, exportJson,
  findListByWords, loadSettings, loadStore, parseExport, saveSettings, saveStore, updateList, writeBackup,
} from './lists.js';
import { HOSTS, cleanLookupCache, entryUrl, libraryEntry, lookupMissing } from './lookup.js';
import { MAX_PHOTO_BYTES, OCR_DIR, loadTesseract, ocrOptions, readPhoto } from './ocr.js';
import { loadRegistryList } from './registry.js';
import { buildShareUrl, idMatches, listId, parseShareLocation, unpackWords } from './share.js';
import { LIMITS, cleanField, normalizeWord, parseWords } from './validate.js';

export { starsStorage } from './lists.js';

const $ = id => document.getElementById(id);
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}
const storage = () => { try { return localStorage; } catch { return null; } };
const nullStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
const STATUS_TEXT = {
  default: 'In the Bee Ready list. It keeps its recorded voice.',
  library: 'Found in the Bee Ready library.',
  live: 'Looked up on Wiktionary.',
  missing: 'Not found yet. You can type a definition, or ask a grown-up to look it up.',
};
const STOP_TEXT = {
  timeout: 'Wiktionary did not answer in time.', network: 'The page could not reach Wiktionary.',
  'rate-limit': 'Wiktionary asked us to slow down.', blocked: 'Wiktionary did not allow the request.',
  server: 'Wiktionary had a problem.', shape: 'Wiktionary sent something unexpected.', cancelled: 'Lookup stopped.',
};
const SHARED_NAME = 'Shared list';
const ROUND_MAX = 20;      // the largest round the count buttons offer
const LINK_FULL_TEXT = 'You already have the most lists you can keep. A grown-up needs to delete one first: open '
  + 'the Word bank tab, pick a list in My lists, press Delete this list, then press Start my spelling bee again.';
// A link's list never takes the name of a list already saved: "Shared list" becomes "Shared list (2)".
function uniqueName(store, name) {
  const taken = new Set(store.lists.map(l => l.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const next = `${name.slice(0, LIMITS.listName - 6)} (${i})`;
    if (!taken.has(next)) return next;
  }
}
const SAME_LIST_TEXT = 'You already have this list. It is ready: press Start my spelling bee.';
const CONFIRM_LOOKUP = 'This sends the words that were not found, and this device\'s IP address, to Wiktionary '
  + '(Wikimedia). Only a grown-up should say yes. Send them?';

export async function start({ defaultWords, setWords, shareHash = '' }) {
  const store0 = storage() ?? nullStorage;
  const defaultByWord = new Map(defaultWords.map(w => [w.word.toLowerCase(), w]));
  const defaultById = new Map(defaultWords.map(w => [w.id, w]));
  const fetchFn = (...args) => fetch(...args);
  const state = { store: null, settings: loadSettings(store0), readOnly: false };
  let chips = [];            // the review list, not yet saved
  let sharedNote = '';       // set when the review came from a share link
  let linkName = null;       // set while a list from a link waits to be started; its words stay hidden
  let lookupAbort = null;
  let nextChip = 1;
  let pendingEdits = 0;      // word edits still being looked up; Save waits for them
  let flip = false;
  const openUids = new Set();

  // Words typed here must not reach this site's host as clip file names (see mine/clipguard.js).
  installClipGuard(globalThis, allowedClipKeys(defaultWords, { sentenceFor, clipKey, sentenceKey }));

  // A status message in the polite live region of the tab the person is on (a region inside a hidden tab is never
  // read out). The trailing no-break space makes a repeated message read again.
  const status = text => {
    flip = !flip;
    const out = text ? text + (flip ? '' : '\u00a0') : '';
    const onPractice = $('tab-practice').classList.contains('active');
    $('minePracticeStatus').textContent = onPractice ? out : '';
    $('mineStatus').textContent = onPractice ? '' : out;
  };
  // Returns false when the words could not be saved (a message says so).
  const persist = () => {
    if (state.readOnly) return false;
    if (saveStore(store0, state.store)) return true;
    status('This device could not save your words. Use Save a backup file in My lists.');
    return false;
  };
  const active = () => state.store.lists.find(l => l.key === state.store.active) ?? null;
  const focusSoon = target => { if (target) requestAnimationFrame(() => target.focus({ preventScroll: false })); };

  // ---- screen set-up ---------------------------------------------------------------------------------------------
  // Practice tab: which list is in use and a link's start card. Word bank tab: the lists, adding words and the words.
  for (const id of ['mineRoot', 'mineBank', 'mineAdd', 'mineWordsHead', 'mineCredits']) $(id).hidden = false;
  document.querySelector('#wordBankPanel > h2.sr-only')?.setAttribute('hidden', ''); // the visible list heading replaces it // preflight: ok
  $('mineGrownups').hidden = false;
  $('mineEnterBlock').hidden = true;
  $('mineSettingsBlock').hidden = false;
  $('minePhotoBlock').hidden = !OCR_ENABLED;
  document.documentElement.classList.add('mine-mode');
  for (const v of ['study', 'challenge']) $('pool').querySelector(`option[value="${v}"]`)?.remove();
  $('levelFilter').closest('label')?.setAttribute('hidden', '');
  document.querySelectorAll('#roundBuilder .helper').forEach(p => { if (/booklet/i.test(p.textContent)) p.hidden = true; }); // preflight: ok
  const bankIntro = document.querySelector('#tab-words .section-intro p');
  if (bankIntro) {
    bankIntro.textContent = 'Keep your own lists here. Add words, then look through them: press Details on a word '
      + 'for its sentence, origin and slow audio, and press the star (☆) on a word you want to practice again.';
  }
  const bankKicker = document.querySelector('#tab-words .section-intro .mini-kicker');
  if (bankKicker) bankKicker.textContent = 'MY WORDS';
  const bankNote = document.querySelector('#tab-words .results-head span');
  if (bankNote) bankNote.textContent = 'Press Remove on a word to take it out of this list.';
  const aboutClues = document.querySelector('.foot-note p');
  if (aboutClues) {
    aboutClues.textContent = '“Origin” is the language a word came from, taken from the Bee Ready library or '
      + 'Wiktionary. Some words travelled through several languages, so it is not the whole story. '
      + 'Definitions are simplified study explanations, not official competition definitions. '
      + 'Spelling bee rules vary by organizer.';
  }

  // The safety list must load first. Without it every word looks blocked, and saving would wipe the saved lists, so the
  // screen stays read-only: nothing is read, nothing is written.
  try { await loadBlocklist(fetchFn); } catch { /* handled below */ }
  if (!filterReady()) {
    state.readOnly = true;
    state.store = loadStore(store0).store;
    status('The safety list could not load, so My words is turned off for now. Your lists are safe. Please refresh the page.'); // preflight: ok
    const off = '#mineBank button, #mineBank input, #mineBank select, #mineAdd button, #mineAdd input, #mineAdd textarea, ' // preflight: ok
      + '#mineFillBlock button, #mineSettingsBlock button, #mineSettingsBlock input';
    document.querySelectorAll(off).forEach(c => { c.disabled = true; });
    setWords([]);
    return;
  }

  const loaded = loadStore(store0);
  state.store = loaded.store;
  if (loaded.status === 'corrupt') {
    status('Your saved words could not be read, so we started a fresh list. The old data was kept as a backup if there was room.'); // preflight: ok
    if (loaded.backup === 'full'
      && confirm('Your saved words could not be read and the backups are full. Drop the oldest backup to keep this one?')) { // preflight: ok
      dropOldestBackup(store0);
      writeBackup(store0, loaded.raw);
    }
  }
  let cache = {};
  try { cache = cleanLookupCache(JSON.parse(store0.getItem(LOOKUP_KEY))); } catch { cache = {}; }
  const saveCache = () => {
    const keys = Object.keys(cache);
    for (const k of keys.slice(0, Math.max(0, keys.length - LIMITS.lookupEntries))) delete cache[k];
    try { store0.setItem(LOOKUP_KEY, JSON.stringify(cache)); } catch { /* full */ }
  };

  // ---- the saved lists -------------------------------------------------------------------------------------------
  function renderLists() {
    const sel = $('mineList');
    sel.replaceChildren();
    for (const l of state.store.lists) sel.append(el('option', { value: l.key, text: `${l.name} (${l.entries.length})` })); // preflight: ok
    if (!state.store.lists.length) sel.append(el('option', { value: '', text: 'No lists yet' }));
    sel.value = state.store.active ?? '';
    const a = active();
    $('mineName').value = a?.name ?? '';
    $('mineName').disabled = !a;
    $('mineDelete').disabled = !a;
    $('mineShare').disabled = !a?.entries.length;
    $('mineExport').disabled = !state.store.lists.length;
    const count = a?.entries.length ?? 0;
    const plural = `${count} ${count === 1 ? 'word' : 'words'}`;
    $('mineWordsHead').textContent = a ? `${a.name}: ${plural}` : 'Your list';
    // The Practice tab says which list the round uses, and points to the Word bank to change it.
    $('minePracticeTitle').textContent = count ? `Practicing: ${a.name}` : 'Add your words to begin';
    $('minePracticeText').textContent = count
      ? `${plural} in this list. Choose how many to practice below.`
      : 'You have no words yet. Add the words you want to practice in the Word bank.';
    $('minePracticeAdd').hidden = count > 0;
    $('minePracticeChange').hidden = count === 0;
    // Words with no definition (a share link carries only the words) can be looked up again.
    const missing = (a?.entries ?? []).filter(needsDefinition).length;
    $('mineFillBlock').hidden = missing === 0;
    $('mineFillText').textContent = `${missing} ${missing === 1 ? 'word has' : 'words have'} no definition yet. `
      + 'A share link carries only the words, so definitions are looked up again on this device.';
  }
  function activate() {
    const a = active();
    setWords(a ? a.entries.map(e => toPracticeWord(e, defaultById)) : []);
    renderLists();
  }

  // ---- the review screen -----------------------------------------------------------------------------------------
  function chipNode(chip, index, total) {
    const inputId = `mine-chip-${chip.uid}`, statusId = `mine-chip-status-${chip.uid}`;
    const li = el('li', { class: 'mine-chip', 'data-uid': chip.uid });
    const input = el('input', {
      id: inputId, type: 'text', value: chip.word, maxlength: LIMITS.wordChars, autocomplete: 'off', autocapitalize: 'off', // preflight: ok
      spellcheck: 'false', 'aria-label': `Word ${index + 1} of ${total}`, 'aria-describedby': statusId,
      'aria-invalid': chip.invalid ? 'true' : null,
    });
    // "change" fires while focus is still moving to the next control;
    // wait a tick so the list is rebuilt after focus settles.
    input.addEventListener('change', () => {
      const value = input.value;
      pendingEdits++;
      setTimeout(() => { pendingEdits--; editChip(chip, value); }, 0);
    });
    li.append(el('div', { class: 'mine-chip-row' }, input,
      el('button', { type: 'button', class: 'text-btn', 'data-chip-remove': chip.uid, 'aria-label': `Remove ${chip.word}`, text: 'Remove' }))); // preflight: ok
    li.append(el('p', { id: statusId, class: 'mine-chip-status', text: chip.invalid ?? STATUS_TEXT[chip.status] }));
    if (chip.suggestion) {
      li.append(el('button', { type: 'button', class: 'soft-btn', 'data-chip-use': chip.uid,
        text: `Did you mean ${chip.suggestion}? Use it` }));
    }
    const credit = Array.isArray(chip.entry?.credit) ? chip.entry.credit.filter(h => HOSTS.includes(h)) : [];
    if (chip.status === 'live' && credit.length) {
      const p = el('p', { class: 'mine-chip-credit', text: 'Source: ' });
      credit.forEach((host, i) => {
        if (i) p.append(', ');
        p.append(el('a', { href: entryUrl(host, chip.word), target: '_blank', rel: 'noopener noreferrer' }, host,
          el('span', { class: 'sr-only', text: ' (opens in a new tab)' })));
      });
      p.append(' (CC BY-SA 4.0)');
      li.append(p);
    }
    if (chip.status !== 'default' && !chip.invalid) {
      const details = el('details', { class: 'mine-chip-edit' }, el('summary', { text: 'Edit definition and sentence' })); // preflight: ok
      details.open = openUids.has(chip.uid);
      details.addEventListener('toggle', () => { if (details.open) openUids.add(chip.uid); else openUids.delete(chip.uid); }); // preflight: ok
      const defId = `mine-def-${chip.uid}`, senId = `mine-sen-${chip.uid}`;
      const def = el('textarea', { id: defId, rows: 2, maxlength: LIMITS.definition, autocomplete: 'off' });
      def.value = typeof chip.entry?.definition === 'string' ? chip.entry.definition : '';
      def.addEventListener('input', () => { chip.entry = { ...(chip.entry ?? {}), definition: def.value }; });
      const sen = el('input', { id: senId, type: 'text', maxlength: LIMITS.sentence, autocomplete: 'off' });
      sen.value = typeof chip.entry?.sentence === 'string' ? chip.entry.sentence : '';
      sen.addEventListener('input', () => { chip.entry = { ...(chip.entry ?? {}), sentence: sen.value }; });
      details.append(el('label', { for: defId, text: 'Definition' }), def,
        el('label', { for: senId, text: 'A sentence that uses the word once' }), sen);
      li.append(details);
    }
    return li;
  }
  // Where keyboard focus is inside the review list, so it can be put back after a chip is rebuilt.
  // Every focusable control in a chip is covered: word box, Remove, Use it, the Edit summary,
  // its two fields and the source links.
  const SPOTS = {
    input: '.mine-chip-row input', remove: '[data-chip-remove]', use: '[data-chip-use]', summary: 'summary',
    def: 'textarea[id^="mine-def-"]', sen: 'input[id^="mine-sen-"]', credit: '.mine-chip-credit a',
  };
  function focusSpot() {
    const a = document.activeElement;
    const li = a?.closest?.('#mineChips li');
    if (!li) return null;
    const kind = Object.keys(SPOTS).find(k => a.matches(SPOTS[k]));
    if (!kind) return null;
    return { uid: li.dataset.uid, kind, index: [...li.querySelectorAll(SPOTS[kind])].indexOf(a) };
  }
  function restoreFocus(spot) {
    if (!spot) return;
    const li = document.querySelector(`#mineChips li[data-uid="${spot.uid}"]`);
    // If the same control no longer exists (the chip changed), the chip's word box is the next best place.
    focusSoon(li?.querySelectorAll(SPOTS[spot.kind])[spot.index] ?? li?.querySelector(SPOTS.input));
  }
  function updateReviewControls() {
    const missing = chips.filter(c => c.status === 'missing' && !c.invalid).length;
    $('mineReviewSummary').textContent = `${chips.length} ${chips.length === 1 ? 'word' : 'words'}. ${missing
      ? `${missing} ${missing === 1 ? 'is' : 'are'} not found yet.` : 'Every word has what it needs.'}${sharedNote ? ` ${sharedNote}` : ''}`; // preflight: ok
    $('mineLookup').hidden = !(LIVE_LOOKUP_ENABLED && state.settings.liveLookup) || !missing;
    $('mineLookupBlock').hidden = $('mineLookup').hidden;
    $('mineSave').disabled = !chips.some(c => !c.invalid);
    if (linkName !== null) updateLinkCard(missing);
  }
  function renderReview() {
    const spot = focusSpot();
    $('mineReview').hidden = !chips.length || (linkName !== null && !$('mineLinkGrownups').open);
    $('mineChips').replaceChildren(...chips.map((c, i) => chipNode(c, i, chips.length)));
    updateReviewControls();
    restoreFocus(spot);
  }
  // Rebuilds one chip only, so the buttons of the other chips are not replaced under a child's finger.
  function replaceChip(at) {
    const spot = focusSpot();
    const old = document.querySelector(`#mineChips li[data-uid="${chips[at].uid}"]`);
    if (!old) { renderReview(); return; }
    old.replaceWith(chipNode(chips[at], at, chips.length));
    updateReviewControls();
    if (spot && spot.uid === String(chips[at].uid)) restoreFocus(spot);
  }
  // ---- a list that came from a link: the speller sees a start button, not the words ------------------------------
  function updateLinkCard(missing) {
    const n = chips.filter(c => !c.invalid).length;
    const noDefinition = missing
      ? ` ${missing} ${missing === 1 ? 'word has' : 'words have'} no definition yet, so the clues will be short.`
        + ' A grown-up can look them up now, or later in the Word bank.'
      : '';
    const label = linkName === SHARED_NAME ? 'This list' : `"${linkName}"`;
    const roundNote = n > ROUND_MAX ? ` Each round uses ${ROUND_MAX} of them.` : '';
    $('mineLinkText').textContent = `${label} has ${n} ${n === 1 ? 'word' : 'words'}. `
      + `The words stay hidden so you can practice without peeking.${roundNote}${noDefinition}`;
    $('mineLinkStart').disabled = n === 0;
  }
  // While the start card shows on the Practice tab, the round builder is out of sight, so there is one start button.
  // The Word bank tab keeps its lists and words, but its Add words box (typing and photo) gives way to a note: a
  // second review would replace the link's words. The review block moves into the card's grown-up check, and back.
  function setLinkOpen(open) {
    document.documentElement.classList.toggle('mine-link-open', open);
    $('mineLinkCard').hidden = !open;
    $('mineLinkWait').hidden = !open;
    $('mineRoot').setAttribute('aria-labelledby', open ? 'mineLinkTitle' : 'minePracticeTitle');
    $('minePractice').hidden = open;
    $('roundBuilder').hidden = open;
    $('mineLinkGrownups').open = false;
    (open ? $('mineLinkGrownups') : $('mineAdd')).append($('mineReview'));
    if (!open) linkName = null;
  }
  // `name` is the list's name; `words` stay hidden until a grown-up opens the check.
  async function showLink(words, name) {
    const resolved = await resolveInto(words);
    linkName = cleanField(name, LIMITS.listName) || SHARED_NAME;
    chips = resolved;
    sharedNote = '';
    setLinkOpen(true);
    renderReview();
    $('mineLinkTitle').focus({ preventScroll: false });
  }
  async function resolveInto(words) {
    const resolved = await resolveWords(words, { defaultByWord, fetchFn });
    return resolved.map(c => ({ ...c, uid: nextChip++ }));
  }
  async function showReview(words, note = '') {
    sharedNote = note;
    chips = await resolveInto(words);
    renderReview();
    $('mineReviewTitle').focus({ preventScroll: false });
  }
  async function editChip(chip, value, { focusInput = false } = {}) {
    pendingEdits++;
    try {
      const { words } = parseWords(value);
      const at = chips.indexOf(chip);
      if (at < 0) return;
      if (words.length !== 1) {
        chips[at] = { ...chip, word: normalizeWord(value), invalid: 'Use one word, with letters, hyphens or apostrophes.' }; // preflight: ok
      } else {
        const [fresh] = await resolveInto(words);
        chips[at] = { ...fresh, uid: chip.uid };
      }
      replaceChip(at);
      // Focus is restored to the control the user moved to; only "Use it" moves it into the word box.
      if (focusInput) focusSoon(document.querySelector(`#mineChips li[data-uid="${chip.uid}"] .mine-chip-row input`));
      status(`${chips[at].word}: ${chips[at].invalid ?? STATUS_TEXT[chips[at].status]}`);
    } finally { pendingEdits--; }
  }
  function removeChip(uid) {
    const at = chips.findIndex(c => c.uid === uid);
    if (at < 0) return;
    const [gone] = chips.splice(at, 1);
    renderReview();
    status(`Removed ${gone.word}.`);
    const next = chips[at] ?? chips[at - 1];
    focusSoon(next ? document.querySelector(`#mineChips li[data-uid="${next.uid}"] .mine-chip-row input`) : addBox()); // preflight: ok
  }
  // Where focus goes when the review has nothing left: Add words, or (for a link's list) the grown-up check.
  const addBox = () => (linkName !== null ? $('mineLinkGrownups').querySelector('summary') : $('mineText'));

  async function onCheck() {
    const { words, rejected, blocked, truncated } = parseWords($('mineText').value);
    const notes = [];
    if (rejected.length) {
      const shown = rejected.slice(0, 5).map(w => (w.length > 12 ? `${w.slice(0, 12)}…` : w)).join(', ');
      notes.push(`Left out: ${shown}${rejected.length > 5 ? ` and ${rejected.length - 5} more` : ''}. Use letters, hyphens and apostrophes only.`); // preflight: ok
    }
    if (blocked.length) {
      const count = blocked.length === 1 ? '1 word' : `${blocked.length} words`;
      notes.push(`${count} can't be added here (not on our safe list).`);
    } // preflight: ok
    if (truncated) notes.push(`Only the first ${LIMITS.words} words were kept.`);
    if (!words.length) { status(`No words found. ${notes.join(' ')}`.trim()); return; }
    status(notes.join(' '));
    await showReview(words);
  }

  async function onLookup() {
    const missing = chips.filter(c => c.status === 'missing' && !c.invalid).map(c => c.word);
    if (!missing.length) return;
    // A grown-up must say yes before anything is sent (docs/my-words-plan.md): no request is made before this answer.
    if (!confirm(CONFIRM_LOOKUP)) { status('Nothing was sent.'); return; }
    lookupAbort = new AbortController();
    $('mineCancelLookup').hidden = false;
    $('mineLookup').disabled = true;
    $('mineCancelLookup').focus();
    status(`Looking up ${missing.length} ${missing.length === 1 ? 'word' : 'words'}. This can take a moment.`);
    const { results, stopped } = await lookupMissing(missing, { fetchFn, cache, signal: lookupAbort.signal });
    lookupAbort = null;
    $('mineCancelLookup').hidden = true;
    $('mineLookup').disabled = false;
    saveCache();
    chips = chips.map(c => (c.status === 'missing' && Object.hasOwn(results, c.word) && results[c.word]
      ? { ...c, status: 'live', entry: results[c.word] } : c));
    const found = chips.filter(c => c.status === 'live' && missing.includes(c.word)).length;
    renderReview();
    status(`${found} of ${missing.length} looked up.${stopped ? ` ${STOP_TEXT[stopped] ?? ''} You can type the rest yourself.` : ''}`); // preflight: ok
    focusSoon($('mineSave'));
  }

  // The saved list's words that still have no definition: the library on this site first, then (only if a grown-up
  // agrees) Wiktionary. A word Wiktionary once answered "not found" for is asked again, because this is a retry.
  async function onFill() {
    const a = active();
    const todo = a ? a.entries.filter(needsDefinition) : [];
    if (!todo.length) return;
    const found = new Map();
    for (const e of todo) {
      const hit = await libraryEntry(fetchFn, e.word);
      if (hit) found.set(e.word, { entry: hit, src: 'library' });
    }
    const rest = todo.map(e => e.word).filter(w => !found.has(w));
    let stopped = null, note = '';
    if (rest.length && LIVE_LOOKUP_ENABLED && state.settings.liveLookup) {
      if (!confirm(CONFIRM_LOOKUP)) note = ' Nothing was sent to Wiktionary.';
      else {
        rest.forEach(w => { delete cache[w]; });
        lookupAbort = new AbortController();
        $('mineFillStop').hidden = false;
        $('mineFill').disabled = true;
        $('mineFillStop').focus();
        status(`Looking up ${rest.length} ${rest.length === 1 ? 'word' : 'words'}. This can take a moment.`);
        const out = await lookupMissing(rest, { fetchFn, cache, signal: lookupAbort.signal });
        lookupAbort = null;
        stopped = out.stopped;
        saveCache();
        for (const w of rest) if (out.results[w]) found.set(w, { entry: out.results[w], src: 'live' });
        $('mineFillStop').hidden = true;
        $('mineFill').disabled = false;
      }
    } else if (rest.length) note = ' Looking up on Wiktionary is turned off in Grown-ups.';
    if (found.size) {
      state.store = updateList(state.store, a.key, l => ({
        entries: l.entries.map(e => (found.has(e.word) ? fillEntry(e, found.get(e.word).entry, found.get(e.word).src) : e)), // preflight: ok
      }));
      persist();
      activate();
    }
    const left = (active()?.entries ?? []).filter(needsDefinition).length;
    status(`Found definitions for ${found.size} of ${todo.length} ${todo.length === 1 ? 'word' : 'words'}.`
      + `${left ? ` ${left} still ${left === 1 ? 'has' : 'have'} none.` : ''}${note}`
      + `${stopped ? ` ${STOP_TEXT[stopped] ?? ''}` : ''}`);
    focusSoon(left ? $('mineFill') : $('mineWordsHead'));
  }

  async function onSave({ start = false } = {}) {
    while (pendingEdits > 0) await new Promise(r => setTimeout(r, 20));
    const entries = chipsToEntries(chips.filter(c => !c.invalid));
    let { store } = state;
    if (linkName !== null) {
      // A list from a link becomes its own list, named after the link, and is the one practiced next.
      const made = addList(store, uniqueName(store, linkName), entries);
      if (!made.list) { status(LINK_FULL_TEXT); return; }
      const name = made.list.name, count = made.list.entries.length;
      state.store = made.store;
      persist();
      chips = []; sharedNote = ''; openUids.clear();
      setLinkOpen(false);
      renderReview();
      activate();
      status(`${name} is ready: ${count} ${count === 1 ? 'word' : 'words'}.`);
      if (start) {
        // The round uses the whole list, up to ROUND_MAX words; the count buttons follow the number.
        $('wordCount').value = String(Math.min(count, ROUND_MAX));
        $('wordCount').dispatchEvent(new Event('input'));
        $('startRound').click();
      } else focusSoon($('minePracticeTitle'));
      return;
    }
    if (!active()) {
      const made = addList(store, 'My words', []);
      if (!made.list) { status('You already have the most lists you can keep. Delete one first.'); return; }
      store = made.store;
    }
    const before = store.lists.find(l => l.key === store.active).entries.length;
    store = addEntries(store, store.active, entries);
    const added = store.lists.find(l => l.key === store.active).entries.length - before;
    state.store = store;
    persist();
    chips = []; sharedNote = ''; openUids.clear();
    $('mineText').value = '';
    renderReview();
    activate();
    status(`${added} ${added === 1 ? 'word' : 'words'} saved. Words already in the list were not added twice.`);
    focusSoon($('mineWordsHead'));
  }

  // ---- photo import ----------------------------------------------------------------------------------------------
  // The picture buttons stay enabled while a read runs (so keyboard focus is never dropped); a second picture is
  // ignored.
  let photoBusy = false;
  function setPhotoBusy(busy) {
    photoBusy = busy;
    $('minePhotoBlock').setAttribute('aria-busy', String(busy));
  }
  async function onPhoto(file, input) {
    if (!file) return;
    if (photoBusy) { status('Still reading the first picture. Please wait a moment.'); return; }
    if (file.size > MAX_PHOTO_BYTES) { status('That picture is too big. Try a smaller one.'); return; }
    const base = new URL(OCR_DIR, document.baseURI).href;
    const env = {
      createImageBitmap: f => createImageBitmap(f), makeCanvas: () => document.createElement('canvas'),
      loadTesseract: () => loadTesseract(document, base), options: ocrOptions(base),
    };
    setPhotoBusy(true);
    status('Reading your picture on this device. The first one downloads about 7 MB from this site. Nothing is uploaded.'); // preflight: ok
    let reviewed = false;
    try {
      const { words, blocked } = await readPhoto(file, env, {
        onStage: stage => { if (stage === 'reading') status('Reading the words now.'); },
      });
      if (!words.length) {
        status('No words were found in that picture. Try a clearer, closer photo, or type the words.');
        return;
      }
      await showReview(words, 'Read from a picture. Check every word, and remove any names. Handwriting is harder to read than print.'); // preflight: ok
      reviewed = true;
      const skipped = blocked.length ? ` ${blocked.length === 1 ? '1 word' : `${blocked.length} words`} can't be added here (not on our safe list).` : ''; // preflight: ok
      status(`Found ${words.length} ${words.length === 1 ? 'word' : 'words'}. Check them below.${skipped}`);
    } catch (error) {
      // The name and message only: never the file, its name or any image data.
      console.warn('My words photo import failed:', error?.name, error?.message);
      status('This browser could not read the picture. You can type the words instead.');
    } finally {
      setPhotoBusy(false);
      if (!reviewed) focusSoon(input);
    }
  }
  for (const id of ['minePhotoCamera', 'minePhotoPick']) {
    $(id).addEventListener('change', e => { const file = e.target.files?.[0]; e.target.value = ''; onPhoto(file, e.target); }); // preflight: ok
  }

  // ---- list actions ----------------------------------------------------------------------------------------------
  $('mineCheck').addEventListener('click', onCheck);
  $('mineLookup').addEventListener('click', onLookup);
  $('mineCancelLookup').addEventListener('click', () => lookupAbort?.abort());
  $('mineFill').addEventListener('click', onFill);
  $('mineFillStop').addEventListener('click', () => lookupAbort?.abort());
  $('mineSave').addEventListener('click', () => onSave());
  $('mineLinkStart').addEventListener('click', () => onSave({ start: true }));
  $('mineLinkGrownups').addEventListener('toggle', () => {
    if (linkName !== null) $('mineReview').hidden = !chips.length || !$('mineLinkGrownups').open;
  });
  $('mineCancel').addEventListener('click', () => {
    chips = []; sharedNote = ''; openUids.clear();
    const fromLink = linkName !== null;
    if (fromLink) setLinkOpen(false);
    renderReview(); status('Nothing was saved.'); // preflight: ok
    focusSoon(fromLink ? $('minePracticeTitle') : $('mineText'));
  });
  $('mineChips').addEventListener('click', async e => {
    const rm = e.target.closest('[data-chip-remove]');
    if (rm) { removeChip(Number(rm.dataset.chipRemove)); return; }
    const use = e.target.closest('[data-chip-use]');
    if (use) {
      const c = chips.find(x => x.uid === Number(use.dataset.chipUse));
      if (c) await editChip(c, c.suggestion, { focusInput: true });
    } // preflight: ok
  });
  $('mineList').addEventListener('change', () => {
    state.store = { ...state.store, active: $('mineList').value || null };
    persist(); activate();
    status(`Showing ${active()?.name ?? 'no list'}.`);
  });
  $('mineName').addEventListener('change', () => {
    const a = active();
    if (!a) return;
    const name = cleanField($('mineName').value, LIMITS.listName) || a.name;
    state.store = updateList(state.store, a.key, () => ({ name }));
    persist(); renderLists();
  });
  $('mineNew').addEventListener('click', () => {
    const made = addList(state.store, 'New list', []);
    if (!made.list) { status('You already have the most lists you can keep. Delete one first.'); return; }
    state.store = made.store; persist(); activate(); $('mineName').focus(); $('mineName').select();
  });
  $('mineDelete').addEventListener('click', () => {
    const a = active();
    if (!a || !confirm(`Delete the list "${a.name}" from this device? This cannot be undone.`)) return;
    state.store = deleteList(store0, state.store, a.key);
    activate(); status('List deleted.');
    focusSoon($('mineName').disabled ? $('mineText') : $('mineList'));
  });
  // Remove sits on each word's card in the Word bank. app.js re-draws the cards when the list changes.
  $('wordGrid').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove-id]');
    const a = active();
    if (!rm || !a) return;
    const id = Number(rm.dataset.removeId);
    const gone = a.entries.find(x => x.id === id);
    // Like "Delete this list", a removal asks first: a saved definition cannot be edited, only typed again.
    if (!gone || !confirm(`Take "${gone.word}" out of "${a.name}"? This cannot be undone.`)) return;
    const at = [...$('wordGrid').querySelectorAll('[data-remove-id]')].indexOf(rm);
    state.store = updateList(state.store, a.key, l => ({ entries: l.entries.filter(x => x.id !== id) }));
    const saved = persist();
    activate();
    // If the words could not be saved, keep that message: the card is gone from the page but not from the device.
    if (saved) status(`Removed ${gone.word} from the list.`);
    // Focus goes to the next card's Remove button, so it is never lost to the page.
    const buttons = [...$('wordGrid').querySelectorAll('[data-remove-id]')];
    focusSoon(buttons[Math.min(at, buttons.length - 1)] ?? $('mineWordsHead'));
  });
  $('mineShare').addEventListener('click', async () => {
    const a = active();
    if (!a) return;
    const url = await buildShareUrl(location.href, a.entries.map(e => e.word));
    $('mineShareUrl').hidden = false;
    $('mineShareUrl').value = url;
    $('mineShareUrl').focus();
    $('mineShareUrl').select();
    try { await navigator.clipboard.writeText(url); status('Link copied. Anyone with it can open this list.'); }
    catch { status('Copy the link in the Share link box.'); $('mineShareUrl').focus(); }
  });
  $('mineExport').addEventListener('click', () => {
    const a = el('a', { href: URL.createObjectURL(new Blob([exportJson(state.store)], { type: 'application/json' })),
      download: 'my-words.json' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status('Backup file saved as my-words.json. Look in your downloads, and keep it somewhere safe.');
  });
  $('mineImportFile').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { status('That file is too big to be a Bee Ready backup.'); return; }
    const parsed = parseExport(await file.text());
    if (parsed.error) { status(parsed.error); return; }
    let { store } = state, added = 0;
    for (const l of parsed.lists) {
      const made = addList(store, l.name, l.entries.map(x => entryFromBackup(x, defaultByWord)));
      if (made.list) { store = made.store; added++; }
    }
    state.store = store; persist(); activate();
    const left = parsed.lists.length - added;
    status(`Backup restored: ${added} ${added === 1 ? 'list' : 'lists'} added.`
      + `${left ? ` ${left} did not fit, because you can keep ${LIMITS.lists} lists. Delete one, then restore again.` : ''}`); // preflight: ok
  });
  $('mineLive').checked = LIVE_LOOKUP_ENABLED && state.settings.liveLookup;
  $('mineLive').disabled = !LIVE_LOOKUP_ENABLED;
  $('mineLive').addEventListener('change', () => {
    state.settings = { liveLookup: $('mineLive').checked };
    saveSettings(store0, state.settings); renderReview();
  });
  $('mineDeleteAll').addEventListener('click', () => {
    if (!confirm('Delete all your words, history and stars for My words from this device? This cannot be undone.')) return; // preflight: ok
    state.store = deleteAll(store0); chips = []; cache = {}; openUids.clear();
    $('mineShareUrl').value = ''; $('mineShareUrl').hidden = true;
    renderReview(); activate(); status('All of your words were deleted from this device.');
  });

  // ---- a share link ----------------------------------------------------------------------------------------------
  activate();
  const share = parseShareLocation(location.search, shareHash);
  if (share?.packed) {
    const unpacked = await unpackWords(share.packed);
    if (unpacked.error || (share.id && !idMatches(share.id, unpacked.words))) {
      status('This link looks damaged. Ask the person who sent it for a new link.');
    } else {
      const same = findListByWords(state.store, unpacked.words);
      if (same) {
        state.store = { ...state.store, active: same.key }; persist(); activate(); // preflight: ok
        status(SAME_LIST_TEXT);
      } else await showLink(unpacked.words, SHARED_NAME);
    }
  } else if (share?.id) {
    const same = state.store.lists.find(l => listId(l.entries.map(e => e.word)) === share.id);
    if (same) {
      state.store = { ...state.store, active: same.key }; persist(); activate(); status(SAME_LIST_TEXT);
    } else {
      // A list the owner published: lists/<id>.json on this site. Same files, no third party. It is checked like
      // any other input and must hash back to the id in the link.
      status('Looking for this list.');
      const published = await loadRegistryList(fetch, share.id);
      if (published) {
        status('');
        await showLink(published.words, published.name);
      } else status('This link does not include the words. Ask the person who sent it for a new link.');
    }
  }
}
