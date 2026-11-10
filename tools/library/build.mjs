// Builds library/<letter>.json (a-z) and library/NOTICE.md from the pinned inputs in tools/library/sources.json.
// Runs by hand, offline from the site. Not deployed. See tools/library/README.md.
//
// Usage:
//   node tools/library/build.mjs --inputs /tmp/library-inputs [--letter a] [--out library]
//
// Seed words: the New General Service List 1.2 (words in rank order; a lower rank has a higher priority).
// Per word, the first usable candidate wins:
//   definition: Simple English Wiktionary sense, else an Open English WordNet gloss;
//   sentence:   an example sentence from those same sources (never written here), kept only if it contains
//               the word exactly once as a whole word and passes cleanSourceField;
//   group:      originLabel() of the English Wiktionary etymology (see etymologyText below), omitted if null.
// Every field goes through the same validator the page uses (mine/validate.js), with the real filter loaded
// from mine/filter.sha256 before anything is validated. Words the filter blocks are skipped.
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { originLabel } from '../../mine/origin.js';
import { isBlockedWord, parseBlocklist, setBlocklist } from '../../mine/filter.js';
import { LIMITS, cleanField, cleanSourceField, sentenceHasWordOnce, validateEntry } from '../../mine/validate.js';
import { parseExtraWords } from './wordlist.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHARD_MAX = 150000;
const TOTAL_MAX = 3000000;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const SIMPLE_POS = { noun: 'n', verb: 'v', adj: 'adj', adv: 'adv', intj: 'interj' };
const OEWN_POS = { n: 'n', v: 'v', a: 'adj', s: 'adj', r: 'adv' };
const PART_ORDER = ['n', 'v', 'adj', 'adv', 'interj'];
// Simple Wiktionary sense tags that make a sense unsuitable for a child's definition.
// A library sentence is read aloud to a child, so it has no digits, quotation marks, brackets, colons, dashes
// (which often hold a source credit) or asterisks.
const PLAIN_SENTENCE = /^[^\d"“”()[\]:—–*]+$/u;
const SKIP_TAGS =new Set(['obsolete', 'archaic', 'dated', 'rare', 'offensive', 'vulgar', 'derogatory', 'slang']);

// ---------- inputs ----------

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', c => hash.update(c)).on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function verifyInputs(dir, sources) {
  const paths = {};
  for (const input of sources.inputs) {
    const path = join(dir, input.file);
    let size;
    try { size = statSync(path).size; } catch { fail(`missing input ${path} (${input.name}, ${input.url})`); }
    if (size !== input.bytes) fail(`${input.file}: ${size} bytes, sources.json says ${input.bytes}`);
    const digest = await sha256File(path);
    if (digest !== input.sha256) fail(`${input.file}: sha256 ${digest}, sources.json says ${input.sha256}`);
    console.log(`verified ${input.file} (${size} bytes)`);
    paths[input.id] = path;
  }
  return paths;
}

function loadFilter() {
  const hashes = parseBlocklist(readFileSync(join(root, 'mine', 'filter.sha256'), 'utf8'));
  if (hashes.length < 100) fail(`mine/filter.sha256 has only ${hashes.length} hashes`);
  setBlocklist(hashes);
  console.log(`filter loaded: ${hashes.length} hashes`);
}

function lineReader(path, gzip) {
  let stream = createReadStream(path);
  if (gzip) stream = stream.pipe(createGunzip());
  stream.setEncoding?.('utf8');
  return createInterface({ input: stream, crlfDelay: Infinity });
}

// ---------- seed words (NGSL 1.2) ----------

// `extra` is an optional parsed extra word list (wordlist.mjs). Its words rank after every NGSL word, so the budget
// cut drops them first.
function loadSeeds(path, letter, extra) {
  const seeds = new Map();
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1);
  let total = 0;
  for (const line of lines) {
    const lemma = line.split(',')[0].trim().toLowerCase();
    if (!lemma) continue;
    total++;
    if (!/^[a-z]{2,}$/.test(lemma) || seeds.has(lemma) || isBlockedWord(lemma)) continue;
    if (letter && lemma[0] !== letter) continue;
    seeds.set(lemma, seeds.size);
  }
  console.log(`seed list: ${total} rows, ${seeds.size} usable${letter ? ` (letter ${letter})` : ''}`);
  if (extra) {
    const before = seeds.size;
    for (const word of extra.words) {
      if (seeds.has(word) || isBlockedWord(word) || (letter && word[0] !== letter)) continue;
      seeds.set(word, seeds.size);
    }
    console.log(`extra word list: ${extra.words.length} words, ${seeds.size - before} new`);
  }
  return seeds;
}

