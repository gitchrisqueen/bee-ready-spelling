// Enforces the CI standard documented in CLAUDE.md on every workflow in .github/workflows/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, '.github', 'workflows');
const workflows = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).map(f => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));

test('there is at least one workflow and each one is readable', () => {
  assert.ok(workflows.length >= 3);
});

test('permissions: contents: read is set at workflow level', () => {
  for (const { file, text } of workflows) {
    assert.match(text, /^permissions:\s*\n\s+contents:\s*read\b/m, `${file}: add workflow-level permissions: contents: read`);
  }
});

test('every job has timeout-minutes', () => {
  for (const { file, text } of workflows) {
    const jobs = (text.match(/^\s+runs-on:/gm) || []).length;
    const timeouts = (text.match(/^\s+timeout-minutes:\s*\d+/gm) || []).length;
    assert.ok(jobs > 0, `${file}: no jobs found`);
    assert.ok(timeouts >= jobs, `${file}: ${jobs} job(s) but ${timeouts} timeout-minutes`);
  }
});

test('every uploaded artifact sets retention-days between 1 and 14', () => {
  for (const { file, text } of workflows) {
    const steps = text.split(/\n\s+- name:/).filter(s => /upload-(pages-)?artifact@/.test(s));
    for (const step of steps) {
      const m = step.match(/retention-days:\s*(\d+)/);
      assert.ok(m, `${file}: an upload step has no retention-days`);
      assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= 14, `${file}: retention-days must be 1 to 14`);
    }
  }
});

test('push triggers are limited to main, and pull_request_target is never used', () => {
  for (const { file, text } of workflows) {
    assert.doesNotMatch(text, /pull_request_target/, `${file}: pull_request_target is banned`);
    const push = text.match(/^on:\s*\n([\s\S]*?)^\S/m)?.[1] ?? '';
    if (/^\s+push:/m.test(push)) {
      assert.match(push, /push:\s*\n\s+branches:\s*\[main\]/, `${file}: push must be limited to branches: [main]`);
    }
  }
});

test('the denylist guard is never behind a path filter', () => {
  const guard = workflows.find(w => w.file === 'denylist-guard.yml');
  assert.ok(guard, 'denylist-guard.yml is missing');
  assert.doesNotMatch(guard.text, /^\s+paths(-ignore)?:/m, 'a security gate must not use paths or paths-ignore');
});

test('PR checks cancel superseded runs and deploys are never cancelled', () => {
  const pages = workflows.find(w => w.file === 'pages.yml').text;
  assert.match(pages, /cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/);
  const guard = workflows.find(w => w.file === 'denylist-guard.yml').text;
  assert.match(guard, /cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/);
  const clips = workflows.find(w => w.file === 'generate-clips.yml').text;
  assert.match(clips, /cancel-in-progress:\s*false/);
});

test('third-party actions are pinned to a full commit SHA (first-party actions may use tags)', () => {
  for (const { file, text } of workflows) {
    for (const m of text.matchAll(/uses:\s*([^\s@]+)@(\S+)/g)) {
      const [, action, ref] = m;
      if (/^(actions|github)\//.test(action)) continue;
      assert.match(ref, /^[0-9a-f]{40}$/, `${file}: ${action} must be pinned to a full commit SHA`);
    }
  }
});

test('bot commits made by the clip workflow carry [skip ci]', () => {
  const clips = workflows.find(w => w.file === 'generate-clips.yml').text;
  assert.match(clips, /git commit -m "[^"]*\[skip ci\]"/);
});

test('repository hygiene files', () => {
  assert.ok(existsSync(join(root, 'CLAUDE.md')), 'CLAUDE.md is required');
  const lines = readFileSync(join(root, 'CLAUDE.md'), 'utf8').split('\n').length;
  assert.ok(lines <= 200, `CLAUDE.md is ${lines} lines (limit 200)`);
  assert.ok(!existsSync(join(root, 'CODEX_HANDOFF.md')), 'the publishing handoff file must stay removed');
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  assert.doesNotMatch(claude, /\/Users\/|CQC_VAULT|obsidian|iCloud|ClickUp/i, 'CLAUDE.md is public: no private paths or tool names');
  assert.ok(statSync(join(root, 'README.md')).size > 1000);
});
