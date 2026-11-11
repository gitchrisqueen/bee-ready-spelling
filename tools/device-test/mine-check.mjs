// "My words" in a phone-sized browser: default mode stays untouched, ?mode=mine works by touch, nothing leaves the
// device until a grown-up confirms "Look up the missing words", and then only to the two Wiktionary hosts (answered
// here from recorded fixtures, so the check needs no network). A child's own words are never requested from this
// site's host as clip file names. This is emulation, not a physical device.
//   BASE=http://localhost:8080/ node mine-check.mjs       (serve the built _site/ first)
//   ENGINE=chromium node mine-check.mjs                    (when WebKit cannot start on this machine)
import { readFileSync, readdirSync } from 'node:fs';
import { chromium, devices, webkit } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080/';
const ALLOWED = new Set(['simple.wiktionary.org', 'en.wiktionary.org']);
const fixtures = JSON.parse(readFileSync(new URL('../../tests/fixtures/wiktionary-extracts.json', import.meta.url), 'utf8')); // preflight: ok
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
    viewport: d.viewport, userAgent: d.userAgent, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true, ...extra, // preflight: ok
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
// The message shows in the live region of the tab the person is on; the other one is empty.
const statusOf = page => page.evaluate(() => ['mineStatus', 'minePracticeStatus']
  .map(id => document.getElementById(id).textContent).join(''));