// ---------- text helpers ----------

function finish(text) {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s[0].toLocaleUpperCase('en-US') + s.slice(1);
  return /[\p{L}\p{N}]$/u.test(s) ? `${s}.` : s;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlUnescape(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (m, dec, hex, name) => {
    if (name) return XML_ENTITIES[name];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

// English Wiktionary etymology_text starts with an "Etymology tree" block (one ancestor per line, ending with the
// line "English <word>") and later paragraphs about cognates and other words. originLabel() takes the first
// language named in the text, so only the first real paragraph is passed to it, cut before cognate and compare
// remarks. A text with a tree block but no "English <word>" line gives null (never a guess).
export function etymologyText(text) {
  if (typeof text !== 'string') return null;
  let lines = text.split('\n');
  if (lines[0].trim() === 'Etymology tree') {
    const end = lines.findIndex((l, i) => i > 0 && /^English \S/.test(l));
    if (end < 0) return null;
    lines = lines.slice(end + 1);
  }
  const paragraph = lines.map(l => l.trim()).find(l => l.length > 0);
  if (!paragraph) return null;
  const cut = paragraph.search(/\b(?:cognates?|compare|doublet of|displaced|eclipsed|related to|more at)\b/i);
  return (cut > 0 ? paragraph.slice(0, cut) : paragraph).trim() || null;
}

// ---------- readers for the three dictionary inputs ----------

async function readSimple(path, seeds) {
  const byWord = new Map();
  for await (const line of lineReader(path, true)) {
    if (!line) continue;
    const d = JSON.parse(line);
    if (d.lang_code !== 'en' || !seeds.has(d.word)) continue;
    const part = SIMPLE_POS[d.pos];
    if (!part) continue;
    const cands = byWord.get(d.word) ?? [];
    for (const sense of d.senses ?? []) {
      if (sense.form_of || sense.alt_of || (sense.tags ?? []).some(t => t === 'no-gloss' || SKIP_TAGS.has(t))) continue;
      const gloss = Array.isArray(sense.glosses) ? sense.glosses[sense.glosses.length - 1] : null;
      if (typeof gloss !== 'string') continue;
      const examples = (sense.examples ?? []).map(e => e?.text).filter(t => typeof t === 'string');
      cands.push({ source: 'simple-wiktionary', part, definition: gloss, examples });
    }
    if (cands.length) byWord.set(d.word, cands);
  }
  return byWord;
}

async function readOewn(path, seeds) {
  const entries = new Map(); // word -> [{ part, synsets }]
  const needed = new Set();
  const synsets = new Map(); // id -> { definition, examples }
  let cur = null, syn = null;
  for await (const raw of lineReader(path, true)) {
    const line = raw.trim();
    if (line.startsWith('<LexicalEntry ')) {
      cur = { lemma: null, part: null, synsets: [] };
    } else if (cur && line.startsWith('<Lemma ')) {
      const m = /writtenForm="([^"]*)" partOfSpeech="([a-z])"/.exec(line);
      if (m) { cur.lemma = xmlUnescape(m[1]); cur.part = OEWN_POS[m[2]] ?? null; }
    } else if (cur && line.startsWith('<Sense ')) {
      const m = /synset="([^"]+)"/.exec(line);
      if (m) cur.synsets.push(m[1]);
    } else if (line.startsWith('</LexicalEntry>')) {
      if (cur && cur.part && seeds.has(cur.lemma) && cur.synsets.length) {
        const list = entries.get(cur.lemma) ?? [];
        list.push({ part: cur.part, synsets: cur.synsets });
        entries.set(cur.lemma, list);
        cur.synsets.forEach(id => needed.add(id));
      }
      cur = null;
    } else if (line.startsWith('<Synset ')) {
      const m = /^<Synset id="([^"]+)"/.exec(line);
      syn = m && needed.has(m[1]) ? { id: m[1], definition: null, examples: [] } : null;
    } else if (syn && line.startsWith('<Definition')) {
      const m = /^<Definition[^>]*>(.*)<\/Definition>/.exec(line);
      if (m) syn.definition = xmlUnescape(m[1]);
    } else if (syn && line.startsWith('<Example')) {
      const m = /^<Example[^>]*>(.*)<\/Example>/.exec(line);
      if (m) syn.examples.push(xmlUnescape(m[1]));
    } else if (line.startsWith('</Synset>')) {
      if (syn) synsets.set(syn.id, syn);
      syn = null;
    }
  }
  const missing = [...needed].filter(id => !synsets.has(id)).length;
  if (missing) fail(`${missing} WordNet synsets referenced by seed words were not found; is the file in a new order?`);
  const byWord = new Map();
  for (const [word, list] of entries) {
    list.sort((a, b) => b.synsets.length - a.synsets.length || PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
    const cands = [];
    for (const e of list) {
      for (const id of e.synsets) {
        const s = synsets.get(id);
        if (s.definition) cands.push({ source: 'oewn', part: e.part, definition: s.definition, examples: s.examples });
      }
    }
    if (cands.length) byWord.set(word, cands);
  }
  return byWord;
}

