// Guards for the accessibility and privacy-wording fixes. Source checks only: no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = name => readFileSync(join(root, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = read('styles.css');
const fn = (source, name) => {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `function ${name} not found`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
};

test('the question heading can take focus and is focused when a word appears', () => {
  assert.match(html, /<h2 id="questionHeading" tabindex="-1">/);
  assert.match(fn(app, 'startRound'), /showCurrent\(\);\$\('questionHeading'\)\.focus\(\{preventScroll:true\}\)/);
  assert.match(app, /\$\('nextWord'\)\.addEventListener\('click',\(\)=>\{[^}]*showCurrent\(\);[^}]*\$\('questionHeading'\)\.focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(app, /answerInput'\)\.focus/, 'never focus the answer box by itself: it opens the phone keyboard');
});

test('focus moves before the focused control is hidden', () => {
  assert.match(fn(app, 'markAnswer'), /\$\('nextWord'\)\.focus\(/);
  assert.match(app, /\$\('gradeOral'\)\.querySelector\('button'\)\.focus\(/);
});

test('the custom number field name starts with its visible label (WCAG 2.5.3)', () => {
  const label = html.match(/<label class="custom-count">([^<]*)<input id="wordCount"([^>]*)>/);
  assert.ok(label, 'custom count label not found');
  assert.equal(label[1].trim(), 'Your number');
  const aria = label[2].match(/aria-label="([^"]*)"/);
  assert.ok(!aria || aria[1].startsWith('Your number'), `aria-label must start with "Your number", got "${aria?.[1]}"`);
});

test('touch targets: nav buttons and the notice close button are at least 44 px', () => {
  assert.match(css, /\.nav-button\{[^}]*min-height:44px/);
  assert.match(css, /\.icon-btn\{[^}]*width:44px;height:44px/);
});

test('a failed word list load is announced', () => {
  assert.match(app, /class="toast" role="alert"/);
  assert.match(app, /\$\('resultCount'\)\.textContent='The word list did not load\. Please refresh the page\.'/);
});

test('the blank in the sentence clue is read as "blank" and everything else is escaped', () => {
  assert.match(app, /<span class="blank" role="img" aria-label="blank"><\/span>/);
  assert.doesNotMatch(app.slice(app.indexOf('const BLANK_HTML')).split('\n')[0], /_{2,}/, 'no underscore characters: they draw a dashed line');
  assert.match(css, /\.blank\{display:inline-block;width:5em;[^}]*border-bottom:3px solid currentColor/, 'one solid line, the same width for every word');
  assert.match(fn(app, 'hideWord'), /map\(escapeHtml\)/);
  assert.doesNotMatch(app, /escapeHtml\(hideWord/, 'hideWord returns escaped HTML already');
});

test('an empty review pool after a finished round says so kindly', () => {
  assert.match(app, /You did not miss any words! Great job\./);
  assert.match(app, /history\.rounds>0\?/);
  assert.match(app, /No review words yet!/, 'first-time wording stays');
});

test('Repeat slowly is a one-off and never changes the saved speed', () => {
  const clue = fn(app, 'showClue');
  const repeat = clue.slice(clue.indexOf("type==='repeat'"), clue.indexOf('const clueText'));
  assert.match(repeat, /speedId:'slow'/);
  assert.ok(!repeat.includes('select('), 'repeat must not call select()');
  assert.ok(!repeat.includes('syncVoiceButtons'), 'repeat must not change the speed buttons');
});

test('the audio-mode radios sit in a labelled radiogroup', () => {
  assert.match(html, /<h3 class="settings-heading" id="audioModeHeading">Choose your audio mode<\/h3>/);
  assert.match(html, /<div class="audio-mode" role="radiogroup" aria-labelledby="audioModeHeading">/);
});

test('the voice sample asks for instant playback', () => {
  assert.match(read('voice-service.js'), /async preview\(\)\{return this\.speak\(PREVIEW_TEXT,\{kind:'sample',instant:true\}\);\}/);
});

test('decorative glyphs inside button and link text are hidden from screen readers', () => {
  const bare = [...html.matchAll(/<(button|a)\b[^>]*>\s*([▶⬇✓↻🐝📄])/gu)].map(m => m[0]);
  assert.deepEqual(bare, [], 'wrap these glyphs in <span aria-hidden="true">');
  for (const glyph of ['▶', '⬇', '✓', '↻', '🐝', '📄']) {
    assert.ok(html.includes(`<span aria-hidden="true">${glyph}</span>`), `${glyph} should be in an aria-hidden span`);
  }
});

test('privacy wording is honest about GitHub hosting and the optional live voice', () => {
  assert.doesNotMatch(html, /Nothing is sent to a server/);
  assert.match(html, /Practice history, stars and voice settings stay in this browser\./);
  assert.match(html, /hosted by GitHub, which can see a visitor's IP address/);
  for (const host of ['cdn.jsdelivr.net', 'esm.sh', 'huggingface.co']) assert.ok(html.includes(host), `${host} must be named`);
  assert.match(html, /Turning this on loads files from outside services; see Grown-ups\./);
});

test('focus never falls to <body> when the voice notice or a button in it is hidden', () => {
  assert.match(app, /function releaseNoticeFocus\(hiding\)\{\s*if\(!\$\('voiceDownload'\)\.contains\(document\.activeElement\)\)return;/);
  const dismiss = app.slice(app.indexOf("$('closeNotice').addEventListener"), app.indexOf("$('closeNotice').addEventListener") + 200);
  assert.ok(dismiss.indexOf('releaseNoticeFocus(true)') > 0 && dismiss.indexOf('releaseNoticeFocus(true)') < dismiss.indexOf("classList.add('hidden')"), 'Dismiss: move focus before hiding');
  assert.match(app, /setTimeout\(\(\)=>\{releaseNoticeFocus\(true\);\$\('voiceDownload'\)\.classList\.add\('hidden'\);\},4500\)/, 'the auto-hide timer moves focus first');
  const status = app.slice(app.indexOf('function updateVoiceStatus'));
  const release = status.indexOf('releaseNoticeFocus(false)');
  assert.ok(release > 0 && release < status.indexOf("$('downloadRetry').classList.toggle('hidden'"), 'Try again / Use device voice: move focus before hiding');
  assert.doesNotMatch(app, /\$\('clearHistory'\)\.textContent/, 'the Clear history button keeps one fixed name');
  assert.match(app, /setClearStatus\('Practice history cleared\.'\)/);
});

test('copy only names buttons that exist and are visible', () => {
  const text = html + app + read('voice-service.js');
  for (const stale of ['Preview voice', 'Start practice', 'Tap Play', 'tap Play once', 'Select Try again', 'preview their voice']) assert.ok(!text.includes(stale), `"${stale}" is not a button name`);
  for (const name of ['Hear my word', 'Play voice sample', 'Retry natural audio']) assert.ok(html.includes(name), `${name} must be a real button name`);
});

test('switching tabs by click moves focus to the new page heading, and page load does not', () => {
  for (const id of ['practice', 'words', 'voices', 'grownups']) assert.match(html, new RegExp(`<h1 id="${id}-title" tabindex="-1">`));
  assert.match(app, /function showTab\(tab,\{focus=false\}=\{\}\)/);
  assert.match(app, /if\(focus\)\{const h=\$\(`\$\{tab\}-title`\);if\(h\)h\.focus\(\{preventScroll:true\}\);\}/);
  assert.match(app, /showTab\(btn\.dataset\.tab,\{focus:true\}\)/);
  assert.match(app, /showTab\(btn\.dataset\.go,\{focus:true\}\)/);
  assert.match(app, /if\(location\.hash\)showTab\(location\.hash\.slice\(1\)\);/);
  assert.match(css, /h1:focus,h2:focus/);
});

test('the practice screen has a visible speed switch, and Repeat slowly stays a one-time slow play', () => {
  assert.match(html, /<div id="practiceSpeed" class="segmented" role="group" aria-labelledby="practiceSpeedLabel">/);
  assert.match(html, /id="practiceSpeedLabel">Voice speed</);
  assert.match(app, /data-practice-speed="\$\{s\.id\}" aria-pressed="false">\$\{s\.label\}</, 'one button per speed, fixed names, state in aria-pressed');
  assert.match(app, /voiceService\.select\(\{speedId:b\.dataset\.practiceSpeed\}\)/);
  assert.match(app, /\[data-speed\],\[data-practice-speed\]/, 'both speed groups stay in sync');
  assert.match(app, /if\(type==='repeat'\)\{voiceService\.speak\(w\.word,\{kind:'word',instant:true,speedId:'slow'\}\);return;\}/);
  assert.match(css, /\.practice-speed \.speed-option\{min-height:44px/);
});

test('clue buttons stay enabled after an answer, and the sentence then shows the word', () => {
  const mark = fn(app, 'markAnswer');
  assert.doesNotMatch(mark, /\[data-clue\][^;]*disabled\s*=\s*true/, 'the clue buttons must not be disabled after answering');
  assert.match(mark, /currentRound\.answered=true;/);
  assert.match(mark, /if\(currentRound\.lastClue==='sentence'\)showClue\('sentence',\{speak:false\}\)/);
  assert.match(fn(app, 'showCurrent'), /\[data-clue\]'\)\.forEach\(b=>b\.disabled=false\)/);
  assert.match(fn(app, 'showCurrent'), /currentRound\.answered=false;currentRound\.lastClue=null;/);
  // Run the real hideWord with the real escapeHtml: blank before the answer, bold word after it.
  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const BLANK_HTML = '<span class="blank"></span>';
  const hideWord = new Function('escapeHtml', 'BLANK_HTML', `${fn(app, 'hideWord')}; return hideWord;`)(escapeHtml, BLANK_HTML);
  assert.equal(hideWord('We met at the plaza <today>.', 'plaza'), `We met at the ${BLANK_HTML} &lt;today&gt;.`);
  assert.equal(hideWord('We met at the plaza <today>.', 'plaza', true), 'We met at the <strong>plaza</strong> &lt;today&gt;.');
  assert.equal(hideWord('The Plaza is big.', 'plaza', true), 'The <strong>Plaza</strong> is big.');
});
