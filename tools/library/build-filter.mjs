// Builds mine/filter.sha256 from an open-licensed word list. The output holds only SHA-256 hashes (one per line,
// sorted and unique) under '#' comment lines, so the repository never holds a plain word from the list.
//
// Usage:
//   node tools/library/build-filter.mjs <path-to-list> [--out mine/filter.sha256] [--date YYYY-MM-DD]
//
// Each entry is normalised the way mine/filter.js variants() normalises a token: accents stripped, lowercase,
// letters a-z only. Entries shorter than 2 letters are skipped. An entry with a digit or a symbol other than a
// hyphen or apostrophe is skipped, because stripping it would change what the entry means. A multi-word phrase is
// split into words only if every one of its words is itself a single-word entry of the list; otherwise it is skipped.
// The script prints counts only, never a word.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The list this file was built from (see mine/FILTER-NOTICE.md). Change these when the source changes.
export const SOURCE = Object.freeze({
  name: 'List of Dirty, Naughty, Obscene, and Otherwise Bad Words (English list, file "en"), LDNOOBW',
  url: 'https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words',
  commit: '5faf2ba42d7b1c0977169ec3611df25a3c08eb13',
  licence: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
  attribution: 'Copyright 2012-2020 Shutterstock, Inc.; licensed under CC BY 4.0. Hashed and filtered by this project.',
});

export function normalise(token) {
  return token.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

// Returns { hashes, stats } for the text of a list (one entry per line).
export function buildHashes(text) {
  const stats = { lines: 0, single: 0, phrasesSplit: 0, phrasesSkipped: 0, tooShort: 0, symbols: 0, duplicates: 0 };
  const singles = new Set();
  const phrases = [];
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#')) continue;
    stats.lines++;
    if (!/^[\p{L}'’ -]+$/u.test(entry)) { stats.symbols++; continue; }
    if (/\s/.test(entry)) { phrases.push(entry); continue; }
    const word = normalise(entry);
    if (word.length < 2) { stats.tooShort++; continue; }
    if (singles.has(word)) stats.duplicates++;
    singles.add(word);
  }
  stats.single = singles.size;
  const words = new Set(singles);
  for (const phrase of phrases) {
    const parts = phrase.split(/\s+/).map(normalise).filter(Boolean);
    if (parts.length > 1 && parts.every(p => p.length >= 2 && singles.has(p))) {
      stats.phrasesSplit++;
      parts.forEach(p => words.add(p));
    } else {
      stats.phrasesSkipped++;
    }
  }
  const hashes = [...words].map(w => createHash('sha256').update(w).digest('hex')).sort();
  return { hashes: [...new Set(hashes)], stats };
}

export function renderFile(hashes, { listSha256, date }) {
  const header = [
    '# Child-safety filter: SHA-256 of each normalised word, one per line, sorted. No plain words are stored.',
    `# Source: ${SOURCE.name}`,
    `# Source URL: ${SOURCE.url}`,
    `# Source commit: ${SOURCE.commit}`,
    `# Source file SHA-256: ${listSha256}`,
    `# Licence: ${SOURCE.licence}`,
    `# Generated: ${date} by tools/library/build-filter.mjs (see mine/FILTER-NOTICE.md)`,
    `# Hashes: ${hashes.length}`,
  ];
  return `${header.join('\n')}\n${hashes.join('\n')}\n`;
}

function main(argv) {
  const args = argv.slice(2);
  let input = null, out = join(root, 'mine', 'filter.sha256'), date = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = resolve(args[++i]);
    else if (args[i] === '--date') date = args[++i];
    else if (!input) input = args[i];
    else throw new Error(`unexpected argument: ${args[i]}`);
  }
  if (!input) {
    console.error('usage: node tools/library/build-filter.mjs <path-to-list> [--out file] [--date YYYY-MM-DD]');
    process.exit(2);
  }
  const raw = readFileSync(input);
  const listSha256 = createHash('sha256').update(raw).digest('hex');
  const { hashes, stats } = buildHashes(raw.toString('utf8'));
  if (hashes.length < 100) throw new Error(`only ${hashes.length} hashes: the input does not look like the word list`);
  writeFileSync(out, renderFile(hashes, { listSha256, date }));
  console.log(`wrote ${out}: ${hashes.length} hashes (input sha256 ${listSha256})`);
  console.log(JSON.stringify(stats));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