async function readEtymology(path, seeds) {
  const byWord = new Map(); // word -> [{ part, label }]
  const marker = '", "lang": "English", "lang_code": "en"';
  let lines = 0;
  for await (const line of lineReader(path, false)) {
    lines++;
    const end = line.indexOf(marker);
    if (end < 0 || !line.includes('"etymology_text"')) continue;
    const start = line.lastIndexOf('"word": "', end);
    if (start < 0 || !seeds.has(line.slice(start + 9, end))) continue;
    const d = JSON.parse(line);
    const label = originLabel(etymologyText(d.etymology_text));
    if (!label) continue;
    const list = byWord.get(d.word) ?? [];
    list.push({ part: SIMPLE_POS[d.pos] ?? null, label });
    byWord.set(d.word, list);
  }
  console.log(`english extract: ${lines} lines read, origin labels for ${byWord.size} seed words`);
  return byWord;
}

// ---------- one entry ----------

function buildEntry(word, cands, origins) {
  let chosen = null, definition = null;
  // A definition that opens with a bracketed usage note is used only if no other candidate works (stable sort).
  const bracketed = c => Number(c.definition.startsWith('('));
  const byOpening = [...cands].sort((a, b) => bracketed(a) - bracketed(b));
  for (const c of byOpening) {
    const text = finish(c.definition);
    const plain = cleanField(text, LIMITS.definition);
    if (!plain) continue;
    // The best definition touches a sensitive topic: leave the word out rather than show a lesser sense of it.
    if (!cleanSourceField(text, LIMITS.definition)) return null;
    definition = plain; chosen = c; break;
  }
  if (!chosen) return null;
  const entry = { part: chosen.part, definition };
  const ordered = [chosen, ...cands.filter(c => c !== chosen && c.part === chosen.part)];
  let sentence = null, sentenceSource = null;
  for (const c of ordered) {
    for (const text of c.examples) {
      const s = PLAIN_SENTENCE.test(text) ? cleanSourceField(finish(text), LIMITS.sentence, { example: true }) : null;
      if (s && sentenceHasWordOnce(s, word)) { sentence = s; sentenceSource = c.source; break; }
    }
    if (sentence) break;
  }
  const labels = origins.get(word) ?? [];
  const label = (labels.find(o => o.part === chosen.part) ?? labels[0])?.label ?? null;
  const group = label ? cleanSourceField(label, LIMITS.origin) : null;
  if (group) entry.group = group;
  if (sentence) entry.sentence = sentence;
  // The page's own validator has the last word: anything it would drop is dropped here too.
  const checked = validateEntry({ id: 1, word, src: 'library', ...entry });
  if (!checked || checked.definition !== definition) return null;
  const out = { part: checked.part, definition: checked.definition };
  if (checked.group) out.group = checked.group;
  if (checked.sentence) out.sentence = checked.sentence;
  return { entry: out, defSource: chosen.source, sentSource: out.sentence ? sentenceSource : null };
}

// ---------- shards ----------

