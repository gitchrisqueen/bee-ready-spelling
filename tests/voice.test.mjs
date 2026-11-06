import test from 'node:test';
import assert from 'node:assert/strict';
import {BeeVoiceService} from '../voice-service.js';
const mem=new Map();
globalThis.localStorage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};
globalThis.speechSynthesis={cancel(){},speak(){},getVoices(){return [{name:'American English',lang:'en-US',localService:true}]}};
globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
URL.createObjectURL=()=>`blob:mock-${Math.random()}`;URL.revokeObjectURL=()=>{};
globalThis.Audio=class {constructor(src){this.src=src;}play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}addEventListener(){}};

test('Kokoro downloads with truthful progress, then speaks using configured voice',async()=>{
 const events=[],chosen=[];
 const svc=new BeeVoiceService({settings:{voiceId:'bella',speedId:'slow',mode:'auto'},onStatus:e=>events.push(e),loadKokoro:async()=>({KokoroTTS:{from_pretrained:async(id,opts)=>{opts.progress_callback({status:'progress',file:'model_q8.onnx',loaded:50,total:100});return{generate:async(text,settings)=>{chosen.push(settings);return{toBlob:()=>new Blob(['wav'])}}}}}}),loadPiper:async()=>{throw Error('Not used');}});
 assert.equal(await svc.prepare(),'kokoro');
 assert.equal(events.find(e=>e.phase==='downloading')?.percent,50);
 assert.equal(await svc.speak('zucchini'), 'kokoro');
 assert.equal(chosen[0].voice,'af_bella');assert.equal(chosen[0].speed,.6);
});

test('on primary failure switch to Piper and download current gender voice',async()=>{
 const events=[],downloaded=[];
 const svc=new BeeVoiceService({settings:{voiceId:'michael',speedId:'normal',mode:'auto'},onStatus:e=>events.push(e),loadKokoro:async()=>{throw Error('offline');},loadPiper:async()=>({download:async(id,cb)=>{downloaded.push(id);cb({url:'voice.onnx',loaded:63,total:100});},predict:async()=>new Blob(['sound'])})});
 assert.equal(await svc.speak('plaza'),'piper');
 assert.equal(downloaded[0],'en_US-ryan-medium');assert.ok(events.some(e=>e.phase==='switching'&&e.engine==='piper'));
 svc.select({voiceId:'heart'});
 assert.equal(await svc.speak('home'),'piper');
 assert.ok(downloaded.includes('en_US-hfc_female-medium'));
});

test('when both neural engines fail automatically use device voice',async()=>{
 const events=[];
 const svc=new BeeVoiceService({onStatus:e=>events.push(e),loadKokoro:async()=>{throw Error('broken A')},loadPiper:async()=>{throw Error('broken B')}});
 assert.equal(await svc.speak('banana'),'device');
 assert.ok(events.some(e=>e.engine==='device'&&e.fallback));
});

test('ambiguous word safeguards and no-download device mode',async()=>{
 let called=false;const svc=new BeeVoiceService({settings:{voiceId:'heart',speedId:'normal',mode:'device'},loadKokoro:async()=>{called=true;throw Error('not allowed');}});
 assert.equal(await svc.speak('learned',{kind:'word'}),'adult');
 assert.equal(await svc.speak('banana',{kind:'word'}),'device');assert.equal(called,false);
});

test('selecting device cancels pending Kokoro generation',async()=>{
 let release;
 const generated=new Promise(resolve=>{release=resolve;});
 const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>({KokoroTTS:{from_pretrained:async()=>({generate:()=>generated})}})});
 await svc.prepare();
 const speaking=svc.speak('sunshine');
 await Promise.resolve();
 svc.select({mode:'device'});
 release({toBlob:()=>new Blob(['audio'])});
 assert.equal(await speaking,'cancelled');
 assert.equal(svc.player,null);
 assert.equal(await svc.speak('sunshine'),'device');
});

test('device selection during rejected primary load never starts Piper',async()=>{
 let rejectLoad,piperCalls=0;
 const loading=new Promise((resolve,reject)=>{rejectLoad=reject;});
 const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:()=>loading,loadPiper:async()=>{piperCalls++;throw Error('unexpected');}});
 const preparing=svc.prepare();
 svc.select({mode:'device'});
 rejectLoad(Error('offline'));
 assert.equal(await preparing,'device');
 assert.equal(piperCalls,0);
});

