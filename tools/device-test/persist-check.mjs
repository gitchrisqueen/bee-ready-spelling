// Plays words and sentences in a real practice round (iPhone WebKit emulation) and checks the playback
// rate of every audio element and the saved speed after each step. Serve the built _site/ first.
//   BASE=http://localhost:8080/ node persist-check.mjs
// Expected: Repeat slowly plays at 0.6 and saves nothing; the next word and sentence play at 1; the speed
// switch (opened from the collapsed voice menu) Slow plays at 0.6 and saves "slow"; Normal plays at 1 and saves "normal". Exits 1 on any mismatch.
import { webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080/';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__plays = [];
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__plays.push({ src: (this.currentSrc || this.src || '').slice(-24), rate: this.playbackRate, def: this.defaultPlaybackRate });
    return origPlay.apply(this, arguments);
  };
  const origRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  window.__rates = [];
  Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
    get() { return origRate.get.call(this); },
    set(v) { window.__rates.push(v); origRate.set.call(this, v); },
  });
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.tap('#startRound');
await page.waitForSelector('#hearWord:visible', { timeout: 15000 });
let failed = false;
const step = async (label, selector, expectRate, expectSaved) => {
  await page.evaluate(() => { window.__plays.length = 0; window.__rates.length = 0; });
  await page.click(selector);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ plays: window.__plays, ratesSet: window.__rates, saved: (() => { try { return JSON.parse(localStorage.getItem('bee-voice-v2-settings') || 'null')?.speedId ?? null; } catch { return null; } })() }));
  const rate = r.plays[0]?.rate;
  const ok = rate === expectRate && r.saved === expectSaved;
  if (!ok) failed = true;
  console.log(ok ? 'ok  ' : 'FAIL', label, `rate=${rate} saved=${r.saved}`);
};
await step('hear word (before)', '#hearWord', 1, null);
await step('repeat slowly', '[data-clue="repeat"]', 0.6, null);
await step('hear word (after slow)', '#hearWord', 1, null);
await step('sentence clue', '[data-clue="sentence"]', 1, null);
await step('hear word again', '#hearWord', 1, null);
// The speed buttons live in the collapsed voice menu: open it first.
await page.click('#practiceVoiceToggle');
await step('speed switch: Slow', '[data-practice-speed="slow"]', 0.6, 'slow');
await step('speed switch: Normal', '[data-practice-speed="normal"]', 1, 'normal');
await step('sentence at Normal', '[data-clue="sentence"]', 1, 'normal');
await browser.close();
process.exitCode = failed ? 1 : 0;
