import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, '_site');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'voice-service.js', 'sentences.js', 'stars.js', 'wordcard.js', 'words.json', '.nojekyll']) {
  const source = join(root, name);
  if (!existsSync(source)) throw new Error(`Missing public site file: ${name}`);
  copyFileSync(source, join(output, name));
}
cpSync(join(root, 'assets'), join(output, 'assets'), { recursive: true });
cpSync(join(root, 'fonts'), join(output, 'fonts'), { recursive: true });
// "My words": the page code and its safety list, and the static library. `lists/` (curated share lists) only if it
// exists.
cpSync(join(root, 'mine'), join(output, 'mine'), { recursive: true, filter: src => !statSync(src).isFile() || /\.(js|sha256)$/.test(src) }); // preflight: ok
cpSync(join(root, 'library'), join(output, 'library'), { recursive: true });
if (existsSync(join(root, 'lists'))) cpSync(join(root, 'lists'), join(output, 'lists'), { recursive: true });
// Pre-recorded voice clips (tools/clips). Manifests are build inputs, not site content.
if (existsSync(join(root, 'clips'))) {
  cpSync(join(root, 'clips'), join(output, 'clips'), { recursive: true, filter: src => !src.endsWith('manifest.json') });
}
console.log(`GitHub Pages site staged at ${output}`);
