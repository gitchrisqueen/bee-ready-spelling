// Signal B input: the phonemes kokoro-js feeds the Kokoro model for each word.
//
//   node tools/pronunciation/espeak.mjs <output.json>
//
// kokoro-js 1.2.1 phonemizes text with the `phonemizer` package (espeak-ng, language "en-us" for the American
// voices) and then applies the string replacements below. This file repeats those replacements (from
// kokoro-js/dist/kokoro.js, function m) for a single word; text normalisation that only touches digits,
// titles and punctuation cannot change a bare word, except the curly-quote fold, which is kept.
// Needs `npm ci` in tools/clips first (that installs kokoro-js and phonemizer at the pinned versions).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');
const clipsModules = join(root, 'tools', 'clips', 'node_modules');
const { phonemize } = await import(pathToFileURL(join(clipsModules, 'phonemizer', 'dist', 'phonemizer.js')).href);
const versionOf = name => JSON.parse(readFileSync(join(clipsModules, name, 'package.json'), 'utf8')).version;
const versions = { 'kokoro-js': versionOf('kokoro-js'), phonemizer: versionOf('phonemizer') };

const LANG = 'en-us';

// The same replacements, in the same order, as kokoro-js applies after phonemizing.
export function afterPhonemize(ipa) {
  return ipa
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
    .trim();
}

export async function espeakFor(word) {
  const text = word.replace(/[‘’]/g, "'").trim();
  return afterPhonemize((await phonemize(text, LANG)).join(' '));
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const out = process.argv[2];
  if (!out) throw new Error('usage: node tools/pronunciation/espeak.mjs <output.json>');
  const words = JSON.parse(readFileSync(join(root, 'words.json'), 'utf8'));
  const result = {};
  for (const w of words) result[String(w.id)] = { word: w.word, espeak: await espeakFor(w.word) };
  writeFileSync(out, JSON.stringify({ meta: { ...versions, lang: LANG }, words: result }, null, 1));
  console.log(`wrote ${out}: ${words.length} words, kokoro-js ${versions['kokoro-js']}, phonemizer ${versions.phonemizer}`);
  process.exit(0);
}
