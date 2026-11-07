// Answers a practice word wrongly (iPhone WebKit emulation) and checks that the clue buttons stay enabled,
// that the sentence clue then shows the word in bold instead of the blank, and that the next word resets.
// Serve the built _site/ first.
//   BASE=http://localhost:8080/ node after-answer-check.mjs
// Exits 1 on any mismatch.
import { webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080/';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.tap('#startRound');
await page.waitForSelector('#hearWord:visible');
const clueHtml = () => page.evaluate(() => document.getElementById('clueResult').innerHTML);
const disabled = () => page.evaluate(() => [...document.querySelectorAll('[data-clue]')].map(b => b.disabled));
let failed = false;
const check = (label, ok, detail = '') => { if (!ok) failed = true; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

await page.tap('[data-clue="sentence"]');
check('blank before the answer', (await clueHtml()).includes('class="blank"'));
await page.locator('#answerInput').pressSequentially('zzz');
await page.press('#answerInput', 'Enter');
await page.waitForSelector('#nextWord:visible');
check('clue buttons enabled after the answer', (await disabled()).every(d => d === false), JSON.stringify(await disabled()));
const after = await clueHtml();
check('open sentence shows the word in bold', !after.includes('class="blank"') && after.split('<strong>').length > 2, after.slice(0, 120));
check('the bold word stays inline in the sentence', await page.evaluate(() => { const bold = [...document.querySelectorAll('#clueResult strong')][1]; return Boolean(bold) && getComputedStyle(bold).display === 'inline'; }));
await page.tap('[data-clue="definition"]');
check('definition clue works after the answer', (await clueHtml()).startsWith('<strong>Definition</strong>'));
await page.tap('[data-clue="part"]');
check('part of speech clue works after the answer', (await clueHtml()).startsWith('<strong>Part of speech</strong>'));
await page.tap('[data-clue="sentence"]');
const again = await clueHtml();
check('sentence pressed after the answer shows the word', !again.includes('class="blank"') && again.split('<strong>').length > 2);
await page.tap('#nextWord');
await page.waitForTimeout(300);
check('next word: buttons enabled', (await disabled()).every(d => d === false));
check('next word: clue area reset', await page.evaluate(() => document.getElementById('clueResult').hidden));
await page.tap('[data-clue="sentence"]');
check('next word: sentence is a blank again', (await clueHtml()).includes('class="blank"'));
await browser.close();
process.exitCode = failed ? 1 : 0;
