import test from 'node:test';
import assert from 'node:assert/strict';
import {BeeVoiceService} from '../voice-service.js';
const mem=new Map();
globalThis.localStorage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};
globalThis.speechSynthesis={cancel(){},speak(){},getVoices(){return [{name:'American English',lang:'en-US',localService:true}]}};
globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
URL.createObjectURL=()=>`blob:mock-${Math.random()}`;URL.revokeObjectURL=()=>{};
globalThis.Audio=class {constructor(src){this.src=src;}play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}};

test('Kokoro downloads with truthful progress, then speaks using configured voice',async()=>{
 const events=[],chosen=[];
 const svc=new BeeVoiceService({settings:{voiceId:'bella',speedId:'slow',mode:'auto'},onStatus:e=>events.push(e),loadKokoro:async()=>({KokoroTTS:{from_pretrained:async(id,opts)=>{opts.progress_callback({status:'progress',file:'model_q8.onnx',loaded:50,total:100});return{generate:async(text,settings)=>{chosen.push(settings);return{toBlob:()=>new Blob(['wav'])}}}}}}),loadPiper:async()=>{throw Error('Not used');}});
 assert.equal(await svc.prepare(),'kokoro');
 assert.equal(events.find(e=>e.phase==='downloading')?.percent,50);
 assert.equal(await svc.speak('zucchini'), 'kokoro');
 assert.equal(chosen[0].voice,'af_bella');assert.equal(chosen[0].speed,.7);
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
