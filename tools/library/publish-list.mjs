// Publishes a list as `lists/<id>.json`, the file a link that has only `?mode=mine&l=<id>` opens
// (docs/my-words-plan.md, "Share links"). By hand, then a normal pull request.
// Never publish a child's real list: only lists the owner chose.
//   node tools/library/publish-list.mjs --name "Sample list: animals" --words elephant,giraffe,penguin
//   node tools/library/publish-list.mjs --name "Week 12" --words-file words.txt [--out lists]
// Prints the id and the share link path. Words are checked like typed words and the safety list; a word that is not
// allowed stops the run, and nothing is written.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlocklist, setBlocklist } from '../../mine/filter.js';
import { buildRegistryEntry } from '../../mine/registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = message => { console.error(`publish-list: ${message}`); process.exit(1); };

const args = { name: null, words: null, file: null, out: join(root, 'lists') };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--name') args.name = argv[++i];
  else if (argv[i] === '--words') args.words = argv[++i];
  else if (argv[i] === '--words-file') args.file = argv[++i];
  else if (argv[i] === '--out') args.out = resolve(argv[++i] ?? '');
  else fail(`unexpected argument: ${argv[i]}`);
}
if (!args.name || (!args.words && !args.file)) {
  fail('usage: node tools/library/publish-list.mjs --name "<list name>"'
    + ' (--words a,b,c | --words-file <file>) [--out lists]');
}
setBlocklist(parseBlocklist(readFileSync(join(root, 'mine', 'filter.sha256'), 'utf8')));
const text = args.file ? readFileSync(resolve(args.file), 'utf8') : args.words;
let entry;
try { entry = buildRegistryEntry(args.name, text.split(/[\s,;]+/).filter(Boolean)); } catch (e) { fail(e.message); }
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, `${entry.id}.json`), entry.text);
console.log(`wrote ${join(args.out, `${entry.id}.json`)}`);
console.log(`link: ?mode=mine&l=${entry.id}`);
