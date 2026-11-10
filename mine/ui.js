// The "My words" screen. app.js loads this module only for ?mode=mine, and hands it the default word list and a
// function that swaps the practice screen's word source. Text is set with textContent and DOM calls only; no markup
// is built from imported or looked-up text here. Nothing is sent anywhere until the grown-up taps "Look up the
// missing words" (docs/my-words-plan.md, "Third-party requests").
import { LIVE_LOOKUP_ENABLED } from './config.js';
import { loadBlocklist } from './filter.js';
import { chipsToEntries, entryFromBackup, resolveWords, toPracticeWord } from './import.js';
import {
  LOOKUP_KEY, addEntries, addList, deleteAll, deleteList, dropOldestBackup, exportJson, findListByWords,
  loadSettings, loadStore, parseExport, saveSettings, saveStore, updateList, writeBackup,
} from './lists.js';
import { entryUrl, lookupMissing } from './lookup.js';
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
const STATUS_TEXT = {
  default: 'In the Bee Ready list. It keeps its recorded voice.',
  library: 'Found in the Bee Ready library.',
  live: 'Looked up on Wiktionary.',
  missing: 'Not found yet. You can type a definition, or look it up.',
};
const STOP_TEXT = {
  timeout: 'Wiktionary did not answer in time.', network: 'The page could not reach Wiktionary.',
  'rate-limit': 'Wiktionary asked us to slow down.', blocked: 'Wiktionary did not allow the request.',
  server: 'Wiktionary had a problem.', shape: 'Wiktionary sent something unexpected.', cancelled: 'Lookup stopped.',
};

