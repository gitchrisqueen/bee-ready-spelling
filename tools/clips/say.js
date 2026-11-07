// Optional per-word `say` override for the clip generator (tools/clips/generate.mjs).
//
// Kokoro guesses a word's sounds from its spelling and gets some loanwords wrong. A word in words.json may
// carry `say`: its sounds as IPA, in the notation the model reads (the output of the `phonemizer` package
// after the replacements kokoro-js applies, with the stress marks ˈ and ˌ). When it is present the generator
// skips the guess and gives the model these sounds, for the word clip and for the sentence clip.
//
// This file has no dependencies, so the tests (tests/site.test.mjs) and the generator share it. The
// phonemizer itself is passed in by the generator (tools/clips/node_modules is not installed for `npm test`).

import { createHash } from 'node:crypto';

export const SAY_MAX_LENGTH = 80;

// The characters of the Kokoro tokenizer vocabulary (tokenizer.json, model revision pinned in generate.mjs)
// that a phonemizer can produce, plus ˈ ˌ ː and a space. Left out on purpose:
//   - r, x and ʲ: kokoro-js rewrites them (r to ɹ, x to k, ʲ to j) before the model sees them;
//   - plain g: not in the vocabulary (use ɡ, U+0261);
//   - digits, punctuation, quotes and the intonation arrows: not sounds.
// Combining tilde U+0303 (nasal vowels, as in French loanwords) is in the vocabulary.
export const SAY_CHARS = new Set(
  'abcdefhijklmnopqstuvwyz' + 'AIOQSTWY' +
    'ɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔʰᵻᵊᵝʣʥʦʨꭧ' +
    '̃' + 'ˈˌː' + ' ',
);

const show = ch => `"${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`;

// Returns a list of problems; an empty list means `say` is valid.
export function sayProblems(say) {
  if (typeof say !== 'string') return ['say must be a string'];
  if (!say.trim()) return ['say must not be empty or whitespace only'];
  const problems = [];
  if (say !== say.trim()) problems.push('say must not start or end with a space');
  if (say.length > SAY_MAX_LENGTH) problems.push(`say is ${say.length} characters; the limit is ${SAY_MAX_LENGTH}`);
  if (/ {2,}/.test(say)) problems.push('say must not contain two spaces in a row');
  if (/\d/.test(say)) problems.push('say must not contain digits');
  const bad = [...new Set([...say].filter(ch => !SAY_CHARS.has(ch)))];
  if (bad.length) {
    const hints = [];
    if (bad.includes('r')) hints.push('write ɹ (U+0279) for r');
    if (bad.includes('g')) hints.push('write ɡ (U+0261) for g');
    if (bad.includes('x')) hints.push('write k for x');
    problems.push(
      `say has characters outside the allowed set: ${bad.map(show).join(', ')}` +
        (hints.length ? ` (${hints.join('; ')})` : ''),
    );
  }
  return problems;
}

// The validated `say` of a words.json entry, or undefined when it has none. Throws with the word named.
export function sayOf(entry) {
  if (!Object.hasOwn(entry, 'say')) return undefined;
  const problems = sayProblems(entry.say);
  if (problems.length) throw new Error(`${entry.word}: ${problems.join('; ')}`);
  return entry.say;
}

// The per-clip fingerprint stored in each voice's manifest.json. A word with `say` adds it, so adding, changing or
// removing `say` re-records exactly that word's clips. Without `say` the hashed text is exactly what it was before
// `say` existed, so every existing clip stays valid.
export function clipFingerprint(text, voice, modelRevision, encoder, say) {
  const extra = say === undefined ? '' : `|say=${say}`;
  return createHash('sha256').update(`${text}|${voice}|${modelRevision}|${encoder}${extra}`).digest('hex').slice(0, 16);
}

const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Splits a sentence around its word (the same whole-word rule the tests use) into the text before and after.
// Returns null unless the word occurs exactly once and is set off by a space or punctuation on both sides, which
// is the only case where "left sounds + say + right sounds" matches what the model sees for a whole sentence
// (for example `abdicate's` or `'abdicate'` is refused rather than guessed).
export function splitAtWord(sentence, word) {
  const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(word)}(?![\\p{L}])`, 'giu');
  const hits = [...sentence.matchAll(re)];
  if (hits.length !== 1) return null;
  const left = sentence.slice(0, hits[0].index);
  const right = sentence.slice(hits[0].index + word.length);
  const startsOk = left === '' || /\s$/.test(left) || PUNCT.includes(left.at(-1));
  const endsOk = right === '' || /^\s/.test(right) || PUNCT.includes(right[0]);
  return startsOk && endsOk ? { left, right } : null;
}

// ---------------------------------------------------------------------------------------------------------
// A copy of how kokoro-js 1.2.1 (tools/clips/package.json) turns text into the phonemes the model reads:
// its internal function in dist/kokoro.js (normalise the text, split it at punctuation, phonemize the pieces
// with the `phonemizer` package, then apply the replacements). If kokoro-js changes, re-check this against
// `tts.stream(text)`, which yields the phonemes it used. `phonemize` is injected: (text, 'en-us') => string[].

const PUNCT_RUN = new RegExp(`(\\s*[${escapeRegExp(PUNCT)}]+\\s*)+`, 'g');

function yearOrTime(s) {
  if (s.includes('.')) return s;
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(Number);
    return m === 0 ? `${h} o'clock` : m < 10 ? `${h} oh ${m}` : `${h} ${m}`;
  }
  const year = parseInt(s.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return s;
  const head = s.slice(0, 2);
  const tail = parseInt(s.slice(2, 4), 10);
  const plural = s.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (tail === 0) return `${head} hundred${plural}`;
    if (tail < 10) return `${head} oh ${tail}${plural}`;
  }
  return `${head} ${tail}${plural}`;
}

