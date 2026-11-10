// The "My words" screen. app.js loads this module only for ?mode=mine, and hands it the default word list and a
// function that swaps the practice screen's word source. Text is set with textContent and DOM calls only; no markup
// is built from imported or looked-up text here. Nothing is sent to Wikimedia until a grown-up taps "Look up the
// missing words" and confirms (docs/my-words-plan.md, "Third-party requests").
import { sentenceFor } from '../sentences.js';
import { clipKey, sentenceKey } from '../voice-service.js';
import { allowedClipKeys, installClipGuard } from './clipguard.js';
import { LIVE_LOOKUP_ENABLED, OCR_ENABLED } from './config.js';
import { filterReady, loadBlocklist } from './filter.js';
import { chipsToEntries, entryFromBackup, resolveWords, toPracticeWord } from './import.js';
import {
  LOOKUP_KEY, MAX_IMPORT_BYTES, addEntries, addList, deleteAll, deleteList, dropOldestBackup, exportJson,
  findListByWords, loadSettings, loadStore, parseExport, saveSettings, saveStore, updateList, writeBackup,
} from './lists.js';
import { HOSTS, cleanLookupCache, entryUrl, lookupMissing } from './lookup.js';
import { MAX_PHOTO_BYTES, OCR_DIR, loadTesseract, ocrOptions, readPhoto } from './ocr.js';
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
  let lookupAbort = null;
  let nextChip = 1;
  let pendingEdits = 0;      // word edits still being looked up; Save waits for them
  let flip = false;
  const openUids = new Set();

  // Words typed here must not reach this site's host as clip file names (see mine/clipguard.js).
  installClipGuard(globalThis, allowedClipKeys(defaultWords, { sentenceFor, clipKey, sentenceKey }));

  // A status message in the polite live region. The trailing no-break space makes a repeated message read again.
  const status = text => { flip = !flip; $('mineStatus').textContent = text ? text + (flip ? '' : ' ') : ''; };
  const persist = () => {
    if (state.readOnly) return;
    if (!saveStore(store0, state.store)) status('This device could not save your words. Download a backup.');
  };
  const active = () => state.store.lists.find(l => l.key === state.store.active) ?? null;
  const focusSoon = target => { if (target) requestAnimationFrame(() => target.focus({ preventScroll: false })); };

  // ---- screen set-up ---------------------------------------------------------------------------------------------
  $('mineRoot').hidden = false;
  $('mineGrownups').hidden = false;
  $('mineEnterBlock').hidden = true;
  $('mineSettingsBlock').hidden = false;
  $('minePhotoBlock').hidden = !OCR_ENABLED;
  document.documentElement.classList.add('mine-mode');
  for (const v of ['study', 'challenge']) $('pool').querySelector(`option[value="${v}"]`)?.remove();
  $('levelFilter').closest('label')?.setAttribute('hidden', '');
  document.querySelectorAll('#roundBuilder .helper').forEach(p => { if (/booklet/i.test(p.textContent)) p.hidden = true; }); // preflight: ok
  const bankIntro = document.querySelector('#tab-words .section-intro p');
  if (bankIntro) bankIntro.textContent = 'Your own words, with their definitions, origins and sentences. Press Details on a card.'; // preflight: ok

  // The safety list must load first. Without it every word looks blocked, and saving would wipe the saved lists, so the
  // screen stays read-only: nothing is read, nothing is written.
  try { await loadBlocklist(fetchFn); } catch { /* handled below */ }
  if (!filterReady()) {
    state.readOnly = true;
    state.store = loadStore(store0).store;
    status('The safety list could not load, so My words is turned off for now. Your lists are safe. Please refresh the page.'); // preflight: ok
    document.querySelectorAll('#mineRoot button, #mineRoot input, #mineRoot textarea, #mineRoot select, #mineSettingsBlock button, #mineSettingsBlock input') // preflight: ok
      .forEach(c => { c.disabled = true; });
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
    const ul = $('mineWordList');
    ul.replaceChildren();
    for (const e of a?.entries ?? []) {
      const id = `mine-w-${e.id}`;
      ul.append(el('li', {},
        el('span', { id, class: 'mine-word', text: e.word }),
        el('span', { class: 'mine-word-def', text: ` ${e.definition ?? (e.src === 'default' ? 'In the Bee Ready list' : '')}` }), // preflight: ok
        el('button', { type: 'button', class: 'text-btn', 'data-remove': e.id, 'aria-label': `Remove ${e.word}`, text: 'Remove' }))); // preflight: ok
    }
    $('mineWordsHead').textContent = a ? `Words in ${a.name}` : 'Words in your list';
    $('mineEmpty').hidden = Boolean(a?.entries.length);
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
  }
  function renderReview() {
    const spot = focusSpot();
    $('mineReview').hidden = !chips.length;
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
    focusSoon(next ? document.querySelector(`#mineChips li[data-uid="${next.uid}"] .mine-chip-row input`) : $('mineText')); // preflight: ok
  }

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

  async function onSave() {
    while (pendingEdits > 0) await new Promise(r => setTimeout(r, 20));
    const entries = chipsToEntries(chips.filter(c => !c.invalid));
    let { store } = state;
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
  // The picture buttons stay enabled while a read runs (so keyboard focus is never dropped); a second picture is ignored.
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
  $('mineSave').addEventListener('click', onSave);
  $('mineCancel').addEventListener('click', () => {
    chips = []; sharedNote = ''; openUids.clear(); renderReview(); status('Nothing was saved.'); focusSoon($('mineText')); // preflight: ok
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
  $('mineWordList').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    const a = active();
    if (!rm || !a) return;
    const gone = a.entries.find(x => x.id === Number(rm.dataset.remove));
    const at = a.entries.indexOf(gone);
    state.store = updateList(state.store, a.key, l => ({ entries: l.entries.filter(x => x.id !== Number(rm.dataset.remove)) })); // preflight: ok
    persist(); activate();
    status(`Removed ${gone?.word ?? 'the word'}.`);
    const buttons = [...$('mineWordList').querySelectorAll('[data-remove]')];
    focusSoon(buttons[at] ?? buttons[at - 1] ?? $('mineWordsHead'));
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
  });
  $('mineImportFile').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { status('That file is too big to be a Bee Ready backup.'); return; }
    const parsed = parseExport(await file.text());
    if (parsed.error) { status(parsed.error); return; }
    let { store } = state;
    for (const l of parsed.lists) {
      const made = addList(store, l.name, l.entries.map(x => entryFromBackup(x, defaultByWord)));
      if (made.list) store = made.store;
    }
    state.store = store; persist(); activate(); status('Backup opened.');
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
      if (same) { state.store = { ...state.store, active: same.key }; persist(); activate(); status('You already have this list.'); } // preflight: ok
      else await showReview(unpacked.words, 'This list came from a link. Nothing is saved until you press Save.');
    }
  } else if (share?.id) {
    const same = state.store.lists.find(l => listId(l.entries.map(e => e.word)) === share.id);
    if (same) { state.store = { ...state.store, active: same.key }; persist(); activate(); }
    else status('This link does not include the words. Ask the person who sent it for a new link.');
  }
}
