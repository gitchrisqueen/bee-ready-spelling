import { BeeVoiceService, VOICES, SPEEDS } from './voice-service.js';
const $ = id => document.getElementById(id);
const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeText = value => String(value??'');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const historyKey='bee-ready-history-v2';
const POS = {n:'noun',v:'verb',adj:'adjective',adv:'adverb',interj:'interjection'};
const curated = {
  'school':'A school of fish swam past the reef.', 'guy':'A strong guy rope kept the tent steady.',
  'mole':'We enjoyed enchiladas covered in mole sauce.', 'calypso':'The rare calypso orchid bloomed in the forest.',
  'kona':'The kona wind brought warm air across the island.',
  'learned':'The learned scientist studied ancient languages.',
  'dogged':'Her dogged effort helped her finish the difficult puzzle.',
  'pizza':'We shared a slice of pizza after the game.',
  'zucchini':'The gardener picked a fresh zucchini for dinner.',
  'xylophone':'Maya played a cheerful song on the xylophone.',
  'democracy':'The class held a vote to understand democracy.',
  'algorithm':'The robot followed an algorithm to find the maze exit.',
  'biopsy':'The doctor used a biopsy to examine a small tissue sample.',
  'amulet':'The traveler carried an amulet in a tiny pouch.',
  'sushi':'The chef rolled sushi with rice and vegetables.',
  'noodle':'A long noodle slipped off my fork.',
  'robot':'The robot carried supplies across the room.',
  'ballet':'She practiced ballet before the recital.',
  'tornado':'The tornado moved across the empty field.',
  'jalapeño':'A jalapeño can make a dish taste spicy.',
  'mozzarella':'We sprinkled mozzarella over the pizza.',
  'haiku':'The student wrote a haiku about spring rain.',
  'origami':'We folded colorful paper into origami cranes.',
  'karate':'He practiced karate with his instructor.',
  'bamboo':'The panda ate bamboo in the forest.',
  'fossil':'The museum displayed a fossil of an ancient sea creature.',
  'umbrella':'She opened her umbrella when it began to rain.',
  'zenith':'At noon, the sun was near its zenith.',
  'graffiti':'Artists painted colorful graffiti on the approved mural wall.'
};
function sentenceFor(w){
  if(curated[w.word.toLowerCase()])return curated[w.word.toLowerCase()];
  const pos=w.part;
  if(pos==='v')return `In the story, the character decided to ${w.word}.`;
  if(pos==='adj')return `The writer described something as ${w.word}.`;
  if(pos==='adv')return `The musician tried to play ${w.word}.`;
  if(pos==='interj')return `The traveler said, “${w.word}!”`;
  return `In our lesson, we learned more about ${w.word}.`;
}
function hideWord(sentence,word){
  const norm=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return sentence.replace(new RegExp(norm,'gi'),'_______');
}
function comparison(s){return String(s).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en-US').replace(/[^\p{L}]/gu,'');}
function getHistory(){try{return JSON.parse(localStorage.getItem(historyKey))||{attempts:{},missed:{},rounds:0};}catch{return {attempts:{},missed:{},rounds:0};}}
function writeHistory(){try{localStorage.setItem(historyKey,JSON.stringify(history));}catch{} updateStats();}
let history=getHistory();let words=[];let currentRound=null;let displayLimit=44;let selectedCount=5;
let noticeTimer=0;let voiceService=new BeeVoiceService({onStatus:updateVoiceStatus});
const appState={activeTab:'practice'};
function updateStats(){
  $('heroBest').textContent=Object.keys(history.attempts||{}).length.toLocaleString();
  $('heroMissed').textContent=Object.keys(history.missed||{}).length.toLocaleString();
  $('heroWordCount').textContent=words.length?words.length.toLocaleString():'1,155';
}
function showTab(tab){
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
}
function initNavigation(){
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.go)));
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
  if(!pool.length){$('roundArea').classList.remove('hidden');$('activeCard').classList.add('hidden');$('roundSummary').classList.remove('hidden');$('roundSummary').innerHTML='<h2>No review words yet! 🎉</h2><p>Finish a practice round first, then your missed words will appear here.</p>';return;}
  const count=Math.min(pool.length,Math.max(1,Number($('wordCount').value)||5));
  currentRound={items:sampleNoRepeat(pool,count),index:0,correct:0,results:[],mode:$('practiceMode').value,clues:new Set()};
  $('roundArea').classList.remove('hidden');$('roundSummary').classList.add('hidden');$('activeCard').classList.remove('hidden');
  showCurrent();$('roundArea').scrollIntoView({behavior:'smooth',block:'start'});
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
  $('clueResult').hidden=true;$('clueResult').textContent='';
  $('answerFeedback').className='feedback hidden';
  $('nextWord').classList.add('hidden');
  $('answerInput').value='';$('answerInput').disabled=false;$('answerForm').classList.toggle('hidden',currentRound.mode==='oral');
  $('oralButtons').classList.toggle('hidden',currentRound.mode!=='oral');
  $('revealOral').classList.remove('hidden');$('gradeOral').classList.add('hidden');
  $('hearWord').disabled=false;
  document.querySelectorAll('[data-clue]').forEach(b=>b.disabled=false);
  voiceService.prefetch(w.word);
}
function showClue(type){
  const w=currentWord();if(!w)return;
  if(type==='repeat') {voiceService.select({speedId:'slow'});syncVoiceButtons();voiceService.speak(w.word,{kind:'word',instant:true});return;}
  const clueText = type==='definition'?`<strong>Definition</strong>${escapeHtml(w.definition)}`:
    type==='origin'?`<strong>Original booklet group</strong>${escapeHtml(w.group)}<div class="helper">The booklet's category is a study clue, not the full history of the word.</div>`:
    type==='part'?`<strong>Part of speech</strong>${escapeHtml(POS[w.part]||'Word')}`:
    `<strong>In a sentence</strong>${escapeHtml(hideWord(sentenceFor(w),w.word))}`;
  $('clueResult').innerHTML=clueText;$('clueResult').hidden=false;
  if(type==='sentence')voiceService.speak(sentenceFor(w),{kind:'sentence',instant:true});
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
  document.querySelectorAll('[data-clue]').forEach(b=>b.disabled=true);
  $('meterFill').style.width=`${100*(currentRound.index+1)/currentRound.items.length}%`;
  $('scoreLabel').textContent=`${currentRound.correct} correct so far`;
}
function finishRound(){
  $('activeCard').classList.add('hidden');$('roundSummary').classList.remove('hidden');
  history.rounds=(history.rounds||0)+1;writeHistory();
  const total=currentRound.items.length;const correct=currentRound.correct;
  $('roundNumber').textContent='ROUND COMPLETE';$('scoreLabel').textContent=`${correct} / ${total} correct`;
  $('roundSummary').innerHTML=`<div class="bee-bubble">🏆</div><h2>What a brave spelling bee!</h2><div class="summary-score">${correct} / ${total}</div><p>Every attempt counts. Review the missed words, then try again!</p><ul class="round-notes">${currentRound.results.map(r=>`<li>${escapeHtml(r.word)} <span>${r.correct?'✓ Correct':'↻ Review'}</span></li>`).join('')}</ul><div class="summary-actions"><button class="primary-btn" id="anotherRound">New random round</button><button class="soft-btn" id="practiceMissed">Practice missed words</button></div>`;
  $('anotherRound').addEventListener('click',startRound);
  $('practiceMissed').addEventListener('click',()=>{$('pool').value='missed';startRound();});
}
function initRound(){
  $('hearWord').addEventListener('click',()=>{const w=currentWord();if(w)voiceService.speak(w.word,{kind:'word',instant:true});});
  document.querySelectorAll('[data-clue]').forEach(btn=>btn.addEventListener('click',()=>showClue(btn.dataset.clue)));
  $('answerForm').addEventListener('submit',e=>{e.preventDefault();const w=currentWord();if(w)markAnswer(comparison($('answerInput').value)===comparison(w.word));});
  $('revealOral').addEventListener('click',()=>{
    const w=currentWord();if(!w)return;
    $('answerFeedback').className='feedback';$('answerFeedback').innerHTML=`Correct spelling: <span class="correct-word">${escapeHtml(w.word)}</span><p>Did you say each letter correctly?</p>`;
    $('revealOral').classList.add('hidden');$('gradeOral').classList.remove('hidden');
  });
  document.querySelectorAll('[data-grade]').forEach(btn=>btn.addEventListener('click',()=>markAnswer(btn.dataset.grade==='correct')));
  $('nextWord').addEventListener('click',()=>{currentRound.index++;showCurrent();});
}
function wordResults(){let arr=words.slice();const query=$('searchWord').value.trim().toLocaleLowerCase();const group=$('groupFilter').value;const level=$('levelFilter').value;
  if(query)arr=arr.filter(w=>w.word.toLocaleLowerCase().includes(query)||w.definition.toLocaleLowerCase().includes(query));
  if(group!=='all')arr=arr.filter(w=>w.group===group);
  if(level!=='all')arr=arr.filter(w=>w.level===level);
  return arr;
}
function renderWordBank(){
  if(!words.length)return;
  const list=wordResults();$('resultCount').textContent=`${list.length.toLocaleString()} words`;
  const shown=list.slice(0,displayLimit);
  $('wordGrid').innerHTML=shown.length?shown.map(w=>`<article class="word-card"><div class="word-meta">${escapeHtml(w.group)} · ${w.level} · ${escapeHtml(POS[w.part]||'word')}</div><h3>${escapeHtml(w.word)}</h3><p>${escapeHtml(w.definition)}</p><div class="word-card-actions"><button class="mini-btn" data-say-id="${w.id}" aria-label="Hear ${escapeHtml(w.word)}">🔊 Listen</button><a href="https://www.merriam-webster.com/dictionary/${encodeURIComponent(w.word)}" target="_blank" rel="noopener noreferrer">Dictionary ↗</a></div></article>`).join(''):'<p>No words found. Try a different search.</p>';
  $('loadMore').classList.toggle('hidden',list.length<=displayLimit);
  document.querySelectorAll('[data-say-id]').forEach(button=>button.addEventListener('click',()=>{const w=words.find(w=>w.id===Number(button.dataset.sayId));if(w)voiceService.speak(w.word,{kind:'word',instant:true});}));
}
function initWordBank(){
  $('searchWord').addEventListener('input',()=>{displayLimit=44;renderWordBank();});
  $('groupFilter').addEventListener('change',()=>{displayLimit=44;renderWordBank();});
  $('levelFilter').addEventListener('change',()=>{displayLimit=44;renderWordBank();});
  $('loadMore').addEventListener('click',()=>{displayLimit+=44;renderWordBank();});
}
function syncVoiceButtons(){
  const settings=voiceService.settings;
  document.querySelectorAll('[data-voice]').forEach(b=>{
    const selected=b.dataset.voice===settings.voiceId;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));
  });
  document.querySelectorAll('[data-speed]').forEach(b=>{const selected=b.dataset.speed===settings.speedId;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  const radio=document.querySelector(`input[name="engineMode"][value="${settings.mode}"]`);if(radio)radio.checked=true;
}
function initVoiceSettings(){
  $('voiceChoices').innerHTML=VOICES.map((v,i)=>`<button class="voice-card" data-voice="${v.id}" aria-pressed="false"><span class="avatar">${['👩🏽','👩🏻','👨🏽','👨🏻'][i]}</span><strong>${v.label}</strong><small>${v.subtitle}</small><em>${v.gender}</em></button>`).join('');
  $('speedChoices').innerHTML=SPEEDS.map(s=>`<button class="speed-option" data-speed="${s.id}" aria-pressed="false">${s.label}</button>`).join('');
  syncVoiceButtons();
  document.querySelectorAll('[data-voice]').forEach(b=>b.addEventListener('click',()=>{voiceService.select({voiceId:b.dataset.voice});syncVoiceButtons();const w=currentWord();if(w)voiceService.prefetch(w.word);}));
  document.querySelectorAll('[data-speed]').forEach(b=>b.addEventListener('click',()=>{voiceService.select({speedId:b.dataset.speed});syncVoiceButtons();}));
  document.querySelectorAll('input[name="engineMode"]').forEach(r=>r.addEventListener('change',()=>{if(r.checked){voiceService.select({mode:r.value});syncVoiceButtons();}}));
  $('prepareVoice').addEventListener('click',()=>{voiceService.select({mode:'auto'});syncVoiceButtons();voiceService.prepare({retry:true});});
  $('previewVoice').addEventListener('click',()=>voiceService.preview());
  $('retryVoice').addEventListener('click',()=>{voiceService.select({mode:'auto'});syncVoiceButtons();voiceService.prepare({retry:true});});
  $('downloadUseDevice').addEventListener('click',()=>{voiceService.stop();voiceService.select({mode:'device'});syncVoiceButtons();clearTimeout(noticeTimer);$('downloadLabel').textContent='Device voice selected';$('downloadDetail').textContent='Tap Hear my word or Preview voice to listen. No download needed.';});
  $('downloadRetry').addEventListener('click',()=>{voiceService.select({mode:'auto'});syncVoiceButtons();voiceService.prepare({retry:true});});
  $('closeNotice').addEventListener('click',()=>{$('voiceDownload').classList.add('hidden');});
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
      clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('voiceDownload').classList.add('hidden'),4500);
    }
  }
  $('downloadLabel').textContent=status.label;
  $('downloadDetail').textContent=status.detail||'The app will keep working while this voice gets ready.';
  $('downloadEngine').textContent=`Engine: ${engineName(status.engine)}`;
  const bar=$('downloadTrack');const fill=$('downloadFill');
  if(status.percent===null){bar.classList.add('indeterminate');bar.setAttribute('role','progressbar');bar.removeAttribute('aria-valuenow');fill.style.width='40%';$('downloadPercent').textContent='Working…';}
  else {bar.classList.remove('indeterminate');bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(Math.round(status.percent)));fill.style.width=`${status.percent}%`;$('downloadPercent').textContent=`${Math.round(status.percent)}% of current file`;}
  bar.setAttribute('aria-label',status.label);
  $('downloadRetry').classList.toggle('hidden',!['error','tap','adult'].includes(status.phase));
  $('downloadUseDevice').classList.toggle('hidden',!['downloading','preparing','switching','generating','error','tap'].includes(status.phase));
}
function initGrownups(){
  $('clearHistory').addEventListener('click',()=>{
    if(!confirm('Clear practice history on this device? This cannot be undone.'))return;
    history={attempts:{},missed:{},rounds:0};writeHistory();$('clearHistory').textContent='Practice history cleared ✓';
  });
}
async function main(){
  initNavigation();initBuilder();initRound();initWordBank();initVoiceSettings();initGrownups();
  updateStats();updateVoiceStatus(voiceService.status);
  try{
    const response=await fetch('./words.json');if(!response.ok)throw new Error(`Word bank download failed (${response.status})`);
    words=await response.json();
    if(words.length!==1155)console.warn('Expected 1155 entries. Received',words.length);
    [...new Set(words.map(w=>w.group))].sort((a,b)=>a.localeCompare(b)).forEach(g=>{$('groupFilter').add(new Option(g,g));});
    updateStats();renderWordBank();
  }catch(err){
    $('roundBuilder').insertAdjacentHTML('beforeend',`<p class="toast">The word list could not load. Please refresh the page. (${escapeHtml(err.message)})</p>`);
    $('startRound').disabled=true;
  }
}
main();
