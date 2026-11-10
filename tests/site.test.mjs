import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = name => readFileSync(join(root, name), 'utf8');
const words = JSON.parse(read('words.json'));

test('word inventory is well-formed (adding or removing words must not break the build)', () => {
  assert.ok(words.length > 0);
  assert.equal(new Set(words.map(w => w.word.toLowerCase())).size, words.length, 'words must be unique');
  for (const w of words) {
    assert.ok(Number.isInteger(w.id));
    assert.ok(typeof w.word === 'string' && w.word.length);
    assert.ok(typeof w.definition === 'string' && w.definition.length);
    assert.ok(typeof w.group === 'string' && w.group.length);
    assert.ok(['Study', 'Challenge'].includes(w.level), `${w.word}: level must be Study or Challenge`);
  }
});

test('no two words share a clip file name', async () => {
  const { clipKey } = await import('../voice-service.js');
  const seen = new Map();
  for (const w of words) {
    const key = clipKey(w.word);
    assert.ok(!seen.has(key) || seen.get(key) === w.word, `"${seen.get(key)}" and "${w.word}" both map to ${key}`);
    seen.set(key, w.word);
    assert.match(key, /^[a-z0-9_-]+$/, `${w.word}: clip name must be plain ASCII`);
  }
});

test('entrypoint uses relative URLs that work in GitHub Pages project subpath', () => {
  const html=read('index.html');
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.match(read('app.js'), /fetch\('\.\/words\.json'\)/);
  assert.doesNotMatch(html, /<base\s+href="\/"/i);
});

test('voice choices and model download UI appear', () => {
  const html=read('index.html');
  for(const phrase of ['voiceDownload','downloadTrack','downloadPercent','downloadUseDevice','downloadRetry','previewVoice']) {
    assert.ok(html.includes(phrase), `Missing UI: ${phrase}`);
  }
  const service=read('voice-service.js');
  for(const engine of ['kokoro','piper','device']) assert.ok(service.includes(engine));
});

test('printable resources exist and match download links', () => {
  const html=read('index.html');
  for(const name of ['Spelling_Bee_Alphabetical_List.pdf','Spelling_Bee_Definitions_Reference.pdf','Spelling_Bee_Practice_Workbook.pdf']) {
    assert.ok(existsSync(join(root, 'assets', name)));
    assert.ok(html.includes(`./assets/${name}`));
  }
});