test('Piper inference failure is skipped until explicit retry',async()=>{
 let predictions=0;
 const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>{throw Error('offline');},loadPiper:async()=>({download:async()=>{},predict:async()=>{predictions++;throw Error('inference failed');}})});
 assert.equal(await svc.speak('one'),'device');
 assert.equal(await svc.speak('two'),'device');
 assert.equal(predictions,1);
 await svc.prepare({retry:true});
 assert.equal(await svc.speak('three'),'device');
 assert.equal(predictions,2);
});

test('Piper second-tap retry reuses audio after autoplay rejection',async()=>{
 const OriginalAudio=globalThis.Audio;let plays=0,predictions=0;
 globalThis.Audio=class extends OriginalAudio {play(){if(++plays===1)return Promise.reject(Object.assign(Error('gesture required'),{name:'NotAllowedError'}));return Promise.resolve();}};
 try{
  const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>{throw Error('offline');},loadPiper:async()=>({download:async()=>{},predict:async()=>{predictions++;return new Blob(['audio']);}})});
  assert.equal(await svc.speak('sunshine'),'tap');
  assert.equal(await svc.speak('sunshine'),'piper');
  assert.equal(predictions,1);
 }finally{globalThis.Audio=OriginalAudio;}
});

test('cancelled Kokoro inference rejection never starts Piper',async()=>{
 let rejectGeneration,piperCalls=0;
 const generated=new Promise((resolve,reject)=>{rejectGeneration=reject;});
 const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>({KokoroTTS:{from_pretrained:async()=>({generate:()=>generated})}}),loadPiper:async()=>{piperCalls++;throw Error('unexpected');}});
 await svc.prepare();
 const speaking=svc.speak('sunshine');
 await Promise.resolve();
 svc.select({mode:'device'});
 rejectGeneration(Error('inference failed'));
 assert.equal(await speaking,'cancelled');
 assert.equal(piperCalls,0);
});

test('model requests go to this site when a self-hosted copy exists, with per-request fallback',async()=>{
 const urls=[];let localOk=true;
 globalThis.location={href:'https://example.test/app/'};
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(input)=>{const u=String(input);urls.push(u);return {ok:u.includes('/voice-assets/')?localOk:true};};
 try{
  const model='https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
  const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>({KokoroTTS:{from_pretrained:async()=>{
   await globalThis.fetch(`${model}onnx/model_quantized.onnx`);
   await globalThis.fetch('https://huggingface.co/other/model/resolve/main/x.bin');
   return {generate:async()=>({toBlob:()=>new Blob(['a'])})};
  }}})});
  assert.equal(await svc.prepare(),'kokoro');
  assert.ok(urls.some(u=>/\/voice-assets\/models\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/onnx\/model_quantized\.onnx$/.test(u)));
  assert.ok(urls.includes('https://huggingface.co/other/model/resolve/main/x.bin'),'unrelated URLs are untouched');
  urls.length=0;localOk=false;
  await globalThis.fetch(`${model}tokenizer.json?download=1`);
  assert.equal(urls.at(-1),`${model}tokenizer.json?download=1`,'falls back to Hugging Face when the local file fails');
 }finally{globalThis.fetch=realFetch;delete globalThis.location;}
});

test('no redirect when no self-hosted copy exists',async()=>{
 globalThis.location={href:'https://example.test/'};
 const realFetch=globalThis.fetch;
 // Module-level patch from the previous test may already be installed; only assert on a fresh HEAD miss.
 globalThis.fetch=async()=>({ok:false});
 try{
  const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>({KokoroTTS:{from_pretrained:async()=>({generate:async()=>({toBlob:()=>new Blob(['a'])})})}})});
  assert.equal(await svc.prepare(),'kokoro');
 }finally{globalThis.fetch=realFetch;delete globalThis.location;}
});

function withClipFetch(handler,fn){
 return async()=>{
  const realFetch=globalThis.fetch;const requested=[];
  globalThis.location={href:'https://example.test/'};
  globalThis.fetch=async(url)=>{requested.push(String(url));return handler(String(url));};
  try{await fn(requested);}finally{globalThis.fetch=realFetch;delete globalThis.location;}
 };
}
const okClip=()=>({ok:true,status:200,blob:async()=>new Blob(['mp3-bytes'])});

