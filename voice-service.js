/* Bee Ready voice engine upgrade. No account, API key, or server-side TTS required.
 * Primary: Kokoro.js (WASM/Q8), secondary: Piper in browser, final: Web Speech.
 * Model downloads are on demand and progress is exposed for the UI.
 */
export const VOICES = Object.freeze([
  { id:'heart', label:'Sunny', subtitle:'Warm and encouraging', gender:'Female', kokoro:'af_heart', piper:'en_US-hfc_female-medium' },
  { id:'bella', label:'Bella', subtitle:'Bright and lively', gender:'Female', kokoro:'af_bella', piper:'en_US-hfc_female-medium' },
  { id:'michael', label:'Miles', subtitle:'Calm and confident', gender:'Male', kokoro:'am_michael', piper:'en_US-ryan-medium' },
  { id:'fenrir', label:'Finn', subtitle:'Friendly and upbeat', gender:'Male', kokoro:'am_fenrir', piper:'en_US-ryan-medium' },
]);
// Pre-recorded clips (see tools/clips) are looked up by this key, shared with the generator.
export const PREVIEW_TEXT='Welcome to Bee Ready! Your word is sunshine.';
// ASCII-only on purpose: a plain file name needs no URL escaping, so every static host serves it.
// Accents are dropped (blasé -> blase); anything else outside a-z, 0-9 and "-" becomes "_".
export function clipKey(text){
  if(text===PREVIEW_TEXT)return '_preview';
  return String(text).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]/g,'_');
}
// Sentence clips are named by a hash of the exact sentence, so a clip can never play audio for
// different wording: if a sentence changes, its old clip is simply not found until it is recorded again.
// (cyrb53, a fast non-cryptographic 53-bit hash; the generator uses this same function.)
export function sentenceKey(text){
  const s=String(text).trim().normalize('NFC');
  let h1=0xdeadbeef,h2=0x41c6ce57;
  for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677);}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return 'sentence_'+(4294967296*(2097151&h2)+(h1>>>0)).toString(36);
}
export const SPEEDS = Object.freeze([
  { id:'normal', label:'Normal', value:1 },
  { id:'clear', label:'Clear', value:0.87 },
  { id:'slow', label:'Slow', value:0.7 },
]);