const shardText = words => {
  const keys = [...words.keys()].sort();
  const rows = keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(words.get(k).entry)}`);
  return rows.length ? `{\n${rows.join(',\n')}\n}\n` : '{}\n';
};
const byteSize = words => Buffer.byteLength(shardText(words));

// Cuts the lowest-priority words (highest NGSL rank) until every shard and the whole library fit the budget.
function fitBudget(shards, checkTotal) {
  const dropped = [];
  const dropLowest = words => {
    let worst = null;
    for (const [w, v] of words) if (!worst || v.rank > words.get(worst).rank) worst = w;
    words.delete(worst);
    dropped.push(worst);
  };
  for (const words of shards.values()) while (words.size && byteSize(words) > SHARD_MAX) dropLowest(words);
  if (checkTotal) {
    let total = [...shards.values()].reduce((n, w) => n + byteSize(w), 0);
    while (total > TOTAL_MAX) {
      let target = null;
      for (const words of shards.values()) {
        for (const [, v] of words) {
          if (!target || v.rank > target.rank) target = { rank: v.rank, words };
        }
      }
      const before = byteSize(target.words);
      dropLowest(target.words);
      total -= before - byteSize(target.words);
    }
  }
  return dropped;
}

// ---------- NOTICE ----------

function noticeText(sources, stats, counts, extra) {
  const by = Object.fromEntries(sources.inputs.map(i => [i.id, i]));
  const used = id => (id === 'ngsl' ? true : id === 'english-wiktionary' ? stats.group > 0
    : (stats.definition[id] ?? 0) + (stats.sentence[id] ?? 0) > 0);
  const block = id => {
    const s = by[id];
    return [`### ${s.name}`, '', `- Source: ${s.url}`, `- Licence: ${s.licence} (${s.licenceUrl})`,
      `- Attribution: ${s.attribution}`, `- File used: \`${s.file}\`, ${s.bytes} bytes, SHA-256 \`${s.sha256}\`,`
      + ` measured ${s.measured}`];
  };
  const out = [
    '# Library notice: sources and licences', '',
    'Each `library/<letter>.json` shard is a derived data set. Every text field in it comes from the open sources'
    + ' below. Nothing in a shard was written by a model or by this project; the only changes made are'
    + ' listed under "What was changed".', '',
    '| Field | Where it comes from |', '|---|---|',
    `| Word (the key) | Chosen from the ${by.ngsl.name} (${counts.words} words kept) |`,
    `| \`part\`, \`definition\` | Simple English Wiktionary (${stats.definition['simple-wiktionary'] ?? 0} words),`
    + ` otherwise Open English WordNet (${stats.definition.oewn ?? 0} words) |`,
    `| \`sentence\` | An example sentence from Simple English Wiktionary (${stats.sentence['simple-wiktionary'] ?? 0}),`
    + ` otherwise from Open English WordNet (${stats.sentence.oewn ?? 0}) |`,
    `| \`group\` | The language named in the English Wiktionary etymology (${stats.group} words) |`, '',
    '## Licences', '',
    '- Text derived from Wiktionary (Simple English Wiktionary and English Wiktionary) is licensed under'
    + ' CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Share-alike applies to that text.',
    '- Text derived from Open English WordNet is licensed under CC BY 4.0'
    + ' (https://creativecommons.org/licenses/by/4.0/) and carries the Princeton WordNet notice below.',
    '- The word selection comes from the New General Service List, licensed under CC BY-SA 4.0.',
    '- The rest of the repository keeps its own terms; this notice covers the files in `library/`.', '',
    '## Sources', '',
  ];
  for (const id of ['ngsl', 'simple-wiktionary', 'oewn', 'english-wiktionary']) {
    if (used(id)) out.push(...block(id), '');
  }
  if (extra) {
    out.push('### Extra word list', '', `- Source: ${extra.header.source}`, `- Licence: ${extra.header.licence}`,
      `- Words offered: ${extra.words.length}; a word is kept only if the open sources above give it a definition`, '');
  }
  out.push(
    '## Princeton WordNet notice', '',
    'Open English WordNet is derived from Princeton WordNet. Its licence file (`WNDB_License.txt` in',
    'https://github.com/globalwordnet/english-wordnet) reads:', '',
    '> This software and database is being provided to you, the LICENSEE, by the Open English Wordnet team under the',
    '> Creative Commons Attribution 4.0 International License (CC-BY 4.0).',
    '>',
    '> Open English Wordnet 2023 Copyright 2023 by the Open English Wordnet team.',
    '>',
    '> Permission to use, copy, modify and distribute this software and database and its documentation for any',
    '> purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following',
    '> copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the',
    '> software, database and documentation, including modifications that you make for internal use or for',
    '> distribution.',
    '>',
    '> WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.',
    '>',
    '> THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR',
    '> WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO',
    '> REPRESENTATIONS OR WARRANTIES OF MERCHANT- ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF',
    '> THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS,',
    '> TRADEMARKS OR OTHER RIGHTS.',
    '>',
    '> The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to',
    '> distribution of the software and/or database. Title to copyright in this software, database and any',
    '> associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve',
    '> same.', '',
    '## What was changed', '',
    '- A definition or sentence has its first letter capitalised and a full stop added where it had no final mark.',
    '- A sentence is kept only if it contains its word exactly once as a whole word; a definition or sentence that is',
    `  over its length cap (${LIMITS.definition} and ${LIMITS.sentence} characters), or that holds markup, a link or a`,
    '  word the child-safety filter blocks, is dropped.',
    '- The origin label is the first non-English language named in the first paragraph of the English Wiktionary',
    '  etymology, mapped to a base name (for example "Old French" becomes "French").',
    '- Words are listed in code-point order, one entry per line.', '',
    '## Corrections and complaints', '',
    'A bad definition or sentence, or a licence or attribution problem, is fixed by pull request in this repository.',
    'See "Ownership and incidents" in `docs/my-words-plan.md`.', '',
  );
  return out.join('\n');
}

