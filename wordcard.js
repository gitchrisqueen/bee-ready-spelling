// Word-bank card markup. Pure functions: no DOM access, so they run in tests with no browser.
// The caller passes the word object, the part-of-speech map and the sentence lookup. All text is escaped here.
export const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Hosts a looked-up definition can be credited to (CC BY-SA 4.0). Anything else in `credit` is ignored.
const CREDIT_HOSTS = ['simple.wiktionary.org', 'en.wiktionary.org'];
const creditHtml = w => {
  const hosts = Array.isArray(w.credit) ? w.credit.filter(h => CREDIT_HOSTS.includes(h)) : [];
  if (!hosts.length) return '';
  const url = h => `https://${h}/wiki/${encodeURIComponent(w.word)}`;
  const link = h => `<a href="${url(h)}" target="_blank" rel="noopener noreferrer">${h}`
    + '<span class="sr-only"> (opens in a new tab)</span></a>';
  const links = hosts.map(link);
  return `<p class="source-credit">Source: ${links.join(', ')} (CC BY-SA 4.0)</p>`;
};
// A child's own word has no booklet group. Where the origin or part of speech is not known, the card says nothing
// instead of printing a placeholder such as "Mine" or "word" next to the title.
export const UNKNOWN_ORIGIN = 'Origin not available';
export const NOT_KNOWN_YET = 'Not known yet';
const metaLine = (w,part) => {
  if(!w.custom) return `${escapeHtml(w.group)} · ${escapeHtml(w.level)} · ${escapeHtml(part||'word')}`;
  const known = [w.group===UNKNOWN_ORIGIN ? '' : String(w.group??'').trim(), part].filter(Boolean);
  return escapeHtml(known.length ? known.join(' · ') : 'My word');
};
export const ORIGIN_NOTE = "This is only a hint. It is not the whole story of where the word came from.";
// What a My words entry holds when nobody has written a definition. The round's Definition clue shows a different
// line for it, because a speller has no Dictionary link there.
export const NO_DEFINITION = 'No definition yet. Use the Dictionary link to look it up.';
export const BOOKLET_NOTE = "These are the original booklet's fixed groups. To save your own words, press the Star button (☆) on a word.";
const idKey = id => String(id).replace(/[^A-Za-z0-9_-]/g,'_');
// Unique per word, so aria-controls always points at exactly one panel on the page.
export const detailsPanelId = id => `word-details-${idKey(id)}`;
export const wordTitleId = id => `word-title-${idKey(id)}`;
// One fixed accessible name per button. aria-pressed / aria-expanded carry the state, so a name never flips.
export const starLabelDefault = w => `Star: ${w.word}`;
// The visible text is "Details" and the name starts with it (WCAG 2.5.3). The chevron is decorative and rotates in CSS.
export const toggleLabel = w => `Details for ${w.word}`;
// Plain values (not yet escaped) for the four labelled facts. An unknown part never reads a map's inherited keys.
export function detailsData(w,POS,sentenceFor){
  const part = POS && Object.hasOwn(POS,w.part) ? POS[w.part] : '';
  let sentence = '';
  try{ sentence = String(sentenceFor(w)??'').trim(); }catch{}
  return {
    part: part || (w.custom ? NOT_KNOWN_YET : 'Not listed'),
    origin: w.custom && w.group===UNKNOWN_ORIGIN ? NOT_KNOWN_YET : (String(w.group??'').trim() || 'Not listed'),
    booklet: w.level==='Study'||w.level==='Challenge' ? w.level : (String(w.level??'').trim() || 'Not listed'),
    sentence: sentence || 'No sentence yet.',
  };
}
// removable adds a Remove button beside Details (My words cards). Its name keeps the word "Remove".
export function wordCardHtml(w,POS,sentenceFor,{starred=false,open=false,removable=false,starLabel=starLabelDefault}={}){ // preflight: ok
  const d = detailsData(w,POS,sentenceFor), id = escapeHtml(w.id), panel = detailsPanelId(w.id), title = wordTitleId(w.id), word = escapeHtml(w.word);
  const metaPart = POS && Object.hasOwn(POS,w.part) ? POS[w.part] : '';
  const detailsBtn = `<button type="button" class="details-btn" data-details-id="${id}" aria-expanded="${open}" aria-controls="${panel}" aria-label="${escapeHtml(toggleLabel(w))}">Details <span class="chev" aria-hidden="true">▸</span></button>`; // preflight: ok
  const row = (label,value,note='') => `<div class="details-row"><dt>${label}</dt><dd>${escapeHtml(value)}${note?`<small class="details-note">${escapeHtml(note)}</small>`:''}</dd></div>`;
  return `<article class="word-card" aria-labelledby="${title}"><div class="word-meta">${metaLine(w,metaPart)}</div><h3 id="${title}">${word}</h3><p>${escapeHtml(w.definition)}</p>` // preflight: ok
    + `<div class="word-card-actions"><span class="card-btns"><button class="mini-btn" data-say-id="${id}" aria-label="Listen to ${word}"><span aria-hidden="true">🔊</span> Listen</button><button class="star-btn" data-star-id="${id}" aria-pressed="${starred}" aria-label="${escapeHtml(starLabel(w,starred))}"><span class="star-glyph" aria-hidden="true">${starred?'★':'☆'}</span></button></span><a href="https://www.merriam-webster.com/dictionary/${encodeURIComponent(w.word)}" target="_blank" rel="noopener noreferrer" aria-label="Dictionary entry for ${word} (opens in a new tab)">Dictionary <span aria-hidden="true">↗</span></a></div>`
    + (removable ? `<div class="card-foot">${detailsBtn}<button type="button" class="text-btn remove-btn" data-remove-id="${id}" aria-label="Remove ${word} from my list">Remove</button></div>` : detailsBtn) // preflight: ok
    + `<div class="word-details" id="${panel}"${open?'':' hidden'}><dl class="details-list">`
    + row('Part of speech',d.part) + row('Origin',d.origin,d.origin===NOT_KNOWN_YET?'':ORIGIN_NOTE)
    + (w.custom ? '' : row('Booklet list',d.booklet,BOOKLET_NOTE)) + row('In a sentence',d.sentence)
    + `</dl>${creditHtml(w)}<div class="details-audio" role="group" aria-label="Listen to ${word}">`
    + `<button type="button" class="mini-btn" data-hear="word" data-hear-id="${id}" aria-label="Hear the word: ${word}"><span aria-hidden="true">🔊</span> Hear the word</button>`
    + `<button type="button" class="mini-btn" data-hear="slow" data-hear-id="${id}" aria-label="Hear it slowly: ${word}"><span aria-hidden="true">🐢</span> Hear it slowly</button>`
    + `<button type="button" class="mini-btn" data-hear="sentence" data-hear-id="${id}" aria-label="Hear the sentence for ${word}"><span aria-hidden="true">💬</span> Hear the sentence</button>`
    + `</div></div></article>`;
}