function money(s) {
  const unit = s[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(s.slice(1)))) return `${s.slice(1)} ${unit}s`;
  if (!s.includes('.')) return `${s.slice(1)} ${unit}${s.slice(1) === '1' ? '' : 's'}`;
  const [whole, frac] = s.slice(1).split('.');
  const cents = parseInt(frac.padEnd(2, '0'), 10);
  const centWord = s[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence';
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${cents} ${centWord}`;
}

function decimal(s) {
  const [a, b] = s.split('.');
  return `${a} point ${b.split('').join(' ')}`;
}

export function normalizeText(text) {
  return text
    .replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/[“”]/g, '"')
    .replace(/\(/g, '«').replace(/\)/g, '»')
    .replace(/、/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/，/g, ', ')
    .replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/  +/, ' ') // not global in kokoro-js either
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, yearOrTime)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money)
    .replace(/\d*\.\d+/g, decimal)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, m => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

function splitKeeping(text, re) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (last < m.index) parts.push({ match: false, text: text.slice(last, m.index) });
    if (m[0].length > 0) parts.push({ match: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ match: false, text: text.slice(last) });
  return parts;
}

// Same as kokoro-js for a voice whose id starts with `a` (American English), the only kind this repo records.
export function makeKokoroPhonemizer(phonemize) {
  return async function phonemes(text, voiceLang = 'a') {
    const pieces = splitKeeping(normalizeText(text), PUNCT_RUN);
    const lang = voiceLang === 'a' ? 'en-us' : 'en';
    const joined = (await Promise.all(
      pieces.map(async ({ match, text: t }) => (match ? t : (await phonemize(t, lang)).join(' '))),
    )).join('');
    let out = joined
      .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
      .replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
      .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
      .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
    if (voiceLang === 'a') out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
    return out.trim();
  };
}

// The sounds for a whole sentence with the word's sounds replaced by `say`. `phonemes` is the function from
// makeKokoroPhonemizer.
//
// Preferred way: phonemize the whole sentence exactly as kokoro-js would, phonemize the bare word the same way,
// and swap the word's sounds for `say` where they occur once, set off by a space, punctuation or the ends.
// Everything else stays exactly what Kokoro would say, including the way the phonemizer softens little words
// ("a", "to", "the") and links sounds across the word boundary according to what follows them.
//
// Fallback, when the bare word's sounds are not found exactly once in the sentence (the phonemizer changed the
// word in context): split the sentence at the word, phonemize each side alone, and join left + say + right.
// A little word right before the word can then come out in its full form ("a" as "ay"). `onFallback`, if
// given, is called with the word so the generator can say so.
const BOUNDARY = `[\\s${escapeRegExp(PUNCT)}]`;

export async function sentencePhonemes(sentence, word, say, phonemes, { onFallback } = {}) {
  const parts = splitAtWord(sentence, word);
  if (!parts) {
    throw new Error(
      `${word}: cannot place "say" in the sentence (the word must appear once, as a whole word, ` +
        `with a space or punctuation on both sides): ${sentence}`,
    );
  }
  const full = await phonemes(sentence);
  const alone = await phonemes(word);
  if (alone) {
    const found = [...full.matchAll(new RegExp(`(?<=^|${BOUNDARY})${escapeRegExp(alone)}(?=$|${BOUNDARY})`, 'g'))];
    if (found.length === 1) return full.slice(0, found[0].index) + say + full.slice(found[0].index + alone.length);
  }
  onFallback?.(word);
  const { left, right } = parts;
  const l = left.trim() ? await phonemes(left) : '';
  const r = right.trim() ? await phonemes(right) : '';
  // Normalising trims the text, so put back a single space where the sentence had whitespace next to the word.
  return `${l}${l && /\s$/.test(left) ? ' ' : ''}${say}${r && /^\s/.test(right) ? ' ' : ''}${r}`.trim();
}

// Token ids for a `say` string. The tokenizer silently drops every character that is not in its vocabulary
// (its normalizer replaces them with nothing), so an unknown character would not fail by itself: the model would
// just say something else. Feed each distinct character alone: a known one gives exactly three ids (pad, the
// character, pad), an unknown one gives two. Any other count means the input is not what we think it is.
export function sayIds(tokenizer, say, label) {
  const unknown = [...new Set([...say])].filter(ch => tokenizer(ch, { truncation: true }).input_ids.dims.at(-1) !== 3);
  if (unknown.length) {
    throw new Error(`${label}: the Kokoro tokenizer does not know ${unknown.map(show).join(', ')} in say "${say}"`);
  }
  return tokenizer(say, { truncation: true }).input_ids;
}

// Token ids for a phoneme string that contains `say` (the sentence clip): check `say` alone, then tokenize all of it.
export function sentenceIds(tokenizer, phonemeText, say, label) {
  sayIds(tokenizer, say, label);
  return tokenizer(phonemeText, { truncation: true }).input_ids;
}
