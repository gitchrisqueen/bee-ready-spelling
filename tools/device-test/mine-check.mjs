// "My words" in a phone-sized browser: default mode stays untouched, ?mode=mine works by touch, nothing leaves the
// device until a grown-up confirms "Look up the missing words", and then only to the two Wiktionary hosts (answered
// here from recorded fixtures, so the check needs no network). A child's own words are never requested from this
// site's host as clip file names. This is emulation, not a physical device.
//   BASE=http://localhost:8080/ node mine-check.mjs       (serve the built _site/ first)
//   ENGINE=chromium node mine-check.mjs                    (when WebKit cannot start on this machine)
import { readFileSync } from 'node:fs';
import { chromium, devices, webkit } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080/';
const ALLOWED = new Set(['simple.wiktionary.org', 'en.wiktionary.org']);
const fixtures = JSON.parse(readFileSync(new URL('../../tests/fixtures/wiktionary-extracts.json', import.meta.url), 'utf8'));
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
const contextFor = (preset, extra = {}) => {
  const d = devices[preset];
  return engine === 'WebKit' ? browser.newContext({ ...d, ...extra }) : browser.newContext({
    viewport: d.viewport, userAgent: d.userAgent, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true, ...extra,
  });
};
const wikiAnswer = (host, url) => {
  const word = new URL(url).searchParams.get('titles');
  const text = fixtures[word]?.[host.startsWith('simple') ? 'simple' : 'en'];
  const page = text ? { title: word, extract: text } : { title: word, missing: true };
  return {
    status: 200, contentType: 'application/json', body: JSON.stringify({ query: { pages: [page] } }),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
  };
};
const routeWiki = ctx => Promise.all([...ALLOWED].map(host =>
  ctx.route(`https://${host}/**`, route => route.fulfill(wikiAnswer(host, route.request().url())))));
// The voice notice can cover buttons while a voice is being prepared; dismiss it like a child would, then tap.
async function tap(page, selector) {
  if (await page.isVisible('#voiceDownload')) await page.tap('#closeNotice');
  await page.tap(selector);
}
const tabbable = page => page.evaluate(() => document.activeElement && document.activeElement.tagName !== 'BODY');
const statusOf = page => page.evaluate(() => document.getElementById('mineStatus').textContent);