test('a recorded clip plays instantly with the right voice and speed, without loading any model',withClipFetch(okClip,async(requested)=>{
 let loaded=false;const events=[];
 const svc=new BeeVoiceService({settings:{voiceId:'bella',speedId:'slow',mode:'auto'},onStatus:e=>events.push(e),loadKokoro:async()=>{loaded=true;throw Error('must not load');}});
 assert.equal(await svc.speak('Zucchini',{kind:'word',instant:true}),'clip');
 assert.match(requested[0],/\/clips\/af_bella\/zucchini\.mp3$/);
 assert.equal(svc.player.playbackRate,0.6);
 assert.equal(loaded,false);
 assert.ok(events.some(e=>e.engine==='clip'&&e.phase==='speaking'));
}));

test('a prefetched clip starts with no extra network request',withClipFetch(okClip,async(requested)=>{
 const svc=new BeeVoiceService({settings:{voiceId:'heart',mode:'auto'}});
 await svc.prefetch('plaza');
 assert.equal(requested.length,1);
 assert.equal(await svc.speak('plaza',{kind:'word',instant:true}),'clip');
 assert.equal(requested.length,1);
}));

test('the voice sample uses a recorded clip',withClipFetch(okClip,async(requested)=>{
 const svc=new BeeVoiceService({settings:{voiceId:'michael',mode:'auto'}});
 assert.equal(await svc.preview(),'clip');
 assert.match(requested[0],/\/clips\/am_michael\/_preview\.mp3$/);
}));

test('a word with no clip speaks with the device voice at once instead of waiting for a model',withClipFetch(()=>({ok:false,status:404}),async()=>{
 let loaded=false;
 const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>{loaded=true;throw Error('must not load');}});
 assert.equal(await svc.speak('brandnewword',{kind:'word',instant:true}),'device');
 assert.equal(await svc.speak('In the story, the character decided to run.',{kind:'sentence',instant:true}),'device');
 assert.equal(loaded,false);
}));

test('a missing clip still uses the live engine when the caller does not ask for instant speech',withClipFetch(()=>({ok:false,status:404}),async()=>{
 const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>({KokoroTTS:{from_pretrained:async()=>({generate:async()=>({toBlob:()=>new Blob(['a'])})})}})});
 assert.equal(await svc.speak('plaza',{kind:'word'}),'kokoro');
}));

test('a network error on the clip never blocks speech',withClipFetch(()=>{throw new TypeError('offline');},async()=>{
 const svc=new BeeVoiceService({settings:{mode:'auto'}});
 assert.equal(await svc.speak('plaza',{kind:'word',instant:true}),'device');
}));

test('clip keys are stable, ASCII and filename-safe',async()=>{
 const {clipKey,PREVIEW_TEXT}=await import('../voice-service.js');
 assert.equal(clipKey('Zucchini'),'zucchini');
 assert.equal(clipKey(' jalapeño '),'jalapeno');
 assert.equal(clipKey('blasé'),'blase');
 assert.equal(clipKey('rough-hewn'),'rough-hewn');
 assert.equal(clipKey("don't ../x"),'don_t____x');
 assert.equal(clipKey(PREVIEW_TEXT),'_preview');
});

test('model redirect refuses path traversal',withClipFetch(okClip,async(requested)=>{
 const model='https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
 const svc=new BeeVoiceService({settings:{mode:'auto'},loadKokoro:async()=>({KokoroTTS:{from_pretrained:async()=>{
  await globalThis.fetch(`${model}../../secret`);
  return {generate:async()=>({toBlob:()=>new Blob(['a'])})};
 }}})});
 await svc.prepare();
 assert.ok(requested.includes(`${model}../../secret`),'goes to the original URL, never a local one');
 assert.ok(!requested.some(u=>u.includes('/voice-assets/models/')&&u.includes('..')));
}));

test('a sentence clue plays its own recorded clip, named by a hash of the sentence',withClipFetch(okClip,async(requested)=>{
 const {sentenceKey}=await import('../voice-service.js');
 const sentence='The gardener picked a fresh zucchini for dinner.';
 const svc=new BeeVoiceService({settings:{voiceId:'michael',mode:'auto'},loadKokoro:async()=>{throw Error('must not load');}});
 assert.equal(await svc.speak(sentence,{kind:'sentence',instant:true}),'clip');
 assert.ok(requested[0].endsWith(`/clips/am_michael/${sentenceKey(sentence)}.mp3`));
 assert.match(sentenceKey(sentence),/^sentence_[a-z0-9]+$/);
}));

