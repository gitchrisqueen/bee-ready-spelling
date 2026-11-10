// "My words" in a phone-sized browser: default mode stays untouched, ?mode=mine works by touch, nothing leaves the
// device until "Look up the missing words" is pressed, and then only to the two Wiktionary hosts (answered here from
// recorded fixtures, so the check needs no network). This is emulation, not a physical device.
//   BASE=http://localhost:8080/ node mine-check.mjs       (serve the built _site/ first)
//   ENGINE=chromium node mine-check.mjs                    (when WebKit cannot start on this machine)
import { readFileSync } from 'node:fs';
import { chromium, devices, webkit } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080/';
const ALLOWED = new Set(['simple.wiktionary.org', 'en.wiktionary.org']);
const fixtures = JSON.parse(readFileSync(new URL('../../tests/fixtures/wiktionary-extracts.json', import.meta.url), 'utf8'));
const failures = [];
const check = (name, ok, detail = '') => { if (!ok) failures.push(`${name} ${detail}`); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); };

async function launch() {
  const wanted = process.env.ENGINE || 'webkit';
  if (wanted === 'webkit') {
    try { return { browser: await webkit.launch(), engine: 'WebKit' }; } catch (e) { console.log(`WebKit did not start (${String(e).split('\n')[0].slice(0, 80)}); using Chromium.`); }
  }
  return { browser: await chromium.launch(), engine: 'Chromium' };
}
const { browser, engine } = await launch();
const contextFor = (preset, engineName) => {
  const d = devices[preset];
  return engineName === 'WebKit' ? browser.newContext({ ...d })
    : browser.newContext({ viewport: d.viewport, userAgent: d.userAgent, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true });
};
const WIKI = (host, url) => {
  const word = new URL(url).searchParams.get('titles');
  const text = fixtures[word]?.[host.startsWith('simple') ? 'simple' : 'en'];
  const body = text ? { query: { pages: [{ title: word, extract: text }] } } : { query: { pages: [{ title: word, missing: true }] } };
  return { status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) };
};

