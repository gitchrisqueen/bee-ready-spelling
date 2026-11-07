// Checks the practice answer box in iPhone 13 WebKit emulation: a multi-character insert (a stand-in for dictation,
// paste and suggestion taps) is rejected with a kind note, while typing, Backspace and a one-character insert still work.
// It cannot tell the beforeinput block from the input-event fallback; tests/a11y.test.mjs covers each rule separately.
// Serve the built _site/ first.
//   BASE=http://localhost:8080/ node typed-only-check.mjs
// Exits 1 on any mismatch. It is emulation, not a real iPhone or a real iOS dictation.
import { webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080/';
const NOTE = 'Please type the letters yourself, one at a time.';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.tap('#startRound');
await page.waitForSelector('#answerInput:visible');
const box = page.locator('#answerInput');
const value = () => box.inputValue();
const note = () => page.evaluate(() => document.getElementById('answerNote').textContent);
let failed = false;
const check = (label, ok, detail = '') => { if (!ok) failed = true; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

check('note region is empty at the start', (await note()) === '', JSON.stringify(await note()));
check('note region is a polite status region', await page.evaluate(() => { const n = document.getElementById('answerNote'); return n.getAttribute('role') === 'status' && n.getAttribute('aria-live') === 'polite'; }));
await box.focus();
await page.keyboard.type('abc');
check('typing abc by keys gives abc', (await value()) === 'abc', JSON.stringify(await value()));
check('no note after typing', (await note()) === '', JSON.stringify(await note()));
await page.keyboard.insertText('zzz');
check('multi-character insert is rejected: value stays abc', (await value()) === 'abc', JSON.stringify(await value()));
check('the kind note is shown', (await note()) === NOTE, JSON.stringify(await note()));
check('focus stays in the box and the box is enabled', await page.evaluate(() => document.activeElement.id === 'answerInput' && !document.activeElement.disabled));
await page.keyboard.press('Backspace');
check('Backspace works: value is ab', (await value()) === 'ab', JSON.stringify(await value()));
check('note clears on the next accepted key', (await note()) === '', JSON.stringify(await note()));
await page.keyboard.type('cd');
check('typing letters again: value is abcd', (await value()) === 'abcd', JSON.stringify(await value()));
await page.keyboard.insertText('e');
check('a one-character insert still works: value is abcde', (await value()) === 'abcde', JSON.stringify(await value()));
await page.keyboard.insertText('fg');
check('a two-character insert is rejected: value stays abcde', (await value()) === 'abcde', JSON.stringify(await value()));
await browser.close();
process.exitCode = failed ? 1 : 0;