const VERSION='bee-voice-v2';
const KEY=`${VERSION}-settings`;
const DEFAULT_SETTINGS={voiceId:'heart',speedId:'normal',mode:'auto'};
const modelId='onnx-community/Kokoro-82M-v1.0-ONNX';
const AMBIGUOUS=new Set(['learned','dogged']);
// Use Kokoro's browser build: the generic ESM transform pulls in Node fs stubs.
const PREFERRED_KOKORO_URL='https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
// Match Piper's WASM assets (1.18.0) instead of resolving the latest runtime.
const PREFERRED_PIPER_URL='https://esm.sh/@mintplex-labs/piper-tts-web@1.0.5?bundle&deps=onnxruntime-web@1.18.0';
const HF_MODEL_PREFIX=`https://huggingface.co/${modelId}/resolve/main/`;
let selfHostPatched=false;
// The model files are copied into the site at deploy time (scripts/fetch-voice-assets.mjs).
// kokoro-js hardcodes its Hugging Face URLs, so requests for exactly that model are redirected
// to this site. A missing or failing local file falls back to Hugging Face for that request.
async function useSelfHostedModel(){
  if(typeof location==='undefined'||typeof globalThis.fetch!=='function') return false;
  const base=new URL(`./voice-assets/models/${modelId}/`,import.meta.url).href;
  try{if(!(await globalThis.fetch(`${base}config.json`,{method:'HEAD'})).ok) return false;}catch{return false;}
  if(selfHostPatched) return true;
  const original=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async(input,init)=>{
    const isText=typeof input==='string'||input instanceof URL;
    const url=isText?String(input):input?.url;
    const rest=url&&url.startsWith(HF_MODEL_PREFIX)?url.slice(HF_MODEL_PREFIX.length).split('?')[0]:null;
    let local=null;
    if(rest&&!rest.includes('..')){try{const t=new URL(base+rest);if(t.href.startsWith(base))local=t.href;}catch{}}
    if(local){
      try{
        const res=await original(local,isText?init:undefined);
        if(res.ok) return res;
      }catch{}
    }
    return original(input,init);
  };
  selfHostPatched=true;return true;
}
function clipsSupported(){return typeof fetch==='function'&&typeof location!=='undefined';}
function validSettings(data){return {
  voiceId: VOICES.some(v=>v.id===data?.voiceId)?data.voiceId:DEFAULT_SETTINGS.voiceId,
  speedId: SPEEDS.some(v=>v.id===data?.speedId)?data.speedId:DEFAULT_SETTINGS.speedId,
  mode: ['auto','device'].includes(data?.mode)?data.mode:'auto'
};}
function initialSettings(){
  try{return validSettings(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch{return {...DEFAULT_SETTINGS};}
}
function messageOf(err){ return err instanceof Error ? err.message : String(err); }
function niceName(file){ return String(file||'voice model').split('/').pop(); }
function send(eventHandlers,payload){
  for(const fn of eventHandlers){try{fn({...payload,time:Date.now()});}catch(err){console.warn('Voice event handler error',err);}}
}

export class BeeVoiceService {
  constructor({onStatus,loadKokoro,loadPiper,settings}={}) {
    this.settings=validSettings(settings||initialSettings());
    this.listeners=new Set();
    if(onStatus) this.listeners.add(onStatus);
    this.importKokoro=loadKokoro||(()=>import(/* @vite-ignore */ PREFERRED_KOKORO_URL));
    this.importPiper=loadPiper||(()=>import(/* @vite-ignore */ PREFERRED_PIPER_URL));
    this.kokoro=null;this.piper=null;this.loadedPiperVoices=new Set();
    this.primaryPromise=null;this.secondaryPromise=null;
    this.activeEngine='device';this.failedEngines=new Set();
    this.player=null;this.objectUrl=null;this.cache=new Map();this.clips=new Map();this.sequence=0;
    this.status={phase:'idle',engine:'clip',label:'Natural recorded voice ready. Every word plays instantly.',percent:null,detail:'',fallback:false};
    this._notify();
  }
  subscribe(fn){this.listeners.add(fn);fn(this.status);return ()=>this.listeners.delete(fn);}
  _notify(){send(this.listeners,this.status);}
  _status(phase,engine,label,percent=null,detail='',fallback=false){
    this.status={phase,engine,label,percent:Number.isFinite(percent)?Math.max(0,Math.min(100,percent)):null,detail,fallback};this._notify();
  }
  select({voiceId,speedId,mode}={}){
    if(mode && mode!==this.settings.mode) this.stop();
    this.settings=validSettings({...this.settings,voiceId:voiceId??this.settings.voiceId,speedId:speedId??this.settings.speedId,mode:mode??this.settings.mode});
    try{localStorage.setItem(KEY,JSON.stringify(this.settings));}catch{}
    if(this.settings.mode==='device') this._status('ready','device','Device voice selected. Tap Hear my word or Preview voice to listen.');
    else if(this.kokoro) this._status('ready','kokoro','Kokoro natural voice is ready.');
    else if(this.piper) this._status('ready','piper','Piper backup voice is ready.');
    else this._status('idle','clip','Natural recorded voice ready. Every word plays instantly.');
  }
  get voice(){return VOICES.find(v=>v.id===this.settings.voiceId)||VOICES[0];}
  get speed(){return SPEEDS.find(v=>v.id===this.settings.speedId)?.value||1;}
  getEngineLabel(){return ({kokoro:'Kokoro · Natural',piper:'Piper · Backup',device:'Device voice'})[this.activeEngine]||'Device voice';}
  // The percentage intentionally describes only the file currently transferring.
  // Several separate model files may download; never mislabel file progress as overall progress.
  _fileProgress(engine,progress){
    if(this.settings.mode==='device') return;
    const pct=progress?.progress;
    const loaded=Number(progress?.loaded),total=Number(progress?.total);
    const percent=Number.isFinite(loaded)&&Number.isFinite(total)&&total>0?loaded/total*100:(Number.isFinite(pct)?pct:null);
    const file=niceName(progress?.file??progress?.url??'model');
    const size=Number.isFinite(loaded)&&loaded>0 ? `${(loaded/1048576).toFixed(1)} MB` : '';
    const detail=`${file}${size?` · ${size}`:''}`;
    const status=String(progress?.status||'');
    const label=/done|ready/.test(status)?'Finishing a voice file…':`Downloading ${engine==='kokoro'?'Kokoro':'Piper'} voice data…`;
    this._status('downloading',engine,label,percent,detail);
  }
  async _prepareKokoro(){
    if(this.kokoro) return this.kokoro;
    if(this.primaryPromise) return this.primaryPromise;
    this.primaryPromise=(async()=>{
      this._status('preparing','kokoro','Loading the natural voice engine…',null,'The first download may be large.');
      const {KokoroTTS}=await this.importKokoro();
      if(!KokoroTTS?.from_pretrained) throw new Error('The Kokoro library did not load.');
      await useSelfHostedModel();
      // WASM works on a wider range of iPads than WebGPU. Use quantized weights.
      const tts=await KokoroTTS.from_pretrained(modelId,{dtype:'q8',device:'wasm',progress_callback:p=>this._fileProgress('kokoro',p)});
      this.kokoro=tts;
      if(this.settings.mode!=='device'){this.activeEngine='kokoro';this._status('ready','kokoro','Natural voice ready! Tap Play or Start practice.');}
      return tts;
    })().catch(err=>{
      this.failedEngines.add('kokoro');
      if(this.settings.mode!=='device')this._status('switching','piper','Kokoro could not start. Trying the backup voice…',null,messageOf(err),true);
      throw err;
    }).finally(()=>{this.primaryPromise=null;});
    return this.primaryPromise;
  }
  async _preparePiper(){
    if(this.piper){await this._ensurePiperVoice();return this.piper;}
    if(this.secondaryPromise) return this.secondaryPromise;
    this.secondaryPromise=(async()=>{
      this._status('preparing','piper','Preparing backup voice…',null,'Piper downloads its own voice model.');
      const module=await this.importPiper();
      if(!module?.predict||!module?.download) throw new Error('The Piper library did not load.');
      // Only the backup voice relevant to the selected speaker is downloaded.
      const id=this.voice.piper;
      await module.download(id,p=>this._fileProgress('piper',p));
      this.loadedPiperVoices.add(id);this.piper=module;
      if(this.settings.mode!=='device'){this.activeEngine='piper';this._status('ready','piper','Backup natural voice ready.');}
      return module;
    })().catch(err=>{
      this.failedEngines.add('piper');
      if(this.settings.mode!=='device')this._status('switching','device','Backup voice unavailable. Switching to device voice.',null,messageOf(err),true);
      throw err;
    }).finally(()=>{this.secondaryPromise=null;});
    return this.secondaryPromise;
  }
  async _ensurePiperVoice(){
    if(!this.piper)return;
    const id=this.voice.piper;
    if(!this.loadedPiperVoices.has(id)){
      this._status('downloading','piper','Downloading selected backup speaker…');
      await this.piper.download(id,p=>this._fileProgress('piper',p));
      this.loadedPiperVoices.add(id);
    }
  }
  async prepare({retry=false}={}){
    if(this.settings.mode==='device'){
      this.activeEngine='device';this._status('ready','device','Device voice ready.');return 'device';
    }
    if(retry) this.failedEngines.clear();
    if(this.kokoro){this.activeEngine='kokoro';this._status('ready','kokoro','Natural voice ready.');return 'kokoro';}
    if(!this.failedEngines.has('kokoro')){
      try{await this._prepareKokoro();return this.settings.mode==='device'?'device':'kokoro';}catch(e){console.info('Kokoro failed, using backup:',messageOf(e));}
    }
    if(this.settings.mode==='device'){this.activeEngine='device';return 'device';}
    if(this.piper&&!this.failedEngines.has('piper')){try{await this._ensurePiperVoice();if(this.settings.mode==='device'){this.activeEngine='device';return 'device';}this.activeEngine='piper';this._status('ready','piper','Backup voice ready.');return 'piper';}catch(e){this.activeEngine='device';this._status('switching','device','Backup speaker could not load. Using device voice.',null,messageOf(e),true);return 'device';}}
    if(!this.failedEngines.has('piper')){
      try{await this._preparePiper();return this.settings.mode==='device'?'device':'piper';}catch(e){console.info('Piper failed, using device:',messageOf(e));}
    }
    this.activeEngine='device';this._status('ready','device','Device voice is available. Neural voices could not load.',null,'Select Try again to retry natural voices.',true);
    return 'device';
  }
  stop(){
    this.sequence++;
    if(this.player){this.player.pause();this.player.removeAttribute('src');this.player.load?.();this.player=null;}
    if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null;}
    try{speechSynthesis.cancel();}catch{}
  }
  async _playBlob(blob,token,engine,speed=this.speed){
    if(token!==this.sequence) return;
    if(this.player){this.player.pause();this.player=null;}
    if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null;}
    this.objectUrl=URL.createObjectURL(blob);
    const player=new Audio(this.objectUrl);
    player.playbackRate=engine==='piper'||engine==='clip'?speed:1;
    if('preservesPitch' in player)player.preservesPitch=true;
    this.player=player;
    player.onended=()=>{if(this.player===player){this.player=null;this._status('ready',engine,`${engine==='piper'?'Backup':'Natural'} voice ready.`);if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null;}}};
    try{await player.play();}catch(e){
      if(e?.name==='NotAllowedError'){this._status('tap',engine,'Voice is ready. Tap Play once more to hear it.',null,'Safari may require a second tap after downloading audio.');return 'tap';}
      throw e;
    }
    if(token!==this.sequence){player.pause();return;}
    this.activeEngine=engine;
    this._status('speaking',engine,engine==='clip'?'Playing the natural voice…':`${engine==='kokoro'?'Kokoro':'Piper'} is speaking…`);
  }
  _device(text,token,speed=this.speed){
    this.activeEngine='device';
    if(typeof speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined'){
      this._status('error','device','This browser does not support speech playback.',null,'Ask a grown-up to say the word.',true);
      return 'unavailable';
    }
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang='en-US';utterance.rate=speed;utterance.pitch=1;
    const voices=speechSynthesis.getVoices?.()||[];
    const us=voices.filter(v=>/^en[-_]US/i.test(v.lang));
    const other=voices.filter(v=>/^en/i.test(v.lang));
    utterance.voice=us.find(v=>v.localService) || us[0] || other[0] || null;
    utterance.onerror=()=>{if(token===this.sequence)this._status('error','device','Your device could not speak this word.',null,'Try the dictionary pronunciation or ask a grown-up.',true);};
    utterance.onend=()=>{if(token===this.sequence)this._status('ready','device','Device voice ready.');};
    speechSynthesis.cancel();speechSynthesis.speak(utterance);
    this._status('speaking','device','Using your device voice.',null,'Neural audio is not required.',this.settings.mode!=='device');
    return 'device';
  }
  // speedId (optional) overrides the saved speed for this call only. It never calls select() or writes storage.
  async speak(text,{kind='word',allowAmbiguous=false,instant=false,speedId}={}){
    text=String(text??'').trim();if(!text)return 'empty';
    const speed=SPEEDS.find(v=>v.id===speedId)?.value??this.speed;
    if(kind==='word'&&!allowAmbiguous&&AMBIGUOUS.has(text.toLowerCase())){
      this._status('adult','device','Ask your grown-up pronouncer for this word.',null,'Its pronunciation depends on meaning. Check the dictionary before practicing.');return 'adult';
    }
    this.stop();const token=this.sequence;
    if(this.settings.mode==='device')return this._device(text,token,speed);
    // Pre-recorded clips play at once. A cached clip starts without any await, which keeps iOS
    // Safari's tap-to-play permission intact.
    if(clipsSupported()&&(kind==='word'||kind==='sentence'||text===PREVIEW_TEXT)){
      const clipKind=kind==='sentence'?'sentence':'word';
      let blob=this.clips.get(this._clipId(text,clipKind));
      if(blob===undefined){blob=await this._loadClip(text,clipKind);if(token!==this.sequence)return 'cancelled';}
      if(blob){
        try{if(await this._playBlob(blob,token,'clip',speed)==='tap')return 'tap';return 'clip';}
        catch(err){console.info('Recorded clip failed, using live voice:',messageOf(err));}
      }
    }
    // No clip (new word, sentence): never make a child wait for a model download or slow
    // on-device generation. Speak with the device voice now unless a live engine is already loaded.
    if(instant&&!this.kokoro&&!this.piper)return this._device(text,token,speed);
    const preferred=await this.prepare();
    if(token!==this.sequence)return 'cancelled';
    if(preferred==='device')return this._device(text,token,speed);
    if(preferred==='kokoro'){
      try{
        const cacheKey=`kokoro|${this.voice.kokoro}|${speed}|${text}`;
        let blob=this.cache.get(cacheKey);
        if(!blob){
          this._status('generating','kokoro','Creating natural speech…',null,'First use can take longer.');
          const raw=await this.kokoro.generate(text,{voice:this.voice.kokoro,speed});
          blob=raw.toBlob();this.cache.set(cacheKey,blob);
          if(this.cache.size>35)this.cache.delete(this.cache.keys().next().value);
        }
        if(token!==this.sequence)return 'cancelled';
        return await this._playBlob(blob,token,'kokoro',speed)==='tap'?'tap':'kokoro';
      }catch(err){
        if(token!==this.sequence)return 'cancelled';
        if(this.settings.mode==='device')return this._device(text,token,speed);
        this._status('switching','piper','Kokoro playback failed. Trying Piper…',null,messageOf(err),true);
        this.failedEngines.add('kokoro');this.kokoro=null;
      }
    }
    try{
      await this._preparePiper();if(token!==this.sequence)return 'cancelled';
      this._status('generating','piper','Creating backup speech…',null,'Piper is taking over automatically.',true);
      const cacheKey=`piper|${this.voice.piper}|${text}`;
      let blob=this.cache.get(cacheKey);
      if(!blob){
        blob=await this.piper.predict({text,voiceId:this.voice.piper});
        this.cache.set(cacheKey,blob);
        if(this.cache.size>35)this.cache.delete(this.cache.keys().next().value);
      }
      if(token!==this.sequence)return 'cancelled';
      return await this._playBlob(blob,token,'piper',speed)==='tap'?'tap':'piper';
    }catch(err){
      this.failedEngines.add('piper');
      this._status('switching','device','Switching to device voice…',null,messageOf(err),true);
      if(token!==this.sequence)return 'cancelled';
      return this._device(text,token,speed);
    }
  }
  _clipId(text,kind){return `${this.voice.kokoro}|${kind==='sentence'?sentenceKey(text):clipKey(text)}`;}
  async _loadClip(text,kind='word'){
    const id=this._clipId(text,kind);
    if(this.clips.has(id))return this.clips.get(id);
    if(!clipsSupported())return null;
    let blob=null;
    try{
      const key=kind==='sentence'?sentenceKey(text):clipKey(text);
      const res=await fetch(new URL(`./clips/${this.voice.kokoro}/${key}.mp3`,import.meta.url));
      if(res.ok){const b=await res.blob();if(b.size>0)blob=b;}
      else if(res.status!==404)return null;
    }catch{return null;}
    this.clips.set(id,blob);
    if(this.clips.size>300)this.clips.delete(this.clips.keys().next().value);
    return blob;
  }
  // Warm a clip so the next Hear button plays with no wait.
  prefetch(text,kind='word'){if(this.settings.mode==='device')return Promise.resolve();return this._loadClip(String(text).trim(),kind).then(()=>{},()=>{});}
  async preview(){return this.speak(PREVIEW_TEXT,{kind:'sample'});}
}