import {sentenceKey as keyOf} from '../voice-service.js';
const sentenceKeyOld=keyOf('The old sentence.');
test('a reworded sentence never plays the old recording',withClipFetch(url=>url.includes(sentenceKeyOld)?okClip():({ok:false,status:404}),async()=>{
 const svc=new BeeVoiceService({settings:{mode:'auto'}});
 assert.equal(await svc.speak('The old sentence.',{kind:'sentence',instant:true}),'clip');
 assert.equal(await svc.speak('The new wording of that sentence.',{kind:'sentence',instant:true}),'device');
}));

test('sentence keys are stable and differ for different sentences',async()=>{
 const {sentenceKey}=await import('../voice-service.js');
 assert.equal(sentenceKey('Hello there.'),sentenceKey('  Hello there. '));
 assert.notEqual(sentenceKey('Hello there.'),sentenceKey('Hello there!'));
 assert.equal(sentenceKey('Hello there.'),'sentence_'+sentenceKey('Hello there.').slice(9));
});

test('a prefetched sentence clip needs no extra request when the clue is used',withClipFetch(okClip,async(requested)=>{
 const svc=new BeeVoiceService({settings:{voiceId:'heart',mode:'auto'}});
 await svc.prefetch('In our lesson, we learned more about aqueduct.','sentence');
 assert.equal(requested.length,1);
 assert.equal(await svc.speak('In our lesson, we learned more about aqueduct.',{kind:'sentence',instant:true}),'clip');
 assert.equal(requested.length,1);
}));

test('speedId changes the speed for that one clip call only; the saved speed and storage are untouched',withClipFetch(okClip,async()=>{
 const realSet=globalThis.localStorage.setItem;const writes=[];
 globalThis.localStorage.setItem=(k,v)=>{writes.push(k);return realSet(k,v);};
 try{
  const svc=new BeeVoiceService({settings:{voiceId:'heart',speedId:'normal',mode:'auto'}});
  assert.equal(await svc.speak('plaza',{kind:'word',instant:true,speedId:'slow'}),'clip');
  assert.equal(svc.player.playbackRate,0.6);
  assert.equal(svc.settings.speedId,'normal');assert.equal(svc.speed,1);
  assert.equal(await svc.speak('plaza',{kind:'word',instant:true}),'clip');
  assert.equal(svc.player.playbackRate,1,'the next normal call uses the saved speed again');
  assert.equal(await svc.speak('plaza',{kind:'word',instant:true,speedId:'not-a-speed'}),'clip');
  assert.equal(svc.player.playbackRate,1,'an unknown speedId is ignored');
  assert.deepEqual(writes,[],'speak() never writes localStorage');
 }finally{globalThis.localStorage.setItem=realSet;}
}));

test('speedId also slows device speech for that call only',async()=>{
 const rates=[];const realSpeak=globalThis.speechSynthesis.speak;
 globalThis.speechSynthesis.speak=u=>rates.push(u.rate);
 try{
  const svc=new BeeVoiceService({settings:{voiceId:'heart',speedId:'clear',mode:'device'}});
  await svc.speak('plaza',{kind:'word',speedId:'slow'});
  await svc.speak('plaza',{kind:'word'});
  assert.deepEqual(rates,[0.6,0.8]);assert.equal(svc.settings.speedId,'clear');
 }finally{globalThis.speechSynthesis.speak=realSpeak;}
});

test('speedId reaches Kokoro and Piper, and the Kokoro cache keeps the speeds apart',async()=>{
 const speeds=[];
 const svc=new BeeVoiceService({settings:{voiceId:'heart',speedId:'normal',mode:'auto'},loadKokoro:async()=>({KokoroTTS:{from_pretrained:async()=>({generate:async(t,o)=>{speeds.push(o.speed);return{toBlob:()=>new Blob(['a'])};}})}})});
 assert.equal(await svc.speak('plaza',{kind:'word'}),'kokoro');
 assert.equal(await svc.speak('plaza',{kind:'word',speedId:'slow'}),'kokoro');
 assert.equal(await svc.speak('plaza',{kind:'word'}),'kokoro');
 assert.deepEqual(speeds,[1,0.6],'normal is cached; slow is generated once, separately');
 assert.equal(svc.settings.speedId,'normal');
 const piper=new BeeVoiceService({settings:{voiceId:'heart',speedId:'normal',mode:'auto'},loadKokoro:async()=>{throw Error('no');},loadPiper:async()=>({download:async()=>{},predict:async()=>new Blob(['p'])})});
 assert.equal(await piper.speak('plaza',{kind:'word',speedId:'slow'}),'piper');
 assert.equal(piper.player.playbackRate,0.6);assert.equal(piper.speed,1);
});
