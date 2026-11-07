// Drives real WebKit (Safari's engine) with iPhone and iPad presets: touch taps, portrait and landscape.
// Checks tab bar fit, form-field font size (iOS zooms below 16px), tap-target and text sizes, horizontal
// overflow, third-party requests, and the main flows. This is emulation, not a physical device.
//   BASE=http://localhost:8080/ node device-test.mjs   (serve the built _site/ first)
import { webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080/';
const names = ['iPhone SE', 'iPhone 13', 'iPhone 14 Pro Max', 'iPhone 13 landscape', 'iPad (gen 7)', 'iPad Pro 11 landscape'];
import { mkdirSync } from 'node:fs';
mkdirSync('./device-shots', { recursive: true });
const browser = await webkit.launch();
const report = [];
for (const name of names) {
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  const errs = [], external = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:')) external.push(u.slice(0, 90)); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const res = { name, viewport: devices[name].viewport };
  res.nav = await page.evaluate(() => { const n = document.querySelector('nav'); const bs = [...n.querySelectorAll('button')]; return { fits: n.scrollWidth <= n.clientWidth + 1, lastRight: Math.round(bs.at(-1).getBoundingClientRect().right), navRight: Math.round(n.getBoundingClientRect().right), count: bs.length }; });
  res.fields = await page.evaluate(() => [...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]),select,textarea')].map(e => ({ id: e.id, font: parseFloat(getComputedStyle(e).fontSize) })).filter(f => f.font < 16).map(f => f.id + ':' + f.font));
  const flows = {};
  // practice round by touch
  await page.tap('#startRound'); await page.waitForTimeout(500);
  flows.round = await page.evaluate(() => document.getElementById('roundNumber').textContent);
  await page.tap('#hearWord'); await page.waitForTimeout(400);
  flows.hearStatus = await page.evaluate(() => document.getElementById('voiceStatus').textContent.slice(0, 50));
  for (const c of ['definition', 'origin', 'sentence', 'part', 'repeat']) { await page.tap(`[data-clue="${c}"]`); await page.waitForTimeout(200); }
  flows.clue = await page.evaluate(() => document.getElementById('clueResult').innerText.slice(0, 60));
  await page.fill('#answerInput', 'test'); await page.tap('#answerForm button[type=submit]'); await page.waitForTimeout(200);
  flows.feedback = await page.evaluate(() => document.getElementById('answerFeedback').innerText.slice(0, 50));
  await page.tap('#nextWord'); await page.waitForTimeout(200);
  flows.next = await page.evaluate(() => document.getElementById('roundNumber').textContent);
  // word bank
  await page.evaluate(() => { location.hash = 'words'; }); await page.waitForSelector('.word-card');
  await page.tap('#wordGrid button[aria-expanded]'); await page.waitForTimeout(200);
  flows.details = await page.evaluate(() => document.querySelector('#wordGrid button[aria-expanded]').getAttribute('aria-expanded'));
  await page.tap('[data-star-id]'); await page.waitForTimeout(150);
  flows.starCount = await page.evaluate(() => document.getElementById('heroStarred').textContent);
  // voices: tapping a speed plays the sample
  await page.evaluate(() => { location.hash = 'voices'; }); await page.waitForTimeout(300);
  await page.tap('[data-speed="slow"]'); await page.waitForTimeout(500);
  flows.speed = await page.evaluate(() => ({ selected: document.querySelector('[data-speed][aria-pressed="true"]')?.dataset.speed, status: document.getElementById('voiceStatus').textContent.slice(0, 45) }));
  // practice voice menu: starts closed, a tap opens it, a choice keeps it open, Escape closes it and returns focus to the toggle
  await page.evaluate(() => { location.hash = 'practice'; }); await page.waitForTimeout(250);
  const menu = () => page.evaluate(() => ({ expanded: document.getElementById('practiceVoiceToggle').getAttribute('aria-expanded'), hidden: document.getElementById('practiceVoicePanel').hidden }));
  flows.menuClosed = await menu();
  await page.tap('#practiceVoiceToggle'); await page.waitForTimeout(200);
  flows.menuOpen = await menu();
  await page.tap('#practiceVoicePanel [data-practice-speed="clear"]'); await page.waitForTimeout(300);
  flows.menuAfterChoice = await menu();
  await page.focus('#practiceVoicePanel [data-practice-speed="clear"]');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  flows.menuEscape = { ...(await menu()), focus: await page.evaluate(() => document.activeElement.id) };
  await page.tap('#practiceVoiceToggle'); await page.waitForTimeout(200); // leave it open: the practice layout check below measures the open panel
  res.flows = flows;
  // layout checks per tab
  res.tabs = {};
  for (const tab of ['practice', 'words', 'voices', 'grownups']) {
    await page.evaluate(t => { location.hash = t; }, tab); await page.waitForTimeout(250);
    res.tabs[tab] = await page.evaluate(() => {
      const vw = innerWidth; const panel = document.querySelector('.tab-panel.active');
      const small = [...panel.querySelectorAll('button,a[href],select,input:not([type=hidden]):not([type=radio]):not([type=checkbox])')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && !e.closest('.hidden,[hidden]'); }).map(e => { const r = e.getBoundingClientRect(); return (e.getAttribute('aria-label') || e.textContent || e.id).trim().slice(0, 24) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); });
      const tiny = [...panel.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12 && e.getBoundingClientRect().width > 0).map(e => (e.className || e.tagName).toString().slice(0, 24) + ' ' + parseFloat(getComputedStyle(e).fontSize)).slice(0, 4);
      return { overflow: document.documentElement.scrollWidth > vw + 1, small: small.slice(0, 6), tiny };
    });
    await page.screenshot({ path: `./device-shots/${name.replace(/[^a-z0-9]+/gi, '_')}-${tab}.png` });
  }
  res.errors = errs.slice(0, 4); res.external = [...new Set(external)];
  report.push(res); await ctx.close();
}
await browser.close();
const problems = report.flatMap(d => [
  ...(d.flows.menuClosed.expanded === 'false' && d.flows.menuClosed.hidden ? [] : [`${d.name}: voice menu is not closed at the start`]),
  ...(d.flows.menuOpen.expanded === 'true' && !d.flows.menuOpen.hidden ? [] : [`${d.name}: voice menu does not open`]),
  ...(d.flows.menuAfterChoice.expanded === 'true' ? [] : [`${d.name}: voice menu closes after a choice`]),
  ...(d.flows.menuEscape.expanded === 'false' && d.flows.menuEscape.hidden && d.flows.menuEscape.focus === 'practiceVoiceToggle' ? [] : [`${d.name}: Escape does not close the voice menu and return focus to the toggle`]),
  ...(d.nav.fits ? [] : [`${d.name}: tab bar does not fit`]),
  ...d.fields.map(f => `${d.name}: field ${f} is under 16px`),
  ...Object.entries(d.tabs).flatMap(([t, v]) => [
    ...(v.overflow ? [`${d.name}/${t}: horizontal overflow`] : []),
    ...v.small.filter(x => !/x(43|44)$/.test(x)).map(x => `${d.name}/${t}: small tap target ${x}`),
    ...v.tiny.map(x => `${d.name}/${t}: text under 12px ${x}`),
  ]),
]);
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'No problems found.');
process.exitCode = problems.length ? 1 : 0;
