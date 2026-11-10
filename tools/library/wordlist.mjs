// An extra word list for the library generator (`build.mjs --extra-words <file>`), so the library can grow beyond
// the NGSL seed. A list is plain text: one word or several per line, separated by spaces, commas or semicolons,
// with comment lines that start with `#`. Two comment lines are required, because every word in the library is
// credited to its source:
//   # source: <where the words come from>
//   # licence: <the licence they are available under>
// Words must be 2 or more lowercase letters (they become library keys). The generator still applies the child-safety
// filter, the sensitive-topic check and the size budget, and a word with no definition in the open sources is left out.
export function parseExtraWords(text) {
  const header = {};
  const words = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^#\s*(source|licen[cs]e)\s*:\s*(.+)$/i.exec(line);
      if (m) header[m[1].toLowerCase().startsWith('source') ? 'source' : 'licence'] = m[2].trim();
      continue;
    }
    for (const token of line.split(/[\s,;]+/)) {
      const word = token.toLowerCase();
      if (/^[a-z]{2,}$/.test(word)) words.push(word);
    }
  }
  if (!header.source || !header.licence) {
    throw new Error('an extra word list needs "# source:" and "# licence:" comment lines');
  }
  return { header, words: [...new Set(words)] };
}
