// Clicks "Repeat slowly" in a real practice round (iPhone WebKit emulation), then plays the word and the
// sentence again, and prints the playback rate of every audio element that played.
// A rate below 1 after the slow click means the slow speed stuck. Serve the built _site/ first.
//   BASE=http://localhost:8080/ node persist-check.mjs
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
const step = async (label, selector) => {
  await page.evaluate(() => { window.__plays.length = 0; window.__rates.length = 0; });
  await page.click(selector);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ plays: window.__plays, ratesSet: window.__rates, saved: localStorage.getItem('bee-ready-voice-v2') || Object.fromEntries(Object.entries(localStorage).filter(([k]) => /voice/i.test(k))) }));
  console.log(label, JSON.stringify(r));
};
await step('hear word (before)', '#hearWord');
await step('repeat slowly', '[data-clue="repeat"]');
await step('hear word (after slow)', '#hearWord');
await step('sentence clue', '[data-clue="sentence"]');
await step('hear word again', '#hearWord');
await step('speed switch: Slow', '[data-practice-speed="slow"]');
await step('speed switch: Normal', '[data-practice-speed="normal"]');
await step('sentence at Normal', '[data-clue="sentence"]');
await browser.close();
