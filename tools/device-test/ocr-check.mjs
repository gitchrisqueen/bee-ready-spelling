// "My words" photo import in a real browser engine: a synthetic photo of a word list (drawn on a canvas with uneven
// light, a slight tilt and noise; no real person's list) goes through the page's file input, and the real Tesseract.js
// reads it from this site's own files. Checks the words found, that every request stays on this site, and that nothing
// is
// saved. Emulation, not a physical device.
//   npm run build && npm run fetch-ocr-assets     (stage the site and the OCR files)
//   BASE=http://localhost:8080/ node ocr-check.mjs   (serve _site first; ENGINE=chromium if WebKit cannot start)
import { chromium, devices, webkit } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080/';
const WORDS = ['abdicate', 'benevolent', 'cemetery', 'deficit', 'environment', 'fluorescent',
  'guarantee', 'hierarchy', 'immediately', 'jeopardy', 'knowledge', 'lieutenant'];
const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name} ${detail}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
};

async function launch() {
  if ((process.env.ENGINE || 'webkit') === 'webkit') {
    try { return { browser: await webkit.launch(), engine: 'WebKit' }; } catch (e) {
      console.log(`WebKit did not start (${String(e).split('\n')[0].slice(0, 80)}); using Chromium.`);
    }
  }
  return { browser: await chromium.launch(), engine: 'Chromium' };
}
const { browser, engine } = await launch();

// The synthetic photo: grey paper that is bright on the left and dim on the right, the list in a dark font, tilted 2
// degrees.
function drawPhoto(words) {
  const canvas = document.createElement('canvas');
  canvas.width = 1400; canvas.height = 1100;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, '#f4f4f0'); gradient.addColorStop(1, '#8c8c86');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(120, 100); ctx.rotate(-0.035);
  ctx.fillStyle = '#1c1c28'; ctx.font = 'bold 54px sans-serif'; ctx.fillText('Spelling Words', 0, 0);
  ctx.font = '58px sans-serif';
  words.forEach((w, i) => ctx.fillText(`${i + 1}. ${w}`, 0, 110 + i * 78));
  ctx.restore();
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 2, 2);
  }
  return canvas.toDataURL('image/png');
}

for (const preset of ['iPhone SE', 'iPad (gen 7)']) {
  console.log(`\n== ${preset} (${engine} emulation)`);
  const d = devices[preset];
  const ctx = engine === 'WebKit' ? await browser.newContext({ ...d }) : await browser.newContext({
    viewport: d.viewport, userAgent: d.userAgent, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true, // preflight: ok
  });
  const page = await ctx.newPage();
  const own = [], external = [], errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 140)));
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin) own.push(u.pathname); else if (!['blob:', 'data:'].includes(u.protocol)) external.push(u.host); // preflight: ok
  });
  await page.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  check('photo buttons are shown', await page.evaluate(() => !document.getElementById('minePhotoBlock').hidden));
  check('the picture buttons have names', await page.evaluate(() =>
    [...document.querySelectorAll('#minePhotoBlock label')].every(l => l.textContent.trim().length > 8)));
  const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort().join());
  const dataUrl = await page.evaluate(drawPhoto, WORDS);
  const started = Date.now();
  await page.setInputFiles('#minePhotoPick', { name: 'list.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }); // preflight: ok
  await page.waitForSelector('#mineChips li', { timeout: 120000 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const found = await page.evaluate(() => [...document.querySelectorAll('#mineChips .mine-chip-row input')].map(i => i.value)); // preflight: ok
  const hits = WORDS.filter(w => found.includes(w));
  console.log(`read in ${seconds}s: found ${found.length} tokens, ${hits.length} of ${WORDS.length} expected words`);
  check('at least 10 of the 12 words were read', hits.length >= 10, `found: ${found.join(' ')}`);
  check('focus moves into the review screen after a successful read', await page.evaluate(() => !!document.activeElement.closest('#mineReview')));
  check('the review screen says the words came from a picture', await page.evaluate(() =>
    /Read from a picture\. Check every word/.test(document.getElementById('mineReviewSummary').textContent)));
  check('the OCR files came from this site', ['worker.min.js', 'tesseract.min.js', 'eng.traineddata.gz'].every(f => own.some(p => p.endsWith(f))), // preflight: ok
    own.filter(p => /ocr/.test(p)).join());
  check('no request went to another host', external.length === 0, [...new Set(external)].join());
  check('nothing was saved by the import', (await page.evaluate(() => Object.keys(localStorage).sort().join())) === keysBefore); // preflight: ok
  check('no IndexedDB database was created', await page.evaluate(async () => (await indexedDB.databases()).length === 0)); // preflight: ok
  check('the picture buttons work again after the read', await page.evaluate(() => !document.getElementById('minePhotoPick').disabled)); // preflight: ok
  // a picture that cannot be read, and one with no words in it: a kind message, the cause in the console, focus kept
  const warnings = [];
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.setInputFiles('#minePhotoPick', { name: 'private-name.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') }); // preflight: ok
  await page.waitForFunction(() => /could not read the picture/.test(document.getElementById('mineStatus').textContent), null, { timeout: 30000 }); // preflight: ok
  await page.waitForTimeout(300);
  check('an unreadable picture gives a kind message and focus returns to the picture button',
    await page.evaluate(() => document.activeElement.id === 'minePhotoPick'));
  check('the cause is logged without the file name',
    warnings.some(w => /My words photo import failed/.test(w)) && !warnings.some(w => /private-name/.test(w)), warnings.join(' | ')); // preflight: ok
  const blank = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
    return c.toDataURL('image/png');
  });
  await page.setInputFiles('#minePhotoCamera', { name: 'blank.png', mimeType: 'image/png', buffer: Buffer.from(blank.split(',')[1], 'base64') }); // preflight: ok
  await page.waitForFunction(() => /No words were found/.test(document.getElementById('mineStatus').textContent), null, { timeout: 60000 }); // preflight: ok
  await page.waitForTimeout(300);
  check('a picture with no words gives a message and focus returns to the picture button',
    await page.evaluate(() => document.activeElement.id === 'minePhotoCamera'));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(`\n${engine} emulation, not a physical device. ${failures.length ? `${failures.length} check(s) failed.` : 'All checks passed.'}`); // preflight: ok
process.exit(failures.length ? 1 : 0);