for (const preset of ['iPhone SE', 'iPad (gen 7)']) {
  console.log(`\n== ${preset} (${engine} emulation)`);
  const ctx = await contextFor(preset, engine);
  const page = await ctx.newPage();
  const external = [], own = [], errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 140)));
  page.on('dialog', d => d.accept());
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin) own.push(u.pathname); else if (!['blob:', 'data:'].includes(u.protocol)) external.push(u.host);
  });
  for (const host of ALLOWED) await ctx.route(`https://${host}/**`, route => route.fulfill(WIKI(host, route.request().url())));
  const keys = () => page.evaluate(() => Object.keys(localStorage).sort());

  // ---- default mode is untouched
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('default: no request to mine/ui.js or the library', !own.some(p => /mine\/(ui|lists|lookup)|library\//.test(p)), own.filter(p => /mine|library/.test(p)).join());
  check('default: My words panel is hidden', await page.evaluate(() => document.getElementById('mineRoot').hidden));
  check('default: no third-party request', external.length === 0, external.join());
  check('default: the Grown-ups tab offers the entry link', await page.evaluate(() => !document.getElementById('mineGrownups').hidden));
  check('default: Study and Challenge are still offered', await page.evaluate(() => !!document.querySelector('#pool option[value="study"]')));

  // ---- mine mode
  external.length = 0;
  await page.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  check('mine: panel is shown', await page.evaluate(() => !document.getElementById('mineRoot').hidden));
  check('mine: Study and Challenge are gone', await page.evaluate(() => !document.querySelector('#pool option[value="study"]')));
  await page.fill('#mineText', 'abdicate, abide, habit, quay\nzzzxq');
  await page.tap('#mineCheck');
  await page.waitForSelector('#mineChips li');
  const statuses = await page.evaluate(() => [...document.querySelectorAll('#mineChips li')].map(li => [li.querySelector('input').value, li.querySelector('.mine-chip-status').textContent]));
  const text = Object.fromEntries(statuses);
  check('mine: default-list words are recognised', /Bee Ready list/.test(text.abdicate) && /Bee Ready list/.test(text.abide), JSON.stringify(text));
  check('mine: a library word is found', /library/.test(text.habit), text.habit);
  check('mine: other words are not found yet', /Not found/.test(text.quay) && /Not found/.test(text.zzzxq));
  check('mine: nothing was sent before the lookup button', external.length === 0, external.join());
  check('mine: the disclosure is next to the button', await page.evaluate(() => document.getElementById('mineLookup').getAttribute('aria-describedby') === 'mineDisclosure' && !document.getElementById('mineDisclosure').hidden));
  await page.tap('#mineLookup');
  await page.waitForFunction(() => /looked up/i.test(document.getElementById('mineStatus').textContent), null, { timeout: 15000 });
  check('mine: lookup goes only to the two Wiktionary hosts', external.length > 0 && external.every(h => ALLOWED.has(h)), [...new Set(external)].join());
  const after = await page.evaluate(() => [...document.querySelectorAll('#mineChips li')].map(li => [li.querySelector('input').value, li.querySelector('.mine-chip-status').textContent]));
  const t2 = Object.fromEntries(after);
  check('mine: a looked-up word is marked with its source', /Looked up/.test(t2.quay) && !!(await page.$('.mine-chip-credit a[href^="https://simple.wiktionary.org/wiki/quay"]')));
  check('mine: a word nobody has stays missing', /Not found/.test(t2.zzzxq));
  await page.tap('#mineSave');
  await page.waitForFunction(() => document.querySelectorAll('#mineWordList li').length === 5);
  check('mine: the list was saved with five words', true);
  check('mine: only My words keys are written', JSON.stringify(await keys()).includes('bee-ready-mine-v1') && !(await keys()).some(k => ['bee-ready-history-v2', 'bee-ready-starred-v1'].includes(k)), (await keys()).join());

  // practice by touch with the custom list
  await page.tap('[data-count="5"]');
  await page.tap('#startRound');
  await page.waitForSelector('#answerInput:visible');
  await page.tap('[data-clue="origin"]');
  const clue = await page.evaluate(() => document.getElementById('clueResult').innerText);
  check('mine: the origin clue says Origin, not the booklet', /^Origin/i.test(clue) && !/booklet/i.test(clue), clue.slice(0, 60));
  await page.tap('#starWord');
  await page.locator('#answerInput').pressSequentially('wrong');
  await page.tap('#answerForm button[type=submit]');
  await page.waitForSelector('#nextWord:visible');
  const k = await keys();
  check('mine: history and stars use their own keys', k.includes('bee-ready-mine-history-v1') && k.includes('bee-ready-mine-starred-v1') && !k.includes('bee-ready-history-v2') && !k.includes('bee-ready-starred-v1'), k.join());

  // layout of the My words panel
  await page.evaluate(() => { location.hash = 'practice'; });
  const layout = await page.evaluate(() => {
    const root = document.getElementById('mineRoot');
    const small = [...root.querySelectorAll('button,a,select,summary,.file-btn')].filter(e => e.offsetParent && !e.closest('p') && e.getBoundingClientRect().height < 43.5).map(e => e.id || e.textContent.slice(0, 20));
    const fields = [...root.querySelectorAll('input:not([type=file]),textarea,select')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id);
    const tiny = [...root.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.tagName);
    return { small, fields, tiny, overflow: document.scrollingElement.scrollWidth - innerWidth };
  });
  check('mine: every control is at least 44px tall', layout.small.length === 0, layout.small.join());
  check('mine: form fields are at least 16px', layout.fields.length === 0, layout.fields.join());
  check('mine: no text under 12px', layout.tiny.length === 0, layout.tiny.join());
  check('mine: nothing overflows sideways', layout.overflow <= 1, String(layout.overflow));

  // a share link opens in a fresh browser profile and saves nothing until Save
  await page.tap('#mineShare');
  await page.waitForFunction(() => document.getElementById('mineShareUrl').value);
  const url = await page.inputValue('#mineShareUrl');
  check('share: the words are in the fragment, not the query', url.includes('#w=') && !/[?&]w=/.test(url) && !/habit/.test(new URL(url).search));
  const other = await contextFor(preset, engine);
  await other.route('https://**/*', route => route.abort());
  const p2 = await other.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(String(e).slice(0, 100)));
  await p2.goto(url.replace(/^https?:\/\/[^/]+\//, BASE), { waitUntil: 'networkidle' });
  await p2.waitForSelector('#mineChips li');
  check('share: the list opens for review', (await p2.locator('#mineChips li').count()) === 5);
  check('share: nothing is saved until Save', await p2.evaluate(() => !localStorage.getItem('bee-ready-mine-v1')));
  await p2.goto('about:blank');
  await p2.goto(url.replace(/^https?:\/\/[^/]+\//, BASE).replace(/#w=./, '#w=x'), { waitUntil: 'networkidle' });
  check('share: a damaged link is refused with a message', await p2.evaluate(() => /looks damaged/.test(document.getElementById('mineStatus').textContent)));
  await other.close();

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