export async function start({ defaultWords, setWords, shareHash = '' }) {
  const store0 = storage();
  const defaultByWord = new Map(defaultWords.map(w => [w.word.toLowerCase(), w]));
  const defaultById = new Map(defaultWords.map(w => [w.id, w]));
  const fetchFn = (...args) => fetch(...args);
  let state = { store: null, settings: loadSettings(store0 ?? { getItem: () => null }) };
  let chips = [];            // the review list, not yet saved
  let sharedNote = '';       // set when the review came from a share link
  let lookupAbort = null;
  let nextChip = 1;

  const status = text => { $('mineStatus').textContent = text; };
  const persist = () => { if (!saveStore(store0, state.store)) status('This device could not save your words. Download a backup.'); };
  const active = () => state.store.lists.find(l => l.key === state.store.active) ?? null;

  // ---- screen set-up ---------------------------------------------------------------------------------------------
  $('mineRoot').hidden = false;
  $('mineGrownups').hidden = false;
  $('mineEnterBlock').hidden = true;
  $('mineSettingsBlock').hidden = false;
  document.documentElement.classList.add('mine-mode');
  for (const v of ['study', 'challenge']) $('pool').querySelector(`option[value="${v}"]`)?.remove();
  $('levelFilter').closest('label')?.setAttribute('hidden', '');
  document.querySelectorAll('#roundBuilder .helper').forEach(p => { if (/booklet/i.test(p.textContent)) p.hidden = true; });
  const bankIntro = document.querySelector('#tab-words .section-intro p');
  if (bankIntro) bankIntro.textContent = 'Your own words, with their definitions, origins and sentences. Press Details on a card.';

  try { await loadBlocklist(fetchFn); } catch {
    status('The safety list could not load, so adding words is turned off. Please refresh the page.');
    $('mineCheck').disabled = true;
  }

  const loaded = loadStore(store0 ?? { getItem: () => null, length: 0, key: () => null });
  state.store = loaded.store;
  if (loaded.status === 'corrupt') {
    status('Your saved words could not be read, so we started a fresh list. The old data was kept as a backup if there was room.');
    if (loaded.backup === 'full'
      && confirm('Your saved words could not be read and the backups are full. Drop the oldest backup to keep this one?')) {
      dropOldestBackup(store0);
      writeBackup(store0, loaded.raw);
    }
  }
  let cache = {};
  try { const raw = JSON.parse(store0.getItem(LOOKUP_KEY)); if (raw && typeof raw === 'object' && !Array.isArray(raw)) cache = raw; } catch { /* none */ }
  const saveCache = () => {
    const keys = Object.keys(cache);
    for (const k of keys.slice(0, Math.max(0, keys.length - LIMITS.lookupEntries))) delete cache[k];
    try { store0.setItem(LOOKUP_KEY, JSON.stringify(cache)); } catch { /* full */ }
  };

  // ---- the saved lists -------------------------------------------------------------------------------------------
  function renderLists() {
    const sel = $('mineList');
    sel.replaceChildren();
    for (const l of state.store.lists) sel.append(el('option', { value: l.key, text: `${l.name} (${l.entries.length})` }));
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
        el('span', { class: 'mine-word-def', text: ` ${e.definition ?? (e.src === 'default' ? 'In the Bee Ready list' : '')}` }),
        el('button', { type: 'button', class: 'text-btn', 'data-remove': e.id, 'aria-describedby': id, text: 'Remove' })));
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
  function chipNode(chip) {
    const inputId = `mine-chip-${chip.uid}`;
    const li = el('li', { class: 'mine-chip', 'data-uid': chip.uid });
    const input = el('input', { id: inputId, type: 'text', value: chip.word, maxlength: LIMITS.wordChars,
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Word' });
    input.addEventListener('change', () => editChip(chip, input.value));
    li.append(el('div', { class: 'mine-chip-row' }, input,
      el('button', { type: 'button', class: 'text-btn', 'data-chip-remove': chip.uid, 'aria-describedby': inputId, text: 'Remove' })));
    li.append(el('p', { class: 'mine-chip-status', text: chip.invalid ?? STATUS_TEXT[chip.status] }));
    if (chip.suggestion) {
      li.append(el('button', { type: 'button', class: 'soft-btn', 'data-chip-use': chip.uid, 'aria-describedby': inputId,
        text: `Did you mean ${chip.suggestion}? Use it` }));
    }
    if (chip.status === 'live' && chip.entry?.credit?.length) {
      const p = el('p', { class: 'mine-chip-credit', text: 'Source: ' });
      chip.entry.credit.forEach((host, i) => {
        if (i) p.append(', ');
        p.append(el('a', { href: entryUrl(host, chip.word), target: '_blank', rel: 'noopener noreferrer', text: host }));
      });
      p.append(' (CC BY-SA 4.0)');
      li.append(p);
    }
    if (chip.status !== 'default' && !chip.invalid) {
      const details = el('details', { class: 'mine-chip-edit' }, el('summary', { text: 'Edit definition and sentence' }));
      const defId = `mine-def-${chip.uid}`, senId = `mine-sen-${chip.uid}`;
      const def = el('textarea', { id: defId, rows: 2, maxlength: LIMITS.definition, autocomplete: 'off' });
      def.value = chip.entry?.definition ?? '';
      def.addEventListener('input', () => { chip.entry = { ...(chip.entry ?? {}), definition: def.value }; });
      const sen = el('input', { id: senId, type: 'text', maxlength: LIMITS.sentence, autocomplete: 'off' });
      sen.value = chip.entry?.sentence ?? '';
      sen.addEventListener('input', () => { chip.entry = { ...(chip.entry ?? {}), sentence: sen.value }; });
      details.append(el('label', { for: defId, text: 'Definition' }), def,
        el('label', { for: senId, text: 'A sentence that uses the word once' }), sen);
      li.append(details);
    }
    return li;
  }
  function renderReview() {
    $('mineReview').hidden = !chips.length;
    const ul = $('mineChips');
    ul.replaceChildren(...chips.map(chipNode));
    const missing = chips.filter(c => c.status === 'missing' && !c.invalid).length;
    $('mineReviewSummary').textContent = `${chips.length} ${chips.length === 1 ? 'word' : 'words'}. ${missing
      ? `${missing} ${missing === 1 ? 'is' : 'are'} not found yet.` : 'Every word has what it needs.'}${sharedNote ? ` ${sharedNote}` : ''}`;
    $('mineLookup').hidden = !(LIVE_LOOKUP_ENABLED && state.settings.liveLookup) || !missing;
    $('mineDisclosure').hidden = $('mineLookup').hidden;
    $('mineSave').disabled = !chips.some(c => !c.invalid);
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
  async function editChip(chip, value) {
    const { words } = parseWords(value);
    const at = chips.indexOf(chip);
    if (words.length !== 1) {
      chips[at] = { ...chip, word: normalizeWord(value), invalid: 'Use one word, with letters, hyphens or apostrophes.' };
    } else {
      const [fresh] = await resolveInto(words);
      chips[at] = fresh;
    }
    renderReview();
    document.querySelector(`[data-uid="${chips[at].uid}"] input`)?.focus();
  }

  async function onCheck() {
    const { words, rejected, blocked, truncated } = parseWords($('mineText').value);
    const notes = [];
    if (rejected.length) notes.push(`${rejected.length} left out (letters, hyphens and apostrophes only).`);
    if (blocked.length) notes.push(`${blocked.length} can't be added.`);
    if (truncated) notes.push(`Only the first ${LIMITS.words} words were kept.`);
    if (!words.length) { status(`No words found. ${notes.join(' ')}`.trim()); return; }
    status(notes.join(' '));
    await showReview(words);
  }

  async function onLookup() {
    const missing = chips.filter(c => c.status === 'missing' && !c.invalid).map(c => c.word);
    if (!missing.length) return;
    lookupAbort = new AbortController();
    $('mineCancelLookup').hidden = false;
    $('mineLookup').disabled = true;
    const { results, stopped } = await lookupMissing(missing, {
      fetchFn, cache, signal: lookupAbort.signal,
      onProgress: (done, total) => { status(`Looking up words: ${done} of ${total}.`); },
    });
    lookupAbort = null;
    $('mineCancelLookup').hidden = true;
    $('mineLookup').disabled = false;
    saveCache();
    chips = chips.map(c => (c.status === 'missing' && results[c.word] ? { ...c, status: 'live', entry: results[c.word] } : c));
    const found = Object.values(results).filter(Boolean).length;
    status(`${found} of ${missing.length} looked up.${stopped ? ` ${STOP_TEXT[stopped] ?? ''} You can type the rest yourself.` : ''}`);
    renderReview();
  }

  function onSave() {
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
    chips = []; sharedNote = '';
    $('mineText').value = '';
    renderReview();
    activate();
    status(`${added} ${added === 1 ? 'word' : 'words'} saved. Words already in the list were not added twice.`);
  }

  // ---- list actions ----------------------------------------------------------------------------------------------
  $('mineCheck').addEventListener('click', onCheck);
  $('mineLookup').addEventListener('click', onLookup);
  $('mineCancelLookup').addEventListener('click', () => lookupAbort?.abort());
  $('mineSave').addEventListener('click', onSave);
  $('mineCancel').addEventListener('click', () => { chips = []; sharedNote = ''; renderReview(); status('Nothing was saved.'); });
  $('mineChips').addEventListener('click', async e => {
    const rm = e.target.closest('[data-chip-remove]');
    if (rm) { chips = chips.filter(c => c.uid !== Number(rm.dataset.chipRemove)); renderReview(); return; }
    const use = e.target.closest('[data-chip-use]');
    if (use) { const c = chips.find(x => x.uid === Number(use.dataset.chipUse)); if (c) await editChip(c, c.suggestion); }
  });
  $('mineList').addEventListener('change', () => {
    state.store = { ...state.store, active: $('mineList').value || null };
    persist(); activate();
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
  });
  $('mineWordList').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    const a = active();
    if (!rm || !a) return;
    state.store = updateList(state.store, a.key, l => ({ entries: l.entries.filter(x => x.id !== Number(rm.dataset.remove)) }));
    persist(); activate();
  });
  $('mineShare').addEventListener('click', async () => {
    const a = active();
    if (!a) return;
    const url = await buildShareUrl(location.href, a.entries.map(e => e.word));
    $('mineShareUrl').hidden = false;
    $('mineShareUrl').value = url;
    $('mineShareUrl').select();
    try { await navigator.clipboard.writeText(url); status('Link copied. Anyone with it can open this list.'); }
    catch { status('Copy the link above.'); }
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
    if (!confirm('Delete all your words, history and stars for My words from this device? This cannot be undone.')) return;
    state.store = deleteAll(store0); chips = []; cache = {};
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
      if (same) { state.store = { ...state.store, active: same.key }; persist(); activate(); status('You already have this list.'); }
      else await showReview(unpacked.words, 'This list came from a link. Nothing is saved until you press Save.');
    }
  } else if (share?.id) {
    const same = state.store.lists.find(l => listId(l.entries.map(e => e.word)) === share.id);
    if (same) { state.store = { ...state.store, active: same.key }; persist(); activate(); }
    else status('This link does not include the words. Ask the person who sent it for a new link.');
  }
}