test('public source contains no account keys or user-login requirements', () => {
  const js=read('voice-service.js');
  assert.doesNotMatch(js,/api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(js,/Authorization:\s*Bearer\s+\S+/i);
  assert.match(js,/KokoroTTS/);
  assert.match(js,/SpeechSynthesisUtterance/);
});

test('every clip listed in a voice manifest exists on disk', () => {
  const clipsDir = join(root, 'clips');
  if (!existsSync(clipsDir)) return;
  for (const voice of readdirSync(clipsDir)) {
    const manifest = join(clipsDir, voice, 'manifest.json');
    if (!existsSync(manifest)) continue;
    for (const key of Object.keys(JSON.parse(readFileSync(manifest, 'utf8')))) {
      assert.ok(existsSync(join(clipsDir, voice, `${key}.mp3`)), `${voice}/${key}.mp3 is listed but missing`);
    }
  }
});

test('clip folders, voices and the self-hosted voice files agree', async () => {
  const { VOICES } = await import('../voice-service.js');
  const ids = VOICES.map(v => v.kokoro);
  const fetchScript = read('scripts/fetch-voice-assets.mjs');
  for (const id of ids) assert.ok(fetchScript.includes(`'voices/${id}.bin'`), `${id}: add its voice file to fetch-voice-assets.mjs`);
  const clipsDir = join(root, 'clips');
  if (existsSync(clipsDir)) {
    for (const entry of readdirSync(clipsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) assert.ok(ids.includes(entry.name), `clips/${entry.name} is not a voice in VOICES`);
    }
  }
});

test('clip folders hold only mp3 files and a manifest', () => {
  const clipsDir = join(root, 'clips');
  if (!existsSync(clipsDir)) return;
  for (const voice of readdirSync(clipsDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
    for (const name of readdirSync(join(clipsDir, voice.name))) {
      assert.match(name, /^([a-z0-9_-]+\.mp3|manifest\.json)$/, `unexpected file clips/${voice.name}/${name}`);
    }
  }
});

test('the clip workflow can read the voice list from voice-service.js', async () => {
  const { VOICES } = await import('../voice-service.js');
  const found = [...read('voice-service.js').matchAll(/kokoro:'([a-z_]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(found, VOICES.map(v => v.kokoro).sort(), 'keep VOICES entries in the form kokoro:\'id\' (the workflow parses them)');
});

test('every practice sentence has its own plain-ASCII clip name', async () => {
  const { sentenceKey } = await import('../voice-service.js');
  const { sentenceFor } = await import('../sentences.js');
  const owners = new Map();
  for (const w of words) {
    const sentence = sentenceFor(w);
    assert.ok(typeof sentence === 'string' && sentence.length > 10, `${w.word}: sentence missing`);
    const key = sentenceKey(sentence);
    assert.match(key, /^sentence_[a-z0-9]+$/);
    assert.ok(!owners.has(key) || owners.get(key) === sentence, `sentence key collision for "${sentence}"`);
    owners.set(key, sentence);
  }
});

test('the workflow matrix takes its voices from VOICES, so no list can drift', () => {
  const workflow = read('.github/workflows/generate-clips.yml');
  assert.match(workflow, /fromJSON\(needs\.plan\.outputs\.voices\)/);
  assert.match(workflow, /kokoro:'\(\[a-z_\]\+\)'/);
});

test('a stored sentence is used, and a word without one still gets a fallback sentence', async () => {
  const { sentenceFor } = await import('../sentences.js');
  assert.equal(sentenceFor({ word: 'plaza', part: 'n', sentence: ' We met in the plaza. ' }), 'We met in the plaza.');
  assert.match(sentenceFor({ word: 'plaza', part: 'n' }), /plaza/);
});

test('every stored sentence uses its word exactly once, as a whole word', () => {
  for (const w of words) {
    if (typeof w.sentence !== 'string') continue;
    const low = w.sentence.toLowerCase();
    const word = w.word.toLowerCase();
    assert.equal(low.split(word).length - 1, 1, `${w.word}: the word must appear once and inside no other word: ${w.sentence}`);
    const whole = low.match(new RegExp(`(?<![\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu')) || [];
    assert.equal(whole.length, 1, `${w.word}: must appear exactly once as a whole word: ${w.sentence}`);
    assert.match(w.sentence, /[.!?][”"]?$/, `${w.word}: sentence must end with . ! or ?`);
  }
});

test('star controls are in the page and wired up', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of ['heroStarred', 'starFilter', 'starWord', 'clearStars']) assert.ok(html.includes(`id="${id}"`), `Missing UI: ${id}`);
  assert.match(html, /<option value="starred">My starred words<\/option>/);
  assert.match(html, /<label class="field">Show<select id="starFilter"><option value="all">All words<\/option><option value="starred">My starred words only<\/option>/);
  assert.doesNotMatch(html + app, /Remove star|Hide details/, 'state lives in aria-pressed / aria-expanded, never in a flipping name');
  assert.doesNotMatch(html + app, /[Tt]ap the ☆/, 'say "press the Star button (☆)", not the glyph alone');
  assert.match(html, /id="starWord"[^>]*aria-label="Star this word"/, 'the round star label must not reveal the word');
  assert.match(app, /from '\.\/stars\.js'/);
  assert.match(app, /type==='starred'/);
  assert.match(read('scripts/build.mjs'), /'stars\.js'/);
  assert.match(read('package.json'), /node --check stars\.js/);
});

test('word details are wired up: module is built and syntax-checked, and app.js uses it', () => {
  assert.match(read('scripts/build.mjs'), /'wordcard\.js'/);
  assert.match(read('package.json'), /node --check wordcard\.js/);
  const app = read('app.js');
  assert.match(app, /from '\.\/wordcard\.js'/);
  const hear = app.slice(app.indexOf('function hearFromCard'), app.indexOf('function renderWordBank'));
  assert.match(hear, /speedId:'slow'/);
  assert.ok(!hear.includes('select('), 'Hear it slowly must not change the saved speed');
});

test('status regions, focus moves and the clear-stars message are wired up', () => {
  const html = read('index.html'), app = read('app.js');
  assert.match(html, /id="resultCount" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /id="clearStarsStatus"[^>]*role="status"/);
  assert.match(html, /<button id="clearStars" class="text-btn">Clear this device's starred words<\/button>/);
  assert.doesNotMatch(app, /Starred words cleared ✓/, 'the button text must never change');
  assert.match(app, /setClearStatus\('Starred words cleared\.'\)/);
  assert.doesNotMatch(html, /id="roundArea"[^>]*aria-live/, 'the star button must stay out of a live region');
  assert.match(app, /You have no starred words yet\.<\/h2><p>Go to the Word bank and press the Star button on a word\./);
  assert.match(app, /id="emptyPoolHeading" tabindex="-1"/);
  assert.match(app, /removed from your starred words\. /);
  assert.match(app, /n===1\?'1 word'/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(app, /behavior:'smooth'/);
  assert.match(read('styles.css'), /animation-iteration-count:1!important/);
  assert.match(read('styles.css'), /scroll-padding-bottom:120px/);
});

test('fonts are hosted in the repo and the page makes no request to a font CDN', () => {
  const css = read('styles.css');
  const html = read('index.html');
  assert.doesNotMatch(css + html + read('app.js'), /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  for (const file of ['fonts/dm-sans-latin.woff2', 'fonts/fredoka-latin.woff2', 'fonts/OFL-DM-Sans.txt', 'fonts/OFL-Fredoka.txt']) {
    assert.ok(existsSync(join(root, file)), `${file} is missing`);
    assert.ok(statSync(join(root, file)).size > 1000, `${file} is empty`);
  }
  assert.equal(readFileSync(join(root, 'fonts/dm-sans-latin.woff2')).subarray(0, 4).toString(), 'wOF2');
  assert.match(css, /@font-face\{font-family:'DM Sans'/);
  assert.match(css, /@font-face\{font-family:'Fredoka'/);
  assert.match(read('scripts/build.mjs'), /'fonts'/);
});

// ---- optional `say` override (IPA) per word: tools/clips/say.js, used by the clip generator ----

test('words.json: an optional `say` is valid when present (none is required)', async () => {
  const { sayProblems } = await import('../tools/clips/say.js');
  for (const w of words) {
    if (!Object.hasOwn(w, 'say')) continue;
    assert.deepEqual(sayProblems(w.say), [], `${w.word}: invalid say`);
  }
});

test('say validation accepts model-notation IPA and rejects everything else', async () => {
  const { sayProblems, SAY_MAX_LENGTH } = await import('../tools/clips/say.js');
  for (const ok of ['kɹwɑːsˈɑːn', 'kɹwæsˈɑ̃', 'ˌæbdɪkˈeɪt', 'ɐ bˈɪɡ ɹˈɛd', 'a'.repeat(SAY_MAX_LENGTH)]) {
    assert.deepEqual(sayProblems(ok), [], ok);
  }
  const bad = {
    '': /empty/, '   ': /empty/, ' krwɑːsˈɑːn': /start or end/, 'krwɑːsˈɑːn ': /start or end/,
    'krwɑː sˈɑːn1': /digits/, k2: /digits/, 'kɹ  wɑː': /two spaces/,
    [`${'a'.repeat(SAY_MAX_LENGTH)}a`]: /limit/,
    croissant: /outside the allowed set.*"r".*ɹ/, 'bɪg': /"g"/, 'kˈɑːn.': /"\."/, 'kˈɑːn!': /"!"/,
    'ka\nb': /U\+000A/, 'ka\tb': /U\+0009/, 'ɑ↗': /U\+2197/, 'ʲa': /U\+02B2/, xa: /"x"/, 'é': /U\+00E9/,
  };
  for (const [say, expected] of Object.entries(bad)) {
    const problems = sayProblems(say);
    assert.ok(problems.length, `should be rejected: ${JSON.stringify(say)}`);
    assert.match(problems.join('; '), expected, JSON.stringify(say));
  }
  for (const notString of [undefined, null, 5, ['a'], {}]) assert.ok(sayProblems(notString).length);
});

test('sayOf returns undefined without say and names the word when say is invalid', async () => {
  const { sayOf } = await import('../tools/clips/say.js');
  assert.equal(sayOf({ word: 'plaza' }), undefined);
  assert.equal(sayOf({ word: 'plaza', say: 'plˈɑːzə' }), 'plˈɑːzə');
  assert.throws(() => sayOf({ word: 'plaza', say: 'plaza2' }), /^Error: plaza: .*digits/);
  assert.throws(() => sayOf({ word: 'plaza', say: null }), /plaza/);
});

test('the fingerprint changes when say is added, changed or removed, and only then', async () => {
  const { clipFingerprint } = await import('../tools/clips/say.js');
  const { createHash } = await import('node:crypto');
  const fp = say => clipFingerprint('croissant', 'af_heart', 'rev1', 'enc1', say);
  assert.equal(fp(undefined), fp(undefined));
  assert.notEqual(fp(undefined), fp('krwɑːsˈɑːn'));
  assert.notEqual(fp('krwɑːsˈɑːn'), fp('krwæsˈɑ̃'));
  assert.equal(fp('krwɑːsˈɑːn'), fp('krwɑːsˈɑːn'));
  assert.notEqual(clipFingerprint('croissant', 'af_bella', 'rev1', 'enc1', undefined), fp(undefined));
  const before = createHash('sha256').update('croissant|af_heart|rev1|enc1').digest('hex').slice(0, 16);
  assert.equal(fp(undefined), before);
  // Pinned to literal values copied from the committed clips/af_heart/manifest.json (word and sentence of "abdicate"),
  // so changing the hashed text for a word without say fails here: that would re-record every existing clip.
  const revision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
  const encoder = 'mp3-mono-40k-trim-v2';
  const sentence = 'After ruling for fifty years, the old queen decided to abdicate and let her daughter wear the crown.';
  assert.equal(clipFingerprint('abdicate', 'af_heart', revision, encoder, undefined), '61c8c8fc2e373a19');
  assert.equal(clipFingerprint(sentence, 'af_heart', revision, encoder, undefined), '375c76b18c7455bf');
  const manifestPath = join(root, 'clips/af_heart/manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const { sentenceKey } = await import('../voice-service.js');
    assert.equal(manifest.abdicate, '61c8c8fc2e373a19', 'the literal must match the committed manifest');
    assert.equal(manifest[sentenceKey(sentence)], '375c76b18c7455bf', 'the literal must match the committed manifest');
  }
});

test('every word with a say can have it placed in its practice sentence', async () => {
  const { splitAtWord } = await import('../tools/clips/say.js');
  const { sentenceFor } = await import('../sentences.js');
  for (const w of words) {
    if (!Object.hasOwn(w, 'say')) continue;
    assert.ok(splitAtWord(sentenceFor(w), w.word), `${w.word}: the sentence needs the word once, with a space or punctuation on both sides`);
  }
});

test('a sentence is split around its word only when the word is a clean whole word', async () => {
  const { splitAtWord } = await import('../tools/clips/say.js');
  assert.deepEqual(splitAtWord('She ate a croissant.', 'croissant'), { left: 'She ate a ', right: '.' });
  assert.deepEqual(splitAtWord('Croissant, please!', 'croissant'), { left: '', right: ', please!' });
  assert.deepEqual(splitAtWord('We said “croissant” twice.', 'croissant'), { left: 'We said “', right: '” twice.' });
  assert.equal(splitAtWord('A croissant and a croissant.', 'croissant'), null, 'twice');
  assert.equal(splitAtWord('She ate a pastry.', 'croissant'), null, 'absent');
  assert.equal(splitAtWord('Two croissants sat there.', 'croissant'), null, 'inside another word');
  assert.equal(splitAtWord("The croissant's layers were thin.", 'croissant'), null, "'s changes the sounds");
  assert.equal(splitAtWord('The mid-croissant layer.', 'croissant'), null, 'a hyphen joins it to another word');
});

test('sentence sounds are left + say + right with the spacing the model sees', async () => {
  const { makeKokoroPhonemizer, sentencePhonemes } = await import('../tools/clips/say.js');
  // A stub phonemizer that upper-cases each word. The generator itself runs the real one.
  const calls = [];
  const phonemes = makeKokoroPhonemizer(async (text, lang) => {
    calls.push([text, lang]);
    return text.toUpperCase().split(' ');
  });
  assert.equal(await sentencePhonemes('She ate a croissant.', 'croissant', 'SAY', phonemes), 'SHE ATE A SAY.');
  assert.equal(await sentencePhonemes('Croissant, please!', 'croissant', 'SAY', phonemes), 'SAY, PLEASE!');
  assert.equal(await sentencePhonemes('We said “croissant” twice.', 'croissant', 'SAY', phonemes), 'WE SAID "SAY" TWICE.'); // kokoro-js turns curly quotes into straight ones
  assert.equal(await sentencePhonemes('Croissant', 'croissant', 'SAY', phonemes), 'SAY');
  assert.ok(calls.every(([, lang]) => lang === 'en-us'));
  await assert.rejects(
    sentencePhonemes('A croissant and a croissant.', 'croissant', 'SAY', phonemes),
    /croissant: cannot place/,
  );
});

test('sentence sounds keep the phonemizer\'s in-context sounds, and fall back to splitting when the word changed', async () => {
  const { makeKokoroPhonemizer, sentencePhonemes } = await import('../tools/clips/say.js');
  // Stub: "a" is "EY" when it ends the text and "ə" otherwise (like a real phonemizer's reduced little words).
  const reduce = makeKokoroPhonemizer(async text => {
    const list = text.split(' ');
    return list.map((w, i) => (w === 'a' ? (i === list.length - 1 ? 'EY' : 'ə') : w.toUpperCase()));
  });
  const fellBack = [];
  const opts = { onFallback: w => fellBack.push(w) };
  assert.equal(await sentencePhonemes('She ate a croissant.', 'croissant', 'SAY', reduce, opts), 'SHE ATE ə SAY.');
  assert.deepEqual(fellBack, [], 'the word was found in the whole sentence, so no fallback');
  // Stub: the word's sounds differ in context ("CRX") from its sounds alone ("CROISSANT"), so it cannot be found.
  const changes = makeKokoroPhonemizer(async text => text.split(' ').map(w => (w === 'croissant' && text !== w ? 'CRX' : w.toUpperCase())));
  assert.equal(await sentencePhonemes('She ate a croissant.', 'croissant', 'SAY', changes, opts), 'SHE ATE A SAY.');
  assert.deepEqual(fellBack, ['croissant']);
});

test('the kokoro-js text normalisation is mirrored (numbers, titles, quotes)', async () => {
  const { normalizeText } = await import('../tools/clips/say.js');
  assert.equal(normalizeText('  It’s “fine”  '), 'It\'s "fine"');
  assert.equal(normalizeText('Dr. Smith came in 1999.'), 'Doctor Smith came in 19 99.');
});

// A fake tokenizer shaped like the real one: 0 before and after, one id per known character, unknown dropped.
function fakeTokenizer(known) {
  return text => {
    const ids = [0, ...[...text].filter(ch => known.has(ch)).map(ch => ch.codePointAt(0)), 0];
    return { input_ids: { dims: [1, ids.length], ids } };
  };
}

test('sayIds fails loudly, naming the word and the characters the tokenizer does not know', async () => {
  const { sayIds, sentenceIds } = await import('../tools/clips/say.js');
  const tokenizer = fakeTokenizer(new Set('kɹwɑːsˈn '));
  assert.equal(sayIds(tokenizer, 'kɹwɑːsˈɑːn', 'croissant').ids.length, 12);
  assert.throws(() => sayIds(tokenizer, 'kɹwɑːsˈɑ̃n', 'croissant'), /croissant: .*does not know "̃" \(U\+0303\)/);
  assert.throws(() => sayIds(tokenizer, 'kxw', 'croissant'), /croissant: .*"x" \(U\+0078\)/);
  assert.throws(() => sentenceIds(tokenizer, 'ʃi ate kɹwæ.', 'kɹwæ', 'croissant'), /croissant: .*"æ"/);
  assert.equal(sentenceIds(tokenizer, 'sn kɹwɑːn', 'kɹwɑːn', 'croissant').ids.length, 11);
});

test('every character allowed in say is in the Kokoro vocabulary (when the model files are cached locally)', async () => {
  const { SAY_CHARS } = await import('../tools/clips/say.js');
  const model = 'tools/clips/node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX';
  const cached = join(root, model, 'tokenizer.json');
  if (!existsSync(cached)) return; // CI does not download the model; the generator checks again at run time.
  const vocab = new Set(Object.keys(JSON.parse(readFileSync(cached, 'utf8')).model.vocab));
  for (const ch of SAY_CHARS) assert.ok(vocab.has(ch), `U+${ch.codePointAt(0).toString(16)} is not in the vocabulary`);
});

test('the build stages the My words code and library, so a missing folder cannot ship silently', () => {
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'pipe' });
  const nonEmpty = dir => existsSync(join(root, '_site', dir)) && readdirSync(join(root, '_site', dir)).length > 0;
  assert.ok(nonEmpty('mine'), '_site/mine must exist and not be empty');
  assert.ok(nonEmpty('library'), '_site/library must exist and not be empty');
  assert.ok(existsSync(join(root, '_site/mine/filter.sha256')), 'the safety list ships with the page code');
  assert.ok(existsSync(join(root, '_site/library/a.json')));
  assert.ok(!existsSync(join(root, '_site/mine/FILTER-NOTICE.md')), 'only page code and the safety list are copied from mine/'); // preflight: ok
  assert.equal(existsSync(join(root, '_site/lists')), existsSync(join(root, 'lists')), '_site/lists exists only when lists/ does'); // preflight: ok
});
