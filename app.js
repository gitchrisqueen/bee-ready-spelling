import { BeeVoiceService, VOICES, SPEEDS } from './voice-service.js';
import { sentenceFor } from './sentences.js';
import { loadStars, saveStars, toggleStar, clearStars } from './stars.js';
import { wordCardHtml } from './wordcard.js';
const $ = id => document.getElementById(id);
const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeText = value => String(value??'');
// Smooth scrolling only when the visitor has not asked for reduced motion.
const scrollBehavior=()=>window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const historyKey='bee-ready-history-v2';
const POS = {n:'noun',v:'verb',adj:'adjective',adv:'adverb',interj:'interjection'};
// Returns safe HTML: everything is escaped, and each blank is a span a screen reader announces as "blank".
// The blank is one solid line of the same width for every word (drawn with CSS, not with underscore
// characters), so its length never hints at how many letters the word has.
const BLANK_HTML='<span class="blank" role="img" aria-label="blank"></span>';
// reveal=true (after the child has answered) shows the word in bold instead of the blank.
function hideWord(sentence,word,reveal=false){
  const norm=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp(norm,'gi');
  const parts=String(sentence).split(re).map(escapeHtml);
  if(!reveal)return parts.join(BLANK_HTML);
  const hits=String(sentence).match(re)||[];
  return parts.map((p,i)=>i<hits.length?`${p}<strong>${escapeHtml(hits[i])}</strong>`:p).join('');
}
function comparison(s){return String(s).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en-US').replace(/[^\p{L}]/gu,'');}
function getHistory(){try{return JSON.parse(localStorage.getItem(historyKey))||{attempts:{},missed:{},rounds:0};}catch{return {attempts:{},missed:{},rounds:0};}}
function writeHistory(){try{localStorage.setItem(historyKey,JSON.stringify(history));}catch{} updateStats();}
// Stars live in their own key (see stars.js). Reading `localStorage` can itself throw when storage is blocked, so go through store().
function store(){try{return localStorage;}catch{return null;}}
let history=getHistory();let stars=loadStars(store());let openCards=new Set();let words=[];let currentRound=null;let displayLimit=44;let selectedCount=5;
let noticeTimer=0;let voiceService=new BeeVoiceService({onStatus:updateVoiceStatus});
const appState={activeTab:'practice'};
// Only ids that still exist in the word list count, so an old saved id can never inflate the number.
const starredWords=()=>words.length?words.filter(w=>stars.has(w.id)):[...stars];
function updateStats(){
  $('heroBest').textContent=Object.keys(history.attempts||{}).length.toLocaleString();
  $('heroMissed').textContent=Object.keys(history.missed||{}).length.toLocaleString();
  const n=starredWords().length;$('heroStarred').textContent=n.toLocaleString();
  const opt=$('pool').querySelector('option[value="starred"]');if(opt)opt.textContent=`My starred words (${n.toLocaleString()})`;
  $('heroWordCount').textContent=words.length?words.length.toLocaleString():'—';
}
// Star buttons keep one fixed accessible name (set in the markup); aria-pressed carries the state and only the decorative glyph changes.
// The round button's name never includes the word: in typed mode it would give the answer away.
function setStarGlyph(btn,on){btn.setAttribute('aria-pressed',String(on));const g=btn.querySelector('.star-glyph');if(g)g.textContent=on?'★':'☆';}
function paintRoundStar(){
  const w=currentWord(),btn=$('starWord');if(!btn)return;
  setStarGlyph(btn,Boolean(w&&stars.has(w.id)));
}
let clearStatusTimer=0;
function setClearStatus(text){clearTimeout(clearStatusTimer);$('clearStarsStatus').textContent=text;if(text)clearStatusTimer=setTimeout(()=>{$('clearStarsStatus').textContent='';},5000);}
function flipStar(id){const on=toggleStar(stars,id);saveStars(store(),stars);updateStats();paintRoundStar();if(on)setClearStatus('');return on;}
function showTab(tab,{focus=false}={}){
  if(!['practice','words','voices','grownups'].includes(tab))tab='practice';
  appState.activeTab=tab;
  document.querySelectorAll('[data-tab]').forEach(button=>{
    const active=button.dataset.tab===tab;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab-panel').forEach(el=>el.classList.toggle('active',el.id===`tab-${tab}`));
  location.hash=tab;
  if(tab==='words')renderWordBank();
  window.scrollTo({top:0,behavior:'instant'});
  // After a click, move focus to the new page's heading so keyboard and screen-reader users land on it
  // (the button that was pressed may have just been hidden). Not on page load or a hash change.
  if(focus){const h=$(`${tab}-title`);if(h)h.focus({preventScroll:true});}
}
function initNavigation(){
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab,{focus:true})));
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.go,{focus:true})));
  window.addEventListener('hashchange',()=>{
    const tab=location.hash.slice(1);
    if(tab && tab!==appState.activeTab)showTab(tab);
  });
  if(location.hash)showTab(location.hash.slice(1));
}
function initBuilder(){
  document.querySelectorAll('[data-count]').forEach(btn=>btn.addEventListener('click',()=>{
    selectedCount=Number(btn.dataset.count);$('wordCount').value=selectedCount;
    document.querySelectorAll('[data-count]').forEach(b=>{const on=b===btn;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
  }));
  $('wordCount').addEventListener('input',()=>{
    selectedCount=Number($('wordCount').value)||1;
    document.querySelectorAll('[data-count]').forEach(btn=>{const on=Number(btn.dataset.count)===selectedCount;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});
  });
  $('startRound').addEventListener('click',startRound);
}
function sampleNoRepeat(items,count){
  // Fisher-Yates shuffle with a local copy so the original word bank remains sorted.
  const pool=items.slice();
  for(let i=pool.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  return pool.slice(0,count);
}
function startRound(){
  if(!words.length)return;
  let pool=words;
  const type=$('pool').value;
  if(type==='study')pool=words.filter(w=>w.level==='Study');
  else if(type==='challenge')pool=words.filter(w=>w.level==='Challenge');
  else if(type==='missed')pool=words.filter(w=>Boolean(history.missed[w.id]));
  else if(type==='starred')pool=starredWords();
  if(!pool.length){
    $('roundArea').classList.remove('hidden');$('activeCard').classList.add('hidden');$('roundSummary').classList.remove('hidden');
    $('roundSummary').innerHTML=type==='starred'?'<h2 id="emptyPoolHeading" tabindex="-1">You have no starred words yet.</h2><p>Go to the Word bank and press the Star button on a word.</p>':(history.rounds>0?'<h2 id="emptyPoolHeading" tabindex="-1">You did not miss any words! Great job. 🎉</h2><p>Pick another set of words to keep practicing.</p>':'<h2 id="emptyPoolHeading" tabindex="-1">No review words yet! 🎉</h2><p>Finish a practice round first, then your missed words will appear here.</p>');
    $('roundArea').scrollIntoView({behavior:scrollBehavior(),block:'start'});$('emptyPoolHeading').focus();return;
  }
  const count=Math.min(pool.length,Math.max(1,Number($('wordCount').value)||5));
  currentRound={items:sampleNoRepeat(pool,count),index:0,correct:0,results:[],mode:$('practiceMode').value,clues:new Set()};
  const fromSummary=$('roundSummary').contains(document.activeElement);
  $('roundArea').classList.remove('hidden');$('roundSummary').classList.add('hidden');$('activeCard').classList.remove('hidden');
  showCurrent();$('questionHeading').focus({preventScroll:true});$('roundArea').scrollIntoView({behavior:scrollBehavior(),block:'start'});
}
function currentWord(){return currentRound?.items[currentRound?.index]??null;}
function showCurrent(){
  voiceService.stop();
  const w=currentWord();if(!w){finishRound();return;}
  $('roundNumber').textContent=`WORD ${currentRound.index+1} OF ${currentRound.items.length}`;
  $('scoreLabel').textContent=`${currentRound.correct} correct so far`;
  $('meterFill').style.width=`${100*currentRound.index/currentRound.items.length}%`;
  $('questionHeading').textContent='Your next word is ready!';
  $('questionHint').textContent=currentRound.mode==='oral'?'Ask your grown-up to listen as you spell.':'Hear the word, ask for clues, then type the letters.';
  $('clueResult').hidden=true;$('clueResult').textContent='';currentRound.answered=false;currentRound.lastClue=null;
  $('answerFeedback').className='feedback hidden';
  $('nextWord').classList.add('hidden');
  $('answerInput').value='';$('answerInput').disabled=false;$('answerForm').classList.toggle('hidden',currentRound.mode==='oral');
  $('oralButtons').classList.toggle('hidden',currentRound.mode!=='oral');
  $('revealOral').classList.remove('hidden');$('gradeOral').classList.add('hidden');
  $('hearWord').disabled=false;paintRoundStar();
  document.querySelectorAll('[data-clue]').forEach(b=>b.disabled=false);
  voiceService.prefetch(w.word);voiceService.prefetch(sentenceFor(w),'sentence');
}
function showClue(type,{speak=true}={}){
  const w=currentWord();if(!w)return;
  // One-off slow playback, like hearFromCard: the saved speed (Voices tab) is never changed.
  if(type==='repeat'){voiceService.speak(w.word,{kind:'word',instant:true,speedId:'slow'});return;}
  const clueText = type==='definition'?`<strong>Definition</strong>${escapeHtml(w.definition)}`:
    type==='origin'?`<strong>Original booklet group</strong>${escapeHtml(w.group)}<div class="helper">The booklet's category is a study clue, not the full history of the word.</div>`:
    type==='part'?`<strong>Part of speech</strong>${escapeHtml(POS[w.part]||'Word')}`:
    `<strong>In a sentence</strong>${hideWord(sentenceFor(w),w.word,Boolean(currentRound.answered))}`;
  $('clueResult').innerHTML=clueText;$('clueResult').hidden=false;currentRound.lastClue=type;
  if(type==='sentence'&&speak)voiceService.speak(sentenceFor(w),{kind:'sentence',instant:true});
}
function markAnswer(correct){
  const w=currentWord();if(!w)return;
  currentRound.results.push({word:w.word,correct,level:w.level});if(correct)currentRound.correct++;
  if(!history.attempts)history.attempts={};if(!history.missed)history.missed={};
  const old=history.attempts[w.id]||{correct:0,missed:0};
  history.attempts[w.id]={correct:old.correct+(correct?1:0),missed:old.missed+(correct?0:1),last:Date.now()};
  if(correct)delete history.missed[w.id];else history.missed[w.id]=true;
  writeHistory();
  const f=$('answerFeedback');f.className=`feedback ${correct?'good':'missed'}`;
  f.innerHTML=`${correct?'🌟 Great job! You spelled it correctly.':'💛 Good try! Let’s learn the spelling together.'}<span class="correct-word">${escapeHtml(w.word)}</span>`;
  $('answerForm').classList.add('hidden');$('oralButtons').classList.add('hidden');$('nextWord').classList.remove('hidden');
  $('hearWord').disabled=false;
  // The clue buttons stay enabled so the child can still review the word before moving on.
  // The sentence shows the word instead of a blank once it has been answered.
  currentRound.answered=true;
  if(currentRound.lastClue==='sentence')showClue('sentence',{speak:false});
  $('meterFill').style.width=`${100*(currentRound.index+1)/currentRound.items.length}%`;
  $('scoreLabel').textContent=`${currentRound.correct} correct so far`;
  // The focused control (answer box, grade button) just hid, so move focus to the next control instead of losing it to <body>.
  $('nextWord').focus({preventScroll:true});
}
function finishRound(){
  $('activeCard').classList.add('hidden');$('roundSummary').classList.remove('hidden');
  history.rounds=(history.rounds||0)+1;writeHistory();
  const total=currentRound.items.length;const correct=currentRound.correct;
  $('roundNumber').textContent='ROUND COMPLETE';$('scoreLabel').textContent=`${correct} / ${total} correct`;
  $('roundSummary').innerHTML=`<div class="bee-bubble" aria-hidden="true">🏆</div><h2 id="summaryHeading" tabindex="-1">What a brave spelling bee!</h2><div class="summary-score">${correct} / ${total}</div><p>Every attempt counts. Review the missed words, then try again!</p><ul class="round-notes">${currentRound.results.map(r=>`<li>${escapeHtml(r.word)} <span>${r.correct?'✓ Correct':'↻ Review'}</span></li>`).join('')}</ul><div class="summary-actions"><button class="primary-btn" id="anotherRound">New random round</button><button class="soft-btn" id="practiceMissed">Practice missed words</button></div>`;
  $('summaryHeading').focus({preventScroll:true});
  $('anotherRound').addEventListener('click',startRound);
  $('practiceMissed').addEventListener('click',()=>{$('pool').value='missed';startRound();});
}
function initRound(){
  $('hearWord').addEventListener('click',()=>{const w=currentWord();if(w)voiceService.speak(w.word,{kind:'word',instant:true});});
  $('starWord').addEventListener('click',()=>{const w=currentWord();if(w)flipStar(w.id);});
  document.querySelectorAll('[data-clue]').forEach(btn=>btn.addEventListener('click',()=>showClue(btn.dataset.clue)));
  $('answerForm').addEventListener('submit',e=>{e.preventDefault();const w=currentWord();if(w)markAnswer(comparison($('answerInput').value)===comparison(w.word));});
  $('revealOral').addEventListener('click',()=>{
    const w=currentWord();if(!w)return;
    $('answerFeedback').className='feedback';$('answerFeedback').innerHTML=`Correct spelling: <span class="correct-word">${escapeHtml(w.word)}</span><p>Did you say each letter correctly?</p>`;
    $('revealOral').classList.add('hidden');$('gradeOral').classList.remove('hidden');
    $('gradeOral').querySelector('button').focus({preventScroll:true});
  });
  document.querySelectorAll('[data-grade]').forEach(btn=>btn.addEventListener('click',()=>markAnswer(btn.dataset.grade==='correct')));
  $('nextWord').addEventListener('click',()=>{currentRound.index++;showCurrent();if(currentWord())$('questionHeading').focus({preventScroll:true});});
}
function wordResults(){let arr=words.slice();const query=$('searchWord').value.trim().toLocaleLowerCase();const group=$('groupFilter').value;const level=$('levelFilter').value;
  if(query)arr=arr.filter(w=>w.word.toLocaleLowerCase().includes(query)||w.definition.toLocaleLowerCase().includes(query));
  if(group!=='all')arr=arr.filter(w=>w.group===group);
  if(level!=='all')arr=arr.filter(w=>w.level===level);
  if($('starFilter').value==='starred')arr=arr.filter(w=>stars.has(w.id));
  return arr;
}
function paintCardStar(btn,w){setStarGlyph(btn,stars.has(w.id));}
function onCardStar(btn){
  const id=Number(btn.dataset.starId),w=words.find(x=>x.id===id);if(!w)return;
  flipStar(id);
  if($('starFilter').value!=='starred'){paintCardStar(btn,w);return;}
  // In "My starred words only" the card leaves the list, so redraw, announce it in the count status, and keep keyboard focus on the nearest card.
  const at=[...document.querySelectorAll('#wordGrid [data-star-id]')].indexOf(btn);
  renderWordBank({removed:w.word});
  const left=document.querySelectorAll('#wordGrid [data-star-id]');
  (left.length?left[Math.min(at,left.length-1)]:$('starFilter')).focus();
}
// Open cards are remembered in memory only (not saved), so a re-render from search, filters or "Show more words" keeps them open.
function toggleDetails(btn){
  const id=Number(btn.dataset.detailsId),w=words.find(x=>x.id===id),panel=document.getElementById(btn.getAttribute('aria-controls'));if(!w||!panel)return;
  const open=btn.getAttribute('aria-expanded')!=='true';
  btn.setAttribute('aria-expanded',String(open));panel.hidden=!open;
  if(open)openCards.add(id);else openCards.delete(id);
}
// "Hear it slowly" passes speedId for this one call only, so the saved speed (Voices tab) is never changed.
function hearFromCard(btn){
  const w=words.find(x=>x.id===Number(btn.dataset.hearId));if(!w)return;
  if(btn.dataset.hear==='sentence')voiceService.speak(sentenceFor(w),{kind:'sentence',instant:true});
  else voiceService.speak(w.word,{kind:'word',instant:true,...(btn.dataset.hear==='slow'?{speedId:'slow'}:{})});
}
// The count is a polite status: it also carries the empty message, and (with `removed`) says which word left the starred list.
function renderWordBank({removed=''}={}){
  if(!words.length)return;
  const list=wordResults(),n=list.length,count=n===1?'1 word':`${n.toLocaleString()} words`;
  const shown=list.slice(0,displayLimit);
  const empty=$('starFilter').value==='starred'&&!starredWords().length?'You have no starred words yet. Press the Star button (☆) on any word to save it here.':'No words found. Try a different search.';
  const gone=removed?`${removed} removed from your starred words. ${n.toLocaleString()} left.`:'';
  $('resultCount').innerHTML=gone?`<span aria-hidden="true">${count}</span><span class="sr-only">${escapeHtml(gone)}${n?'':` ${empty}`}</span>`:`${count}${n?'':`<span class="sr-only">. ${empty}</span>`}`;
  $('wordGrid').innerHTML=shown.length?shown.map(w=>wordCardHtml(w,POS,sentenceFor,{starred:stars.has(w.id),open:openCards.has(w.id)})).join(''):`<p>${empty}</p>`;
  $('loadMore').classList.toggle('hidden',list.length<=displayLimit);
  document.querySelectorAll('[data-say-id]').forEach(button=>button.addEventListener('click',()=>{const w=words.find(w=>w.id===Number(button.dataset.sayId));if(w)voiceService.speak(w.word,{kind:'word',instant:true});}));
}
function initWordBank(){
  $('searchWord').addEventListener('input',()=>{displayLimit=44;renderWordBank();});
  $('groupFilter').addEventListener('change',()=>{displayLimit=44;renderWordBank();});
  $('levelFilter').addEventListener('change',()=>{displayLimit=44;renderWordBank();});
  $('starFilter').addEventListener('change',()=>{displayLimit=44;renderWordBank();});
  $('wordGrid').addEventListener('click',e=>{const btn=e.target.closest('[data-star-id]');if(btn)onCardStar(btn);});
  $('wordGrid').addEventListener('click',e=>{const t=e.target.closest('[data-details-id]');if(t)toggleDetails(t);const h=e.target.closest('[data-hear]');if(h)hearFromCard(h);});
  // The button hides when the list is fully shown, so focus moves to the first new card's Details button instead of being lost.
  $('loadMore').addEventListener('click',()=>{const first=displayLimit;displayLimit+=44;renderWordBank();const card=$('wordGrid').children[first];(card?.querySelector('.details-btn')||$('searchWord')).focus();});
}
function syncVoiceButtons(){
  const settings=voiceService.settings;
  document.querySelectorAll('[data-voice]').forEach(b=>{
    const selected=b.dataset.voice===settings.voiceId;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));
  });
  document.querySelectorAll('[data-speed],[data-practice-speed]').forEach(b=>{const selected=(b.dataset.speed||b.dataset.practiceSpeed)===settings.speedId;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  const radio=document.querySelector(`input[name="engineMode"][value="${settings.mode}"]`);if(radio)radio.checked=true;
}
function initVoiceSettings(){
  $('voiceChoices').innerHTML=VOICES.map((v,i)=>`<button class="voice-card" data-voice="${v.id}" aria-pressed="false"><span class="avatar" aria-hidden="true">${['👩🏽','👩🏻','👨🏽','👨🏻'][i]}</span><strong>${v.label}</strong><small>${v.subtitle}</small><em>${v.gender}</em></button>`).join('');
  // The speed switch on the practice screen: always visible, so a child can go back to Normal at any time.
  // Unlike "Repeat slowly" (one word, one time), this saves the speed, the same as the Voices tab.
  $('practiceSpeed').innerHTML=SPEEDS.map(s=>`<button class="speed-option" data-practice-speed="${s.id}" aria-pressed="false">${s.label}</button>`).join('');
  document.querySelectorAll('[data-practice-speed]').forEach(b=>b.addEventListener('click',()=>{
    voiceService.select({speedId:b.dataset.practiceSpeed});syncVoiceButtons();
    const w=currentWord();if(w)voiceService.speak(w.word,{kind:'word',instant:true});
  }));
  $('speedChoices').innerHTML=SPEEDS.map(s=>`<button class="speed-option" data-speed="${s.id}" aria-pressed="false">${s.label}</button>`).join('');
  syncVoiceButtons();
  document.querySelectorAll('[data-voice]').forEach(b=>b.addEventListener('click',()=>{voiceService.select({voiceId:b.dataset.voice});syncVoiceButtons();const w=currentWord();if(w){voiceService.prefetch(w.word);voiceService.prefetch(sentenceFor(w),'sentence');}}));
  document.querySelectorAll('[data-speed]').forEach(b=>b.addEventListener('click',()=>{voiceService.select({speedId:b.dataset.speed});syncVoiceButtons();voiceService.preview();}));
  document.querySelectorAll('input[name="engineMode"]').forEach(r=>r.addEventListener('change',()=>{if(r.checked){voiceService.select({mode:r.value});syncVoiceButtons();}}));
  $('prepareVoice').addEventListener('click',()=>{voiceService.select({mode:'auto'});syncVoiceButtons();voiceService.prepare({retry:true});});
  $('previewVoice').addEventListener('click',()=>voiceService.preview());
  $('retryVoice').addEventListener('click',()=>{voiceService.select({mode:'auto'});syncVoiceButtons();voiceService.prepare({retry:true});});
  $('downloadUseDevice').addEventListener('click',()=>{voiceService.stop();voiceService.select({mode:'device'});syncVoiceButtons();clearTimeout(noticeTimer);$('downloadLabel').textContent='Device voice selected';$('downloadDetail').textContent='Tap Hear my word or Play voice sample to listen. No download needed.';});
  $('downloadRetry').addEventListener('click',()=>{voiceService.select({mode:'auto'});syncVoiceButtons();voiceService.prepare({retry:true});});
  $('closeNotice').addEventListener('click',()=>{
    releaseNoticeFocus(true);
    $('voiceDownload').classList.add('hidden');
  });
}
// If keyboard focus is inside the voice notice and something in it is about to be hidden, move focus
// first, so it never falls to <body>. hiding=true: the whole notice goes, so focus leaves it.
// hiding=false: the notice stays, so focus goes to its Dismiss button.
function releaseNoticeFocus(hiding){
  if(!$('voiceDownload').contains(document.activeElement))return;
  const target=hiding?($('tab-voices').classList.contains('active')?$('prepareVoice'):document.querySelector('.nav-button.active')):$('closeNotice');
  if(target)target.focus({preventScroll:true});
}
const engineName=e=>({clip:'Recorded',kokoro:'Kokoro',piper:'Piper'})[e]||'Device';
function updateVoiceStatus(status){
  // Initial notification can happen before DOM creation, when the service is constructed.
  if(!document.getElementById('voiceStatus'))return;
  $('voiceStatus').textContent=`${status.label}${status.detail?` ${status.detail}`:''} · Engine: ${engineName(status.engine)}`;
  const visible=['preparing','downloading','generating','switching','error','tap','adult'].includes(status.phase);
  if(visible){clearTimeout(noticeTimer);$('voiceDownload').classList.remove('hidden');}
  else if(['ready','speaking'].includes(status.phase)){
    // A short explicit ready state gives the child reassurance that the download finished.
    if(!$('voiceDownload').classList.contains('hidden')){
      clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{releaseNoticeFocus(true);$('voiceDownload').classList.add('hidden');},4500);
    }
  }
  $('downloadLabel').textContent=status.label;
  $('downloadDetail').textContent=status.detail||'The app will keep working while this voice gets ready.';
  $('downloadEngine').textContent=`Engine: ${engineName(status.engine)}`;
  const bar=$('downloadTrack');const fill=$('downloadFill');
  if(status.percent===null){bar.classList.add('indeterminate');bar.setAttribute('role','progressbar');bar.removeAttribute('aria-valuenow');fill.style.width='40%';$('downloadPercent').textContent='Working…';}
  else {bar.classList.remove('indeterminate');bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(Math.round(status.percent)));fill.style.width=`${status.percent}%`;$('downloadPercent').textContent=`${Math.round(status.percent)}% of current file`;}
  bar.setAttribute('aria-label',status.label);
  const showRetry=['error','tap','adult'].includes(status.phase);
  const showDevice=['downloading','preparing','switching','generating','error','tap'].includes(status.phase);
  if((!showRetry&&document.activeElement===$('downloadRetry'))||(!showDevice&&document.activeElement===$('downloadUseDevice')))releaseNoticeFocus(false);
  $('downloadRetry').classList.toggle('hidden',!showRetry);
  $('downloadUseDevice').classList.toggle('hidden',!showDevice);
}
function initGrownups(){
  $('clearHistory').addEventListener('click',()=>{
    if(!confirm('Clear practice history on this device? This cannot be undone.'))return;
    history={attempts:{},missed:{},rounds:0};writeHistory();setClearStatus('Practice history cleared.');
  });
  $('clearStars').addEventListener('click',()=>{
    if(!confirm('Clear starred words on this device? This cannot be undone.'))return;
    stars.clear();clearStars(store());updateStats();paintRoundStar();
    if(appState.activeTab==='words')renderWordBank();
    setClearStatus('Starred words cleared.');
  });
}
async function main(){
  initNavigation();initBuilder();initRound();initWordBank();initVoiceSettings();initGrownups();
  updateStats();updateVoiceStatus(voiceService.status);
  try{
    const response=await fetch('./words.json');if(!response.ok)throw new Error(`Word bank download failed (${response.status})`);
    words=await response.json();
    // The word list is the source of truth: counts shown on the page follow whatever words.json holds.
    $('wordCount').max=String(words.length);$('pool').options[0].textContent=`All ${words.length.toLocaleString()} words`;
    [...new Set(words.map(w=>w.group))].sort((a,b)=>a.localeCompare(b)).forEach(g=>{$('groupFilter').add(new Option(g,g));});
    updateStats();renderWordBank();
  }catch(err){
    $('roundBuilder').insertAdjacentHTML('beforeend',`<p class="toast" role="alert">The word list could not load. Please refresh the page. (${escapeHtml(err.message)})</p>`);
    $('startRound').disabled=true;
    $('resultCount').textContent='The word list did not load. Please refresh the page.';
  }
}
main();