for (const preset of ['iPhone SE', 'iPad (gen 7)']) {
  console.log(`\n== ${preset} (${engine} emulation)`);
  const ctx = await contextFor(preset);
  const page = await ctx.newPage();
  const external = [], own = [], errors = [];
  let dialogs = 0, answer = 'accept';
  page.on('pageerror', e => errors.push(String(e).slice(0, 140)));
  page.on('dialog', d => { dialogs++; return answer === 'accept' ? d.accept() : d.dismiss(); });
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin) own.push(u.pathname);
    else if (!['blob:', 'data:'].includes(u.protocol)) external.push(u.host);
  });
  await routeWiki(ctx);
  const keys = () => page.evaluate(() => Object.keys(localStorage).sort());

  // ---- default mode is untouched
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const mineRequests = own.filter(p => /\/mine\/|\/library\//.test(p));
  check('default: only mine/config.js is requested from mine/, and nothing from the library',
    mineRequests.length === 1 && mineRequests[0].endsWith('/mine/config.js'), mineRequests.join());
  check('default: My words panel is hidden', await page.evaluate(() => document.getElementById('mineRoot').hidden));
  check('default: no third-party request', external.length === 0, external.join());
  check('default: the Grown-ups tab offers the entry link',
    await page.evaluate(() => !document.getElementById('mineGrownups').hidden));
  check('default: Study and Challenge are still offered',
    await page.evaluate(() => !!document.querySelector('#pool option[value="study"]')));

  // ---- mine mode: nothing is sent before a grown-up confirms
  external.length = 0;
  await page.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  check('mine: panel is shown', await page.evaluate(() => !document.getElementById('mineRoot').hidden));
  check('mine: Study and Challenge are gone', await page.evaluate(() => !document.querySelector('#pool option[value="study"]')));
  await page.fill('#mineText', 'abdicate, abide, habit, quay\nzzzxq, qqqzz');
  await page.tap('#mineCheck');
  await page.waitForSelector('#mineChips li');
  const chipText = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#mineChips li')]
    .map(li => [li.querySelector('input').value, li.querySelector('.mine-chip-status').textContent])));
  const text = await chipText();
  check('mine: default-list words are recognised', /Bee Ready list/.test(text.abdicate) && /Bee Ready list/.test(text.abide));
  check('mine: a library word is found', /library/.test(text.habit), text.habit);
  check('mine: other words are not found yet', /Not found/.test(text.quay) && /Not found/.test(text.zzzxq));
  check('mine: each word has its own accessible name',
    await page.evaluate(() => new Set([...document.querySelectorAll('#mineChips .mine-chip-row input')]
      .map(i => i.getAttribute('aria-label'))).size === 6));
  check('mine: nothing was sent before the lookup button', external.length === 0, external.join());
  check('mine: the disclosure is tied to the button', await page.evaluate(() =>
    document.getElementById('mineLookup').getAttribute('aria-describedby') === 'mineDisclosure'
    && /Ask a grown-up/.test(document.getElementById('mineDisclosure').textContent)));

  // removing a chip keeps keyboard focus somewhere useful
  await page.focus('#mineChips li:last-child [data-chip-remove]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('mine: after Remove, focus is not lost', await tabbable(page));
  check('mine: Remove is announced', /^Removed qqqzz/.test(await statusOf(page)), await statusOf(page));

  // a grown-up who says no sends nothing
  answer = 'dismiss';
  await page.tap('#mineLookup');
  await page.waitForTimeout(250);
  check('mine: a dialog asked first, and "no" sent nothing', dialogs >= 1 && external.length === 0, `${dialogs} ${external.join()}`);
  answer = 'accept';
  await page.tap('#mineLookup');
  await page.waitForFunction(() => /looked up/i.test(document.getElementById('mineStatus').textContent), null, { timeout: 15000 });
  check('mine: lookup goes only to the two Wiktionary hosts', external.length > 0 && external.every(h => ALLOWED.has(h)),
    [...new Set(external)].join());
  const t2 = await chipText();
  check('mine: a looked-up word is marked with its source', /Looked up/.test(t2.quay)
    && !!(await page.$('.mine-chip-credit a[href^="https://simple.wiktionary.org/wiki/quay"]')));
  check('mine: a word nobody has stays missing', /Not found/.test(t2.zzzxq));
  await page.tap('#mineSave');
  await page.waitForFunction(() => document.querySelectorAll('#mineWordList li').length === 5);
  const k0 = await keys();
  check('mine: only My words keys are written',
    k0.includes('bee-ready-mine-v1') && !k0.some(k => ['bee-ready-history-v2', 'bee-ready-starred-v1'].includes(k)), k0.join());

  // practice by touch with the custom list; custom words are never requested from this site's host as clips
  own.length = 0;
  await page.tap('[data-count="5"]');
  await page.tap('#startRound');
  await page.waitForSelector('#answerInput:visible');
  for (let i = 0; i < 5; i++) {
    await tap(page, '#hearWord');
    await tap(page, '[data-clue="sentence"]');
    if (i === 0) {
      await tap(page, '[data-clue="origin"]');
      const clue = await page.evaluate(() => document.getElementById('clueResult').innerText);
      check('mine: the origin clue says Origin, not the booklet', /^Origin/i.test(clue) && !/booklet/i.test(clue), clue.slice(0, 60));
      await tap(page, '#starWord');
    }
    await page.locator('#answerInput').pressSequentially('wrong');
    await tap(page, '#answerForm button[type=submit]');
    await page.waitForSelector('#nextWord:visible');
    if (i < 4) { await tap(page, '#nextWord'); await page.waitForSelector('#answerInput:visible'); }
  }
  await page.waitForTimeout(500);
  const clipAsks = own.filter(p => /\/clips\//.test(p));
  check('mine: no clip request carries a custom word', !clipAsks.some(p => /(habit|quay|zzzxq)/.test(p)), clipAsks.join());
  check('mine: the library is asked for letters only, never a whole word',
    own.filter(p => /\/library\//.test(p)).every(p => /\/library\/[a-z]\.json$/.test(p)));
  const k = await keys();
  check('mine: history and stars use their own keys', k.includes('bee-ready-mine-history-v1')
    && k.includes('bee-ready-mine-starred-v1') && !k.includes('bee-ready-history-v2') && !k.includes('bee-ready-starred-v1'), k.join());

  // layout of the My words panel
  await page.evaluate(() => { location.hash = 'practice'; });
  const layout = await page.evaluate(() => {
    const root = document.getElementById('mineRoot');
    const small = [...root.querySelectorAll('button,a,select,summary,.file-btn')]
      .filter(e => e.offsetParent && !e.closest('p') && e.getBoundingClientRect().height < 43.5).map(e => e.id || e.textContent.slice(0, 20));
    const fields = [...root.querySelectorAll('input:not([type=file]),textarea,select')]
      .filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id);
    const tiny = [...root.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.tagName);
    return { small, fields, tiny, overflow: document.scrollingElement.scrollWidth - innerWidth };
  });
  check('mine: every control is at least 44px tall', layout.small.length === 0, layout.small.join());
  check('mine: form fields are at least 16px', layout.fields.length === 0, layout.fields.join());
  check('mine: no text under 12px', layout.tiny.length === 0, layout.tiny.join());
  check('mine: nothing overflows sideways', layout.overflow <= 1, String(layout.overflow));

  // a share link opens in a fresh browser profile, saves nothing until Save, and leaves the address bar clean
  await page.tap('#mineShare');
  await page.waitForFunction(() => document.getElementById('mineShareUrl').value);
  const url = await page.inputValue('#mineShareUrl');
  check('share: the words are in the fragment, not the query',
    url.includes('#w=') && !/[?&]w=/.test(url) && !/habit/.test(new URL(url).search));
  const other = await contextFor(preset);
  await other.route('https://**/*', route => route.abort());
  const p2 = await other.newPage();
  const own2 = [];
  p2.on('request', r => { const u = new URL(r.url()); if (u.origin === new URL(BASE).origin) own2.push(u.pathname); });
  const local = url.replace(/^https?:\/\/[^/]+\//, BASE);
  await p2.goto(local, { waitUntil: 'networkidle' });
  await p2.waitForSelector('#mineChips li');
  check('share: the list opens for review', (await p2.locator('#mineChips li').count()) === 5);
  check('share: nothing is saved until Save', await p2.evaluate(() => !localStorage.getItem('bee-ready-mine-v1')));
  check('share: the words are taken out of the address bar', !/w=/.test(p2.url()) && !/w=/.test(await p2.evaluate(() => location.hash)), p2.url());
  await p2.goto('about:blank');
  await p2.goto(local.replace(/#w=./, '#w=x'), { waitUntil: 'networkidle' });
  check('share: a damaged link is refused with a message', /looks damaged/.test(await statusOf(p2)));
  await other.close();

  // the safety list fails to load: nothing is read or written, and the saved lists survive
  const locked = await contextFor(preset);
  await locked.addInitScript(seed => { if (!localStorage.getItem('bee-ready-mine-v1')) localStorage.setItem('bee-ready-mine-v1', seed); },
    JSON.stringify({ version: 1, nextId: 1000001, active: 'l-1',
      lists: [{ key: 'l-1', name: 'Week 1', entries: [{ id: 1000000, word: 'apple', src: 'manual' }] }] }));
  await locked.route('**/mine/filter.sha256', route => route.abort());
  const p3 = await locked.newPage();
  await p3.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(300);
  check('locked: a message says My words is off', /safety list could not load/.test(await statusOf(p3)));
  check('locked: the controls are disabled', await p3.evaluate(() => document.getElementById('mineCheck').disabled
    && document.getElementById('mineNew').disabled && document.getElementById('mineDeleteAll').disabled));
  check('locked: the saved lists are untouched', await p3.evaluate(() =>
    JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists[0].entries[0].word === 'apple'
    && !Object.keys(localStorage).some(x => x.includes('.bak.'))));
  await locked.close();

  // a poisoned lookup cache cannot plant a link or break the screen
  const poisoned = await contextFor(preset);
  await poisoned.addInitScript(seed => localStorage.setItem('bee-ready-mine-lookup-v1', seed), JSON.stringify({
    zzzxq: { definition: 'A made-up word.', credit: ['evil.example', 'simple.wiktionary.org'] }, qqqzz: { credit: { length: 1 } },
  }));
  await routeWiki(poisoned);
  const p4 = await poisoned.newPage();
  const errors4 = [];
  p4.on('pageerror', e => errors4.push(String(e).slice(0, 100)));
  p4.on('dialog', d => d.accept());
  await p4.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  await p4.fill('#mineText', 'zzzxq qqqzz');
  await p4.tap('#mineCheck');
  await p4.waitForSelector('#mineChips li');
  await p4.tap('#mineLookup');
  await p4.waitForFunction(() => /looked up/i.test(document.getElementById('mineStatus').textContent), null, { timeout: 15000 });
  check('cache: no link to a host outside the two allowed ones',
    !(await p4.$('#mineChips a[href*="evil.example"]')) && (await p4.$$eval('#mineChips a', as => as.every(a => /^https:\/\/(simple|en)\.wiktionary\.org\//.test(a.href)))));
  check('cache: the screen did not break', errors4.length === 0, errors4.join());
  await poisoned.close();

  // My words fails to load: the page says so and stays the main list
  const broken = await contextFor(preset);
  await broken.route('**/mine/ui.js', route => route.abort());
  const p5 = await broken.newPage();
  await p5.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  check('failed load: a visible message says this is the main list', await p5.evaluate(() =>
    /My words could not load/.test(document.getElementById('roundBuilder').textContent)));
  check('failed load: the My words panel stays hidden', await p5.evaluate(() => document.getElementById('mineRoot').hidden));
  await broken.close();

  // delete everything
  await page.evaluate(() => { location.hash = 'grownups'; });
  await page.tap('#mineDeleteAll');
  await page.waitForTimeout(300);
  const left = await keys();
  check('mine: "Delete all" leaves no My words key', !left.some(x => x.startsWith('bee-ready-mine-')), left.join());
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(`\n${engine} emulation, not a physical device. ${failures.length ? `${failures.length} check(s) failed.` : 'All checks passed.'}`);
process.exit(failures.length ? 1 : 0);