// ---------- main ----------

async function main(argv) {
  const args = { inputs: null, letter: null, out: join(root, 'library'), extraWords: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--inputs') args.inputs = resolve(argv[++i] ?? '');
    else if (argv[i] === '--extra-words') args.extraWords = resolve(argv[++i] ?? '');
    else if (argv[i] === '--letter') args.letter = argv[++i];
    else if (argv[i] === '--out') args.out = resolve(argv[++i] ?? '');
    else fail(`unexpected argument: ${argv[i]}`);
  }
  if (!args.inputs) {
    fail('usage: node tools/library/build.mjs --inputs <dir> [--letter a] [--out library] [--extra-words <file>]');
  }
  if (args.letter && !/^[a-z]$/.test(args.letter)) fail('--letter must be one lowercase letter a-z');

  const sources = JSON.parse(readFileSync(join(root, 'tools', 'library', 'sources.json'), 'utf8'));
  const paths = await verifyInputs(args.inputs, sources);
  loadFilter();
  let extra = null;
  if (args.extraWords) {
    try { extra = parseExtraWords(readFileSync(args.extraWords, 'utf8')); } catch (e) { fail(e.message); }
  }
  const seeds = loadSeeds(paths.ngsl, args.letter, extra);

  const [simple, oewn, origins] = await Promise.all([
    readSimple(paths['simple-wiktionary'], seeds), readOewn(paths.oewn, seeds),
    readEtymology(paths['english-wiktionary'], seeds),
  ]);
  console.log(`definitions found: simple ${simple.size}, wordnet ${oewn.size}`);

  const shards = new Map(LETTERS.map(l => [l, new Map()]));
  for (const [word, rank] of seeds) {
    const cands = [...(simple.get(word) ?? []), ...(oewn.get(word) ?? [])];
    const built = cands.length ? buildEntry(word, cands, origins) : null;
    if (built) shards.get(word[0]).set(word, { ...built, rank });
  }
  const dropped = fitBudget(shards, !args.letter);
  if (dropped.length) console.log(`budget: dropped ${dropped.length} lowest-priority words`);
  // Counts come from the words that are actually written, after the budget cut.
  const stats = { definition: {}, sentence: {}, group: 0 };
  for (const words of shards.values()) {
    for (const v of words.values()) {
      stats.definition[v.defSource] = (stats.definition[v.defSource] ?? 0) + 1;
      if (v.sentSource) stats.sentence[v.sentSource] = (stats.sentence[v.sentSource] ?? 0) + 1;
      if (v.entry.group) stats.group++;
    }
  }

  mkdirSync(args.out, { recursive: true });
  let total = 0, words = 0;
  for (const letter of LETTERS) {
    if (args.letter && letter !== args.letter) continue;
    const text = shardText(shards.get(letter));
    writeFileSync(join(args.out, `${letter}.json`), text);
    total += Buffer.byteLength(text);
    words += shards.get(letter).size;
    console.log(`${letter}.json: ${shards.get(letter).size} words, ${Buffer.byteLength(text)} bytes`);
  }
  if (!args.letter) {
    writeFileSync(join(args.out, 'NOTICE.md'), noticeText(sources, stats, { words }, extra));
    console.log(`library/NOTICE.md written`);
  }
  console.log(`done: ${words} words, ${total} bytes; definitions ${JSON.stringify(stats.definition)},`
    + ` sentences ${JSON.stringify(stats.sentence)}, origins ${stats.group}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv);
