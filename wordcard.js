// Word-bank card markup. Pure functions: no DOM access, so they run in tests with no browser.
// The caller passes the word object, the part-of-speech map and the sentence lookup. All text is escaped here.
export const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ORIGIN_NOTE = "The booklet's category is a study clue, not the full history of the word.";
export const BOOKLET_NOTE = "These are the original booklet's fixed groups. To save your own words, tap the star.";
const idKey = id => String(id).replace(/[^A-Za-z0-9_-]/g,'_');
// Unique per word, so aria-controls always points at exactly one panel on the page.
export const detailsPanelId = id => `word-details-${idKey(id)}`;
export const starLabelDefault = (w,on) => `${on?'Remove star':'Star this word'}: ${w.word}`;
// Visible text and accessible name of the Details toggle. The name keeps the visible words and adds the word.
export const toggleText = open => open?'Hide details':'Details';
export const toggleLabel = (w,open) => `${open?'Hide details':'Details'} for ${w.word}`;
// Plain values (not yet escaped) for the four labelled facts. An unknown part never reads a map's inherited keys.
export function detailsData(w,POS,sentenceFor){
  const part = POS && Object.hasOwn(POS,w.part) ? POS[w.part] : '';
  let sentence = '';
  try{ sentence = String(sentenceFor(w)??'').trim(); }catch{}
  return {
    part: part || 'Not listed',
    origin: String(w.group??'').trim() || 'Not listed',
    booklet: w.level==='Study'||w.level==='Challenge' ? w.level : (String(w.level??'').trim() || 'Not listed'),
    sentence: sentence || 'No sentence yet.',
  };
}
export function wordCardHtml(w,POS,sentenceFor,{starred=false,open=false,starLabel=starLabelDefault}={}){
  const d = detailsData(w,POS,sentenceFor), id = escapeHtml(w.id), panel = detailsPanelId(w.id), word = escapeHtml(w.word);
  const metaPart = POS && Object.hasOwn(POS,w.part) ? POS[w.part] : 'word';
  const row = (label,value,note='') => `<div class="details-row"><dt>${label}</dt><dd>${escapeHtml(value)}${note?`<small class="details-note">${escapeHtml(note)}</small>`:''}</dd></div>`;
  return `<article class="word-card"><div class="word-meta">${escapeHtml(w.group)} · ${escapeHtml(w.level)} · ${escapeHtml(metaPart)}</div><h3>${word}</h3><p>${escapeHtml(w.definition)}</p>`
    + `<div class="word-card-actions"><span class="card-btns"><button class="mini-btn" data-say-id="${id}" aria-label="Hear ${word}">🔊 Listen</button><button class="star-btn" data-star-id="${id}" aria-pressed="${starred}" aria-label="${escapeHtml(starLabel(w,starred))}">${starred?'★':'☆'}</button></span><a href="https://www.merriam-webster.com/dictionary/${encodeURIComponent(w.word)}" target="_blank" rel="noopener noreferrer">Dictionary ↗</a></div>`
    + `<button type="button" class="details-btn" data-details-id="${id}" aria-expanded="${open}" aria-controls="${panel}" aria-label="${escapeHtml(toggleLabel(w,open))}">${toggleText(open)}</button>`
    + `<div class="word-details" id="${panel}"${open?'':' hidden'}><dl class="details-list">`
    + row('Part of speech',d.part) + row('Origin',d.origin,ORIGIN_NOTE) + row('Booklet list',d.booklet,BOOKLET_NOTE) + row('In a sentence',d.sentence)
    + `</dl><div class="details-audio" role="group" aria-label="Listen to ${word}">`
    + `<button type="button" class="mini-btn" data-hear="word" data-hear-id="${id}" aria-label="Hear the word: ${word}">🔊 Hear the word</button>`
    + `<button type="button" class="mini-btn" data-hear="slow" data-hear-id="${id}" aria-label="Hear it slowly: ${word}">🐢 Hear it slowly</button>`
    + `<button type="button" class="mini-btn" data-hear="sentence" data-hear-id="${id}" aria-label="Hear the sentence for ${word}">💬 Hear the sentence</button>`
    + `</div></div></article>`;
}