const goTo = (page, tab) => tap(page, `[data-tab=${tab}]`);

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
  check('default: the My words panels are hidden', await page.evaluate(() =>
    ['mineRoot', 'mineBank', 'mineAdd'].every(id => document.getElementById(id).hidden)));
  await goTo(page, 'words');
  await page.waitForSelector('#wordGrid .word-card');
  check('default: the Word bank shows its cards, with no Remove button and no gate', await page.evaluate(() =>
    document.getElementById('wordGrid').checkVisibility() && !document.querySelector('.remove-btn')
    && !document.getElementById('mineBankGate') && !document.getElementById('mineWordsHead').checkVisibility()));
  check('default: no third-party request', external.length === 0, external.join());
  check('default: the Grown-ups tab offers the entry link',
    await page.evaluate(() => !document.getElementById('mineGrownups').hidden));
  check('default: Study and Challenge are still offered',
    await page.evaluate(() => !!document.querySelector('#pool option[value="study"]')));

  // ---- mine mode: nothing is sent before a grown-up confirms
  external.length = 0;
  await page.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  check('mine: panel is shown', await page.evaluate(() => !document.getElementById('mineRoot').hidden));
  check('mine: Study and Challenge are gone', await page.evaluate(() => !document.querySelector('#pool option[value="study"]'))); // preflight: ok
  // Practice holds no editor: with no words yet it points to the Word bank, where the lists and Add words live.
  const empty = await page.evaluate(() => ({
    title: document.getElementById('minePracticeTitle').textContent,
    add: document.getElementById('minePracticeAdd').checkVisibility(),
    change: document.getElementById('minePracticeChange').checkVisibility(),
    editor: ['mineText', 'mineCheck', 'mineList', 'mineShare'].some(id => document.getElementById(id).checkVisibility()), // preflight: ok
    start: document.getElementById('startRound').disabled,
  }));
  check('mine: Practice has no editor, and with no words it offers "Add my words"',
    empty.add && !empty.change && !empty.editor && empty.start && /Add your words/.test(empty.title), JSON.stringify(empty)); // preflight: ok
  await tap(page, '#minePracticeAdd');
  await page.waitForSelector('#mineText:visible');
  check('mine: "Add my words" opens the Word bank, with the lists and Add words on it', await page.evaluate(() =>
    document.getElementById('tab-words').classList.contains('active')
    && ['mineBank', 'mineAdd', 'mineList', 'mineText', 'mineCheck'].every(id => document.getElementById(id).checkVisibility()))); // preflight: ok
  await page.fill('#mineText', 'abdicate, abide, habit, quay\nzzzxq, qqqzz');
  await page.tap('#mineCheck');
  await page.waitForSelector('#mineChips li');
  const chipText = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#mineChips li')]
    .map(li => [li.querySelector('input').value, li.querySelector('.mine-chip-status').textContent])));
  const text = await chipText();
  check('mine: default-list words are recognised', /Bee Ready list/.test(text.abdicate) && /Bee Ready list/.test(text.abide)); // preflight: ok
  check('mine: a library word is found', /library/.test(text.habit), text.habit);
  check('mine: other words are not found yet', /Not found/.test(text.quay) && /Not found/.test(text.zzzxq));
  check('mine: each word has its own accessible name',
    await page.evaluate(() => new Set([...document.querySelectorAll('#mineChips .mine-chip-row input')]
      .map(i => i.getAttribute('aria-label'))).size === 6));
  check('mine: nothing was sent before the lookup button', external.length === 0, external.join());
  check('mine: the disclosure is tied to the button', await page.evaluate(() =>
    document.getElementById('mineLookup').getAttribute('aria-describedby') === 'mineDisclosure'
    && /Ask a grown-up/.test(document.getElementById('mineDisclosure').textContent)));

  // leaving an edited word backwards lands on the previous chip's Edit summary and stays there
  const lastWord = '#mineChips li:last-child .mine-chip-row input';
  await page.focus(lastWord);
  await page.fill(lastWord, 'qqqzx');
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(500);
  check('mine: after editing a word and pressing Shift+Tab, focus stays on the previous chip\'s Edit summary',
    await page.evaluate(() => document.activeElement.matches('#mineChips li:nth-last-child(2) summary')));
  // editing a word and pressing Tab keeps focus on that chip; Remove keeps it somewhere useful
  const lastInput = '#mineChips li:last-child .mine-chip-row input';
  await page.focus(lastInput);
  await page.fill(lastInput, 'qqqzy');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  check('mine: after editing a word and pressing Tab, focus is on that word\'s Remove button',
    await page.evaluate(() => document.activeElement.matches('#mineChips li:last-child [data-chip-remove]')));
  check('mine: the edit is announced', /^qqqzy: /.test(await statusOf(page)), await statusOf(page));
  await page.focus('#mineChips li:last-child [data-chip-remove]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('mine: after Remove, focus is not lost', await tabbable(page));
  check('mine: Remove is announced', /^Removed qqqzy/.test(await statusOf(page)), await statusOf(page));

  // a grown-up who says no sends nothing
  answer = 'dismiss';
  await page.tap('#mineLookup');
  await page.waitForTimeout(250);
  check('mine: a dialog asked first, and "no" sent nothing', dialogs >= 1 && external.length === 0, `${dialogs} ${external.join()}`); // preflight: ok
  answer = 'accept';
  await page.tap('#mineLookup');
  await page.waitForFunction(() => /looked up/i.test(document.getElementById('mineStatus').textContent), null, { timeout: 15000 }); // preflight: ok
  check('mine: lookup goes only to the two Wiktionary hosts', external.length > 0 && external.every(h => ALLOWED.has(h)), // preflight: ok
    [...new Set(external)].join());
  const t2 = await chipText();
  check('mine: a looked-up word is marked with its source', /Looked up/.test(t2.quay)
    && !!(await page.$('.mine-chip-credit a[href^="https://simple.wiktionary.org/wiki/quay"]')));
  check('mine: a word nobody has stays missing', /Not found/.test(t2.zzzxq));
  await page.tap('#mineSave');
  await page.waitForFunction(() => document.querySelectorAll('#wordGrid .word-card').length === 5);
  const bank = await page.evaluate(() => ({
    grid: document.getElementById('wordGrid').checkVisibility(),
    removes: document.querySelectorAll('#wordGrid .remove-btn').length,
    head: document.getElementById('mineWordsHead').textContent,
    focus: document.activeElement.id,
    gate: !!document.getElementById('mineBankGate'),
  }));
  check('mine: after Save the words are in the open Word bank, each with Remove, and focus is on the list heading',
    bank.grid && bank.removes === 5 && !bank.gate && /: 5 words$/.test(bank.head) && bank.focus === 'mineWordsHead', JSON.stringify(bank)); // preflight: ok
  const k0 = await keys();
  check('mine: only My words keys are written',
    k0.includes('bee-ready-mine-v1') && !k0.some(k => ['bee-ready-history-v2', 'bee-ready-starred-v1'].includes(k)), k0.join()); // preflight: ok

  // practice by touch with the custom list; custom words are never requested from this site's host as clips
  own.length = 0;
  await goTo(page, 'practice');
  const practiceInfo = await page.evaluate(() => ({
    title: document.getElementById('minePracticeTitle').textContent,
    text: document.getElementById('minePracticeText').textContent,
    change: document.getElementById('minePracticeChange').checkVisibility(),
    add: document.getElementById('minePracticeAdd').checkVisibility(),
  }));
  check('mine: Practice names the list in use and links to the Word bank to change it',
    /^Practicing: My words$/.test(practiceInfo.title) && /^5 words in this list/.test(practiceInfo.text)
    && practiceInfo.change && !practiceInfo.add, JSON.stringify(practiceInfo));
  await page.tap('[data-count="5"]');
  await page.tap('#startRound');
  await page.waitForSelector('#answerInput:visible');
  for (let i = 0; i < 5; i++) {
    await tap(page, '#hearWord');
    await tap(page, '[data-clue="sentence"]');
    if (i === 0) {
      await tap(page, '[data-clue="origin"]');
      const clue = await page.evaluate(() => document.getElementById('clueResult').innerText);
      check('mine: the origin clue says Origin, not the booklet', /^Origin/i.test(clue) && !/booklet/i.test(clue), clue.slice(0, 60)); // preflight: ok
      await tap(page, '#starWord');
    }
    await page.locator('#answerInput').pressSequentially('wrong');
    await tap(page, '#answerForm button[type=submit]');
    await page.waitForSelector('#nextWord:visible');
    if (i < 4) { await tap(page, '#nextWord'); await page.waitForSelector('#answerInput:visible'); }
  }
  await page.waitForTimeout(500);
  const clipAsks = own.filter(p => /\/clips\//.test(p));
  check('mine: no clip request carries a custom word', !clipAsks.some(p => /(habit|quay|zzzxq)/.test(p)), clipAsks.join()); // preflight: ok
  check('mine: the library is asked for letters only, never a whole word',
    own.filter(p => /\/library\//.test(p)).every(p => /\/library\/[a-z]\.json$/.test(p)));
  const k = await keys();
  check('mine: history and stars use their own keys', k.includes('bee-ready-mine-history-v1')
    && k.includes('bee-ready-mine-starred-v1') && !k.includes('bee-ready-history-v2') && !k.includes('bee-ready-starred-v1'), k.join()); // preflight: ok

  // layout of the My words controls on both tabs: the list in use on Practice, the lists and words in the Word bank
  for (const [tab, scope] of [['practice', '#mineRoot'], ['words', '#tab-words']]) {
    await page.evaluate(t => { location.hash = t; }, tab);
    await page.waitForFunction(t => document.getElementById(`tab-${t}`).classList.contains('active'), tab);
    const layout = await page.evaluate(sel => {
      const root = document.querySelector(sel);
      const small = [...root.querySelectorAll('button,a,select,summary,.file-btn')]
        .filter(e => e.offsetParent && !e.closest('p') && e.getBoundingClientRect().height < 43.5).map(e => e.id || e.textContent.slice(0, 20)); // preflight: ok
      const fields = [...root.querySelectorAll('input:not([type=file]),textarea,select')]
        .filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id);
      const tiny = [...root.querySelectorAll('*')]
        .filter(e => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.tagName); // preflight: ok
      return { small, fields, tiny, overflow: document.scrollingElement.scrollWidth - innerWidth };
    }, scope);
    check(`mine (${tab}): every control is at least 44px tall`, layout.small.length === 0, layout.small.join());
    check(`mine (${tab}): form fields are at least 16px`, layout.fields.length === 0, layout.fields.join());
    check(`mine (${tab}): no text under 12px`, layout.tiny.length === 0, layout.tiny.join());
    check(`mine (${tab}): nothing overflows sideways`, layout.overflow <= 1, String(layout.overflow));
  }

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
  await p2.waitForSelector('#mineLinkCard:not([hidden])');
  const seen2 = await p2.evaluate(() => ({
    start: document.getElementById('mineLinkStart').checkVisibility(),
    chips: document.getElementById('mineChips').checkVisibility(),
    editor: document.getElementById('mineText').checkVisibility(),
    builder: document.getElementById('roundBuilder').checkVisibility(),
    text: document.body.innerText,
  }));
  check('share: the speller sees a start button and none of the words',
    seen2.start && !seen2.chips && !seen2.editor && !seen2.builder && !/\b(habit|quay|abide|abdicate)\b/.test(seen2.text), // preflight: ok
    JSON.stringify({ ...seen2, text: '' }));
  // The Word bank stays usable while the link waits, but has no second way to add words, and does not show the link's.
  await goTo(p2, 'words');
  const wait2 = await p2.evaluate(() => ({
    note: document.getElementById('mineLinkWait').checkVisibility(),
    lists: document.getElementById('mineBank').checkVisibility(),
    text: document.getElementById('mineText').checkVisibility(),
    check: document.getElementById('mineCheck').checkVisibility(),
    photo: document.getElementById('minePhotoBlock').checkVisibility(),
    words: /\b(habit|quay|abide|abdicate)\b/.test(document.getElementById('tab-words').innerText),
  }));
  check('share: while a link waits, the Word bank keeps its lists, drops Add words for a note, and shows none of the link\'s words', // preflight: ok
    wait2.note && wait2.lists && !wait2.text && !wait2.check && !wait2.photo && !wait2.words, JSON.stringify(wait2));
  await tap(p2, '#mineLinkWait [data-go=practice]');
  await p2.waitForSelector('#mineLinkCard:not([hidden])');
  await p2.tap('#mineLinkGrownups summary');
  await p2.waitForSelector('#mineChips li');
  check('share: a grown-up can open the words to check them', (await p2.locator('#mineChips li').count()) === 5);
  check('share: nothing is saved until Start or Save',
    await p2.evaluate(() => !localStorage.getItem('bee-ready-mine-v1')));
  check('share: the words are taken out of the address bar', !/w=/.test(p2.url()) && !/w=/.test(await p2.evaluate(() => location.hash)), p2.url()); // preflight: ok
  await p2.tap('#mineLinkStart');
  await p2.waitForSelector('#roundArea:not(.hidden)');
  const after2 = await p2.evaluate(() => ({
    lists: JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists.map(l => l.name + ':' + l.entries.length),
    count: document.getElementById('roundNumber').textContent,
    card: document.getElementById('mineLinkCard').checkVisibility(),
    review: document.getElementById('mineReview').parentElement.id,
  }));
  check('share: Start my spelling bee saves the list under its own name and starts a round',
    after2.lists.join() === 'Shared list:5' && /OF 5/.test(after2.count) && !after2.card, JSON.stringify(after2));
  check('share: the review block goes back to Add words in the Word bank', after2.review === 'mineAdd', after2.review);
  await p2.tap('[data-clue=definition]');
  const clue2 = await p2.locator('#clueResult').innerText();
  check('share: the Definition clue does not show the word itself',
    clue2.length > 12 && !/\b(habit|quay|abide|abdicate|zzzxq)\b/i.test(clue2), clue2);
  await goTo(p2, 'words');
  await p2.waitForSelector('#wordGrid .word-card');
  const bank2 = await p2.evaluate(() => ({
    gate: !!document.getElementById('mineBankGate'), grid: document.getElementById('wordGrid').checkVisibility(),
    text: document.getElementById('tab-words').innerText, removes: document.querySelectorAll('#wordGrid .remove-btn').length, // preflight: ok
    wait: document.getElementById('mineLinkWait').checkVisibility(), add: document.getElementById('mineText').checkVisibility(), // preflight: ok
  }));
  check('share: the Word bank is always open: the saved words are listed, each with Remove, and Add words is back',
    !bank2.gate && bank2.grid && bank2.removes === 5 && /\b(habit|quay|abide)\b/.test(bank2.text) && !bank2.wait && bank2.add, // preflight: ok
    JSON.stringify({ ...bank2, text: '' }));
  const meta2 = await p2.$$eval('#wordGrid .word-meta', els => els.map(e => e.textContent));
  check('share: word cards show no "Mine" or "word" tag',
    meta2.length > 0 && meta2.every(t => !/\bMine\b|(^|· )word$/.test(t)), meta2.join(' | '));
  // Remove on a card takes the word out of the list, says so, and keeps focus on a Remove button
  // it asks first: "no" keeps the word
  p2.removeAllListeners('dialog');
  let ask2 = '';
  p2.on('dialog', d => { ask2 = d.message(); return d.dismiss(); });
  await p2.tap('#wordGrid .word-card:first-child .remove-btn');
  await p2.waitForTimeout(250);
  check('share: Remove asks first, and "no" keeps the word', /^Take ".+" out of "Shared list"\?/.test(ask2)
    && (await p2.locator('#wordGrid .word-card').count()) === 5, ask2);
  p2.removeAllListeners('dialog');
  p2.on('dialog', d => d.accept());
  await p2.tap('#wordGrid .word-card:first-child .remove-btn');
  await p2.waitForFunction(() => document.querySelectorAll('#wordGrid .word-card').length === 4);
  const removed2 = await p2.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists[0].entries.length,
    focus: document.activeElement.matches('#wordGrid .remove-btn'),
    head: document.getElementById('mineWordsHead').textContent,
  }));
  check('share: Remove on a card saves the shorter list, announces it, and focus stays on a Remove button',
    removed2.saved === 4 && removed2.focus && /: 4 words$/.test(removed2.head) && /^Removed .+ from the list\./.test(await statusOf(p2)), // preflight: ok
    JSON.stringify(removed2));
  // the origin filter survives a Remove: add two more words that share an origin, filter to it, remove one
  const pair = await p2.evaluate(async () => {
    const all = await (await fetch('./words.json')).json();
    const have = new Set([...document.querySelectorAll('#wordGrid h3')].map(h => h.textContent.toLowerCase()));
    const by = {};
    for (const w of all) if (!have.has(w.word.toLowerCase())) (by[w.group] ??= []).push(w.word);
    const group = Object.keys(by).find(g => by[g].length >= 2);
    return { group, words: by[group].slice(0, 2) };
  });
  await p2.fill('#mineText', pair.words.join(' '));
  await p2.tap('#mineCheck');
  await p2.waitForSelector('#mineChips li');
  await p2.tap('#mineSave');
  await p2.waitForFunction(g => [...document.querySelectorAll('#groupFilter option')].some(o => o.value === g), pair.group); // preflight: ok
  await p2.selectOption('#groupFilter', pair.group);
  const before = await p2.locator('#wordGrid .word-card').count();
  await p2.tap('#wordGrid .word-card:first-child .remove-btn');
  await p2.waitForFunction(n => document.querySelectorAll('#wordGrid .word-card').length === n - 1, before);
  check('share: after Remove the origin filter is still chosen and its other words are still listed',
    await p2.evaluate(g => document.getElementById('groupFilter').value === g, pair.group) && before >= 2, `${pair.group} ${before}`); // preflight: ok
  // a device that cannot save: the message stays, "Removed" is not claimed
  await p2.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('full'); }; });
  await p2.selectOption('#groupFilter', 'all');
  await p2.tap('#wordGrid .word-card:first-child .remove-btn');
  await p2.waitForTimeout(300);
  const failed2 = await statusOf(p2);
  check('share: if the list cannot be saved, the message says so and does not say Removed',
    /could not save/.test(failed2) && !/Removed/.test(failed2), failed2);
  await p2.goto('about:blank');
  await p2.goto(local.replace(/#w=./, '#w=x'), { waitUntil: 'networkidle' });
  check('share: a damaged link is refused with a message', /looks damaged/.test(await statusOf(p2)));
  await other.close();

  // a link carries only the words, so a saved word with no definition can be looked up again, after a yes
  const watch = async ctxFor => {
    const pg = await ctxFor.newPage();
    const w = { ext: [], asks: 0, answer: 'dismiss' };
    pg.on('request', r => {
      const u = new URL(r.url());
      if (u.origin !== new URL(BASE).origin && !['blob:', 'data:'].includes(u.protocol)) w.ext.push(u.host);
    });
    pg.on('dialog', d => { w.asks++; return w.answer === 'accept' ? d.accept() : d.dismiss(); });
    await pg.goto(local, { waitUntil: 'networkidle' });
    await pg.waitForSelector('#mineLinkCard:not([hidden])');
    await pg.tap('#mineLinkStart');
    await pg.waitForSelector('#roundArea:not(.hidden)');
    await goTo(pg, 'words');
    return { pg, w };
  };
  const fillResult = pg => pg.evaluate(() => document.getElementById('mineFillResult').textContent.replace(/\u00a0/g, '')); // preflight: ok
  const fresh = await contextFor(preset);
  await routeWiki(fresh);
  const { pg: p9, w: w9 } = await watch(fresh);
  const fill9 = await p9.evaluate(() => ({
    shown: document.getElementById('mineFillBlock').checkVisibility(),
    text: document.getElementById('mineFillText').textContent,
    name: document.getElementById('mineFill').textContent,
  }));
  check('fill: words with no definition offer "Get missing definitions", say how many, and say what to press',
    fill9.shown && /^2 words have no definition yet\./.test(fill9.text) && /Press Get missing definitions/.test(fill9.text) // preflight: ok
    && fill9.name === 'Get missing definitions', JSON.stringify(fill9));
  // the first press asks, "no" sends nothing, and the result is on the screen beside the button
  await p9.tap('#mineFill');
  await p9.waitForFunction(() => /Nothing was sent to Wiktionary/.test(document.getElementById('mineFillResult').textContent)); // preflight: ok
  const shown9 = await p9.evaluate(() => {
    const r = document.getElementById('mineFillResult').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: innerHeight };
  });
  check('fill: "no" sends nothing to Wiktionary, and the result is on the screen beside the button',
    w9.asks === 1 && w9.ext.length === 0 && shown9.top >= 0 && shown9.bottom <= shown9.h, `${w9.asks} ${w9.ext.join()} ${JSON.stringify(shown9)}`); // preflight: ok
  // two quick presses run once and ask once
  await p9.evaluate(() => { const b = document.getElementById('mineFill'); b.click(); b.click(); });
  await p9.waitForTimeout(600);
  check('fill: two quick presses ask once', w9.asks === 2, String(w9.asks));
  // a grown-up who turned lookups off in Grown-ups: the library is checked, the note says where to turn it on, nothing is sent // preflight: ok
  await goTo(p9, 'grownups');
  await p9.uncheck('#mineLive');
  await goTo(p9, 'words');
  w9.answer = 'accept';
  const asksBefore = w9.asks;
  await p9.tap('#mineFill');
  await p9.waitForFunction(() => /turned off/.test(document.getElementById('mineFillResult').textContent));
  check('fill: with lookups turned off it says where to turn them on, asks nothing and sends nothing',
    /Grown-ups tab/.test(await fillResult(p9)) && w9.asks === asksBefore && w9.ext.length === 0, await fillResult(p9));
  await goTo(p9, 'grownups');
  await p9.check('#mineLive');
  await goTo(p9, 'words');
  // the yes: only the two Wiktionary hosts, the dialog says how many words
  let askText = '';
  p9.removeAllListeners('dialog');
  p9.on('dialog', d => { askText = d.message(); w9.asks++; return d.accept(); });
  await p9.tap('#mineFill');
  await p9.waitForFunction(() => /^Found definitions for/.test(document.getElementById('mineFillResult').textContent), null, { timeout: 15000 }); // preflight: ok
  const got9 = await p9.evaluate(() => ({
    text: document.getElementById('mineFillText').textContent,
    quay: [...document.querySelectorAll('#wordGrid .word-card')].find(c => c.querySelector('h3').textContent === 'quay')?.innerText ?? '', // preflight: ok
    focus: document.activeElement.id,
    locked: document.getElementById('mineFill').hasAttribute('aria-disabled'),
    saved: JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists[0].entries.find(e => e.word === 'quay'),
  }));
  check('fill: the dialog says how many words are sent', /^This sends 2 words/.test(askText), askText);
  check('fill: only the two Wiktionary hosts were asked, and after the yes',
    w9.ext.length > 0 && w9.ext.every(h => ALLOWED.has(h)), [...new Set(w9.ext)].join());
  check('fill: the found word now has its definition, saved, with its source; the other still has none',
    /^1 word has no definition yet/.test(got9.text) && !/No definition yet/.test(got9.quay) && !!got9.saved.definition
    && got9.saved.src === 'live' && /^Found definitions for 1 of 2 words\. 1 still has none\./.test(await fillResult(p9)), // preflight: ok
    JSON.stringify(got9).slice(0, 300));
  check('fill: focus returns to the button, which is usable again', got9.focus === 'mineFill' && !got9.locked, got9.focus); // preflight: ok

  // backup: the file holds the definitions; restoring adds the lists and never replaces them
  const labels9 = await p9.evaluate(() => ({
    save: document.getElementById('mineExport').textContent,
    restore: document.getElementById('mineImportFile').parentElement.textContent.trim(),
    share: document.getElementById('mineShare').textContent,
    text: document.getElementById('mineBank').innerText,
  }));
  check('backup: the buttons are named plainly, with what each does written beside them',
    labels9.save === 'Save a backup file' && labels9.restore === 'Restore from a backup file'
    && labels9.share === 'Copy a link to share this list'
    && /A backup is a file with all your lists and their definitions/.test(labels9.text)
    && /never replaces or deletes them/.test(labels9.text) && !/Download a backup|Open a backup/.test(labels9.text)
    && /open the Word bank and press Get missing definitions/.test(labels9.text), JSON.stringify(labels9).slice(0, 200)); // preflight: ok
  const [download] = await Promise.all([p9.waitForEvent('download'), p9.tap('#mineExport')]);
  const file9 = await download.path();
  const backup9 = JSON.parse(readFileSync(file9, 'utf8'));
  check('backup: Save a backup file downloads my-words.json with the definitions in it',
    download.suggestedFilename() === 'my-words.json' && backup9.kind === 'bee-ready-my-words'
    && backup9.lists[0].words.some(w => w.word === 'quay' && w.definition), download.suggestedFilename());
  check('backup: the message says where to look and does not claim the file is saved',
    /Your browser is saving my-words\.json\. Look in your Downloads folder/.test(await statusOf(p9)), await statusOf(p9)); // preflight: ok
  await p9.setInputFiles('#mineImportFile', file9);
  await p9.waitForFunction(() => /^Backup restored/.test(document.getElementById('mineStatus').textContent));
  const rest9 = await p9.evaluate(() => JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists.map(l => `${l.name}:${l.entries.length}`)); // preflight: ok
  check('backup: Restore adds the list next to the one already there, and says so',
    rest9.length === 2 && /^Backup restored: 1 list added\./.test(await statusOf(p9)), rest9.join());
  await fresh.close();

  // the operator's kill switch (LIVE_LOOKUP_ENABLED = false): the note and result say so, nothing is asked or sent
  const off = await contextFor(preset);
  await routeWiki(off);
  await off.route('**/mine/config.js', async route => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/LIVE_LOOKUP_ENABLED\s*=\s*true/, 'LIVE_LOOKUP_ENABLED = false');
    await route.fulfill({ response: res, body });
  });
  const { pg: p11, w: w11 } = await watch(off);
  w11.answer = 'accept';
  const note11 = await p11.locator('#mineFillNote').innerText();
  await p11.tap('#mineFill');
  await p11.waitForFunction(() => /switched off/.test(document.getElementById('mineFillResult').textContent), null, { timeout: 10000 });
  const res11 = await fillResult(p11);
  check('kill switch: the note and result say Wiktionary is switched off, no dialog, nothing sent',
    /switched off/.test(note11) && !/ask Wiktionary|asked to confirm/.test(note11)
    && /Looking up on Wiktionary is switched off for now/.test(res11) && !/Grown-ups/.test(res11)
    && w11.asks === 0 && w11.ext.length === 0, `${note11.slice(0, 80)} | ${res11} | ${w11.asks} ${w11.ext.join()}`);
  await off.close();

  // a device that cannot save: the fill says so instead of claiming it worked
  const fresh2 = await contextFor(preset);
  await routeWiki(fresh2);
  const { pg: p10, w: w10 } = await watch(fresh2);
  w10.answer = 'accept';
  await p10.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('full'); }; });
  await p10.tap('#mineFill');
  await p10.waitForFunction(() => document.getElementById('mineFillResult').textContent.length > 40 && !document.getElementById('mineFill').hasAttribute('aria-busy'), null, { timeout: 15000 }); // preflight: ok
  const failed10 = await fillResult(p10);
  check('fill: if the words cannot be saved, the result says so and does not say Found', /could not save/.test(failed10) && !/^Found/.test(failed10), failed10); // preflight: ok
  await fresh2.close();

  // the safety list fails to load: nothing is read or written, and the saved lists survive
  const locked = await contextFor(preset);
  await locked.addInitScript(seed => { if (!localStorage.getItem('bee-ready-mine-v1')) localStorage.setItem('bee-ready-mine-v1', seed); }, // preflight: ok
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
    zzzxq: { definition: 'A made-up word.', credit: ['evil.example', 'simple.wiktionary.org'] }, qqqzz: { credit: { length: 1 } }, // preflight: ok
  }));
  await routeWiki(poisoned);
  const p4 = await poisoned.newPage();
  const errors4 = [];
  p4.on('pageerror', e => errors4.push(String(e).slice(0, 100)));
  p4.on('dialog', d => d.accept());
  await p4.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  await goTo(p4, 'words');
  await p4.fill('#mineText', 'zzzxq qqqzz');
  await p4.tap('#mineCheck');
  await p4.waitForSelector('#mineChips li');
  await p4.tap('#mineLookup');
  await p4.waitForFunction(() => /looked up/i.test(document.getElementById('mineStatus').textContent), null, { timeout: 15000 }); // preflight: ok
  check('cache: no link to a host outside the two allowed ones',
    !(await p4.$('#mineChips a[href*="evil.example"]')) && (await p4.$$eval('#mineChips a', as => as.every(a => /^https:\/\/(simple|en)\.wiktionary\.org\//.test(a.href))))); // preflight: ok
  check('cache: the screen did not break', errors4.length === 0, errors4.join());
  await poisoned.close();

  // My words fails to load: the page says so and stays the main list
  const HISTORY = JSON.stringify({ attempts: { 1: { correct: 2, missed: 0 } }, missed: {}, rounds: 3 });
  const broken = await contextFor(preset);
  await broken.addInitScript(seed => { if (!localStorage.getItem('bee-ready-history-v2')) localStorage.setItem('bee-ready-history-v2', seed); }, HISTORY); // preflight: ok
  await broken.route('**/mine/ui.js', route => route.abort());
  const p5 = await broken.newPage();
  const errors5 = [];
  p5.on('console', m => { if (m.type() === 'error') errors5.push(m.text()); });
  await p5.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  check('failed load: a visible message says this is the main list', await p5.evaluate(() =>
    /My words could not load/.test(document.getElementById('roundBuilder').textContent)));
  check('failed load: the cause is logged', errors5.some(e => /My words could not load/.test(e)), errors5.join(' | ').slice(0, 120)); // preflight: ok
  check('failed load: the My words panel stays hidden', await p5.evaluate(() => document.getElementById('mineRoot').hidden)); // preflight: ok
  await p5.tap('#startRound');
  await p5.waitForSelector('#answerInput:visible');
  await p5.locator('#answerInput').pressSequentially('wrong');
  await p5.tap('#answerForm button[type=submit]');
  await p5.waitForSelector('#nextWord:visible');
  await p5.tap('#starWord');
  check('failed load: the default history and stars are not written',
    await p5.evaluate(h => localStorage.getItem('bee-ready-history-v2') === h && localStorage.getItem('bee-ready-starred-v1') === null, HISTORY)); // preflight: ok
  await broken.close();

  // "Did you mean" puts focus in the corrected word box; Save right after an edit keeps the edited word
  const second = await contextFor(preset);
  const p6 = await second.newPage();
  await p6.goto(`${BASE}?mode=mine`, { waitUntil: 'networkidle' });
  await goTo(p6, 'words');
  await p6.fill('#mineText', 'habbit');
  await p6.tap('#mineCheck');
  await p6.waitForSelector('[data-chip-use]');
  await p6.tap('[data-chip-use]');
  await p6.waitForTimeout(500);
  check('mine: "Did you mean ... Use it" puts focus in that word box', await p6.evaluate(() =>
    document.activeElement.matches('#mineChips li .mine-chip-row input') && document.activeElement.value === 'habit'));
  await p6.fill('#mineChips li .mine-chip-row input', 'habits');
  await p6.tap('#mineSave');
  await p6.waitForFunction(() => document.querySelectorAll('#wordGrid .word-card').length === 1, null, { timeout: 5000 }); // preflight: ok
  check('mine: Save right after an edit keeps the edited word, and focus is not lost', await p6.evaluate(() =>
    document.querySelector('#wordGrid .word-card h3').textContent === 'habits' && document.activeElement.tagName !== 'BODY')); // preflight: ok
  await second.close();

  // a link with only a list id opens the list the owner published; an unknown id says so, and nothing is saved
  const published = await contextFor(preset);
  const p7 = await published.newPage();
  const own7 = [], external7 = [];
  p7.on('request', r => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin) own7.push(u.pathname);
    else if (!['blob:', 'data:'].includes(u.protocol)) external7.push(u.host);
  });
  const sampleId = readdirSync(new URL('../../lists/', import.meta.url))[0].replace(/\.json$/, '');
  await p7.goto(`${BASE}?mode=mine&l=${sampleId}`, { waitUntil: 'networkidle' });
  await p7.waitForSelector('#mineLinkCard:not([hidden])');
  const card7 = await p7.evaluate(() => document.getElementById('mineLinkCard').innerText);
  check('published: the card names the list and says how many words, without showing them',
    /"Sample list: animals" has 3 words/.test(card7) && !/elephant|giraffe|penguin/.test(card7), card7.slice(0, 100));
  await p7.tap('#mineLinkGrownups summary');
  await p7.waitForSelector('#mineChips li');
  check('published: a grown-up can open its three words', (await p7.$$('#mineChips li')).length === 3);
  check('published: the file came from this site and nothing from a third party',
    own7.some(p => p.endsWith(`/lists/${sampleId}.json`)) && external7.length === 0, external7.join());
  check('published: nothing is saved until Save', await p7.evaluate(() => localStorage.getItem('bee-ready-mine-v1') === null)); // preflight: ok
  // while the card is open there is one start button on Practice, and no photo controls or typing box in the Word bank
  const shown7 = (...ids) => p7.evaluate(list => Object.fromEntries(
    list.map(id => [id, document.getElementById(id).checkVisibility()])), ids);
  const open7 = await shown7('roundBuilder', 'mineLinkStart', 'minePractice');
  check('published: the card hides the round builder, so there is one start button',
    !open7.roundBuilder && !open7.minePractice && open7.mineLinkStart, JSON.stringify(open7));
  await goTo(p7, 'words');
  const bank7 = await shown7('mineText', 'minePhotoBlock', 'mineLinkWait', 'mineBank');
  check('published: the Word bank drops the typing box and photo controls for a note, and keeps the lists',
    !bank7.mineText && !bank7.minePhotoBlock && bank7.mineLinkWait && bank7.mineBank, JSON.stringify(bank7));
  await tap(p7, '#mineLinkWait [data-go=practice]');
  await p7.waitForSelector('#mineLinkCard:not([hidden])');
  await p7.tap('#mineCancel');
  const closed7 = await shown7('roundBuilder', 'mineLinkStart', 'minePractice');
  // focus is set on the next animation frame
  const focused7 = await p7.waitForFunction(() => document.activeElement.id === 'minePracticeTitle', null, { timeout: 3000 }) // preflight: ok
    .then(() => true, () => false);
  check('published: Cancel brings the round builder back, and focus is on the Practice heading',
    closed7.roundBuilder && closed7.minePractice && !closed7.mineLinkStart && focused7, JSON.stringify(closed7));
  await goTo(p7, 'words');
  const back7 = await shown7('mineText', 'minePhotoBlock', 'mineLinkWait');
  check('published: after Cancel the Word bank has its typing box and photo controls again',
    back7.mineText && back7.minePhotoBlock && !back7.mineLinkWait, JSON.stringify(back7));
  await goTo(p7, 'practice');
  await p7.goto(`${BASE}?mode=mine&l=${sampleId}`, { waitUntil: 'networkidle' });
  await p7.waitForSelector('#mineLinkCard:not([hidden])');
  await p7.tap('#mineLinkStart');
  await p7.waitForSelector('#roundArea:not(.hidden)');
  check('published: a round uses the whole 3-word list, and focus is on the question',
    /OF 3$/.test(await p7.locator('#roundNumber').innerText())
    && await p7.evaluate(() => document.activeElement.id === 'questionHeading'));
  check('published: the list is saved under its published name',
    await p7.evaluate(() => (
      JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists[0].name === 'Sample list: animals')));
  await p7.goto(`${BASE}?mode=mine&l=AAAAAAAAAAAAAAAAAAAAAA`, { waitUntil: 'networkidle' });
  check('published: an unknown id says the link has no words', /does not include the words/.test(await statusOf(p7)), await statusOf(p7)); // preflight: ok
  await published.close();

  // 20 lists are already saved: Start says what to do, and the card stays usable
  const full = await contextFor(preset);
  await full.addInitScript(seed => {
    if (!localStorage.getItem('bee-ready-mine-v1')) localStorage.setItem('bee-ready-mine-v1', seed);
  },
    JSON.stringify({ version: 1, nextId: 1000020, active: 'l-1', lists: Array.from({ length: 20 }, (_, i) => (
      { key: `l-${i + 1}`, name: `List ${i + 1}`, entries: [{ id: 1000000 + i, word: 'apple', src: 'manual' }] })) }));
  const p8 = await full.newPage();
  p8.on('dialog', d => d.accept());
  await p8.goto(`${BASE}?mode=mine&l=${sampleId}`, { waitUntil: 'networkidle' });
  await p8.waitForSelector('#mineLinkCard:not([hidden])');
  await p8.tap('#mineLinkStart');
  await p8.waitForTimeout(300);
  check('full: Start says a grown-up must delete a list first, and the card stays',
    /Word bank tab.+Delete this list/.test(await statusOf(p8)) && !/Cancel/.test(await statusOf(p8))
    && await p8.evaluate(() => document.getElementById('mineLinkCard').checkVisibility()), await statusOf(p8));
  await goTo(p8, 'words');
  await p8.tap('#mineDelete');
  await p8.waitForFunction(() => JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists.length === 19);
  await goTo(p8, 'practice');
  await p8.tap('#mineLinkStart');
  await p8.waitForSelector('#roundArea:not(.hidden)');
  check('full: after a list is deleted, Start works without opening the link again', await p8.evaluate(() =>
    JSON.parse(localStorage.getItem('bee-ready-mine-v1')).lists.length === 20));
  await full.close();

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
console.log(`\n${engine} emulation, not a physical device. ${failures.length ? `${failures.length} check(s) failed.` : 'All checks passed.'}`); // preflight: ok
process.exit(failures.length ? 1 : 0);
