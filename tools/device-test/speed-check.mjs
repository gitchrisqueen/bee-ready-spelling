// Plays one recorded word at Normal, Clear and Slow in iPhone WebKit and prints the playback rate and timing,
// to confirm the speeds really differ. Serve the built _site/ first.
//   BASE=http://localhost:8080/ node speed-check.mjs
import { webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080/';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
const out = {};
for (const [kind, text, id] of [['word', 'abdicate', 'normal'], ['word', 'abdicate', 'clear'], ['word', 'abdicate', 'slow']]) {
  out[id] = await page.evaluate(async ({ text, id, kind }) => {
    const m = await import('./voice-service.js');
    const svc = new m.BeeVoiceService({ settings: { voiceId: 'heart', speedId: id, mode: 'auto' } });
    const btn = document.createElement('button'); document.body.appendChild(btn);
    let player = null; const ev = []; const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { player = this; for (const n of ['loadedmetadata', 'canplay', 'playing', 'ended']) this.addEventListener(n, () => ev.push([n, Math.round(performance.now()), this.playbackRate])); return origPlay.apply(this, arguments); };
    const r = new Promise(res => btn.addEventListener('click', async () => res(await svc.speak(text, { kind, instant: true })), { once: true }));
    btn.click(); const result = await r;
    await new Promise(res => { const t = setInterval(() => { if (ev.some(e => e[0] === 'ended')) { clearInterval(t); res(); } }, 50); setTimeout(() => { clearInterval(t); res(); }, 4000); });
    HTMLMediaElement.prototype.play = origPlay;
    const playing = ev.find(e => e[0] === 'playing'), ended = ev.find(e => e[0] === 'ended');
    return { result, duration: player && Number(player.duration.toFixed(3)), events: ev.map(e => e.join(':')), audibleSeconds: playing && ended ? Number(((ended[1] - playing[1]) / 1000).toFixed(2)) : null };
  }, { text, id, kind });
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
