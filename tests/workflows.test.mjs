// Enforces the CI standard documented in CLAUDE.md on every workflow in .github/workflows/.
// No YAML library is available, so workflows are parsed by indentation: jobs are the keys at two spaces
// under `jobs:`, job settings sit at four spaces, steps start with "- " at six spaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, '.github', 'workflows');
const read = rel => readFileSync(join(root, rel), 'utf8');

// Drops full-line comments and trailing " # ..." comments on lines without quotes.
export function stripComments(text) {
  return text
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .map(line => (/["']/.test(line) ? line : line.replace(/ #.*$/, '')))
    .join('\n');
}

export function parseWorkflow(file, raw) {
  const text = stripComments(raw);
  const lines = text.split('\n');
  const jobsAt = lines.findIndex(l => /^jobs:\s*$/.test(l));
  assert.ok(jobsAt >= 0, `${file}: no jobs: section`);
  const header = lines.slice(0, jobsAt).join('\n');
  const jobs = [];
  let current = null;
  for (const line of lines.slice(jobsAt + 1)) {
    if (/^\S/.test(line)) break; // next top-level key ends the jobs section
    const key = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (key) {
      current = { name: key[1], lines: [] };
      jobs.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  for (const job of jobs) {
    job.text = job.lines.join('\n');
    // Job-level settings only: exactly four spaces of indent.
    job.timeout = job.lines.some(l => /^ {4}timeout-minutes:\s*\d+\s*$/.test(l));
    job.condition = job.lines.filter(l => /^ {4}if:/.test(l)).join('\n');
    job.writes = permissionWrites(job.lines);
    job.steps = splitSteps(job.lines);
  }
  return { file, raw, text, header, jobs, job: name => jobs.find(j => j.name === name) };
}

// Scopes granted `write` (or write-all) by a `permissions:` block at four spaces of indent.
function permissionWrites(lines) {
  const out = new Set();
  const at = lines.findIndex(l => /^ {4}permissions:/.test(l));
  if (at < 0) return out;
  assert.match(lines[at], /^ {4}permissions:\s*$/, 'permissions must be a block, not an inline value');
  for (const line of lines.slice(at + 1)) {
    if (!/^ {5,}\S/.test(line)) break;
    const m = line.match(/^\s+([a-z-]+):\s*(\S+)\s*$/);
    if (m && m[2] !== 'read' && m[2] !== 'none') out.add(`${m[1]}:${m[2]}`);
  }
  return out;
}

function splitSteps(lines) {
  const steps = [];
  let current = null;
  for (const line of lines) {
    if (/^ {6}- /.test(line)) {
      current = [line];
      steps.push(current);
    } else if (current && (/^ {8,}\S/.test(line) || /^\s*$/.test(line))) {
      current.push(line);
    } else if (/^ {4}\S/.test(line)) {
      current = null; // a job-level key after the steps
    }
  }
  return steps.map(l => ({ text: l.join('\n'), lines: l }));
}

// Text of every `run:` value (inline or block scalar) in a step.
function runBodies(step) {
  const bodies = [];
  const { lines } = step;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(- )?run:\s*(.*)$/);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    const body = [m[3]];
    for (let j = i + 1; j < lines.length; j += 1) {
      const indent = lines[j].match(/^\s*/)[0].length;
      if (lines[j].trim() !== '' && indent <= keyIndent) break;
      body.push(lines[j]);
    }
    bodies.push(body.join('\n'));
  }
  return bodies;
}

const workflows = readdirSync(dir)
  .filter(f => /\.ya?ml$/.test(f))
  .map(f => parseWorkflow(f, readFileSync(join(dir, f), 'utf8')));
const wf = name => {
  const found = workflows.find(w => w.file === name);
  assert.ok(found, `${name} is missing`);
  return found;
};

// The only jobs allowed to hold a write permission, and which scopes they may hold.
const ALLOWED_WRITES = {
  'generate-clips.yml': { commit: ['contents:write'], 'start-deploy': ['actions:write'] },
  'pages.yml': { deploy: ['pages:write', 'id-token:write'] },
};

test('there is at least one workflow and each one is readable', () => {
  assert.ok(workflows.length >= 3);
  for (const w of workflows) assert.ok(w.jobs.length > 0, `${w.file}: no jobs found`);
});

test('permissions: contents: read is set at workflow level, and nothing at workflow level writes', () => {
  for (const { file, raw, header } of workflows) {
    assert.match(raw, /^permissions:\s*\n\s+contents:\s*read\b/m, `${file}: add workflow-level permissions: contents: read`);
    assert.doesNotMatch(header, /:\s*write\b|write-all/, `${file}: workflow-level permissions must not write`);
  }
});

test('every job has its own job-level timeout-minutes (a step-level one does not count)', () => {
  for (const { file, jobs } of workflows) {
    for (const job of jobs) assert.ok(job.timeout, `${file}: job "${job.name}" has no job-level timeout-minutes`);
  }
});

test('write permissions exist only in the jobs that need them (the privilege split)', () => {
  for (const { file, jobs, text } of workflows) {
    assert.doesNotMatch(text, /write-all/, `${file}: write-all is banned`);
    const allowed = ALLOWED_WRITES[file] ?? {};
    for (const job of jobs) {
      assert.deepEqual([...job.writes].sort(), [...(allowed[job.name] ?? [])].sort(), `${file}: job "${job.name}" has the wrong write permissions`);
    }
    for (const name of Object.keys(allowed)) assert.ok(jobs.some(j => j.name === name), `${file}: expected job "${name}"`);
    // Every write line in the file must sit inside a parsed job's permissions block (never anywhere else).
    const total = (text.match(/^\s+(contents|actions|pages|id-token|packages|issues|pull-requests|statuses|checks|deployments):\s*write\b/gm) || []).length;
    const counted = jobs.reduce((n, j) => n + j.writes.size, 0);
    assert.equal(total, counted, `${file}: a write permission sits outside a job-level permissions block`);
  }
});

test('commit holds no actions: write and start-deploy holds nothing but actions: write', () => {
  const clips = wf('generate-clips.yml');
  assert.deepEqual([...clips.job('commit').writes], ['contents:write']);
  assert.deepEqual([...clips.job('start-deploy').writes], ['actions:write']);
  assert.match(clips.job('start-deploy').text, /^ {4}permissions:\s*\n {6}actions:\s*write\s*\n(?! {6}\S)/m, 'start-deploy permissions must be only actions: write');
});

test('the plan and generate jobs check out without stored credentials; so do the pages jobs', () => {
  const checkouts = (job) => job.steps.filter(s => /uses:\s*actions\/checkout@/.test(s.text));
  const clips = wf('generate-clips.yml');
  for (const name of ['plan', 'generate']) {
    const found = checkouts(clips.job(name));
    assert.ok(found.length > 0, `${name} has no checkout`);
    for (const step of found) assert.match(step.text, /^\s+persist-credentials:\s*false\s*$/m, `${name}: checkout must set persist-credentials: false`);
  }
  for (const job of wf('pages.yml').jobs) {
    for (const step of checkouts(job)) assert.match(step.text, /^\s+persist-credentials:\s*false\s*$/m, `pages ${job.name}: checkout must set persist-credentials: false`);
  }
});

test('npm ci always carries --ignore-scripts', () => {
  for (const { file, jobs } of workflows) {
    for (const job of jobs) {
      for (const step of job.steps) {
        for (const body of runBodies(step)) {
          for (const line of body.split('\n').filter(l => /\bnpm\s+(ci|install|i)\b/.test(l))) {
            assert.match(line, /--ignore-scripts/, `${file}: "${line.trim()}" must use --ignore-scripts`);
          }
        }
      }
    }
  }
  assert.match(wf('generate-clips.yml').text, /npm ci --ignore-scripts/);
});

test('workflow inputs reach the shell only through env:', () => {
  for (const { file, jobs } of workflows) {
    for (const job of jobs) {
      for (const step of job.steps) {
        for (const body of runBodies(step)) {
          assert.doesNotMatch(body, /\$\{\{\s*(github\.event\.)?inputs\./, `${file}: a run: block uses inputs directly; pass it through env:`);
        }
      }
    }
  }
});

test('the commit and start-deploy jobs only run on refs/heads/main', () => {
  const clips = wf('generate-clips.yml');
  for (const name of ['plan', 'commit', 'start-deploy']) {
    assert.ok(clips.job(name).condition.includes("github.ref == 'refs/heads/main'"), `${name}: if: must contain github.ref == 'refs/heads/main'`);
  }
});

test('commit exposes pushed, and start-deploy needs it and runs last', () => {
  const clips = wf('generate-clips.yml');
  const commit = clips.job('commit');
  assert.match(commit.text, /^ {4}outputs:\s*\n {6}pushed:\s*\$\{\{\s*steps\.push\.outputs\.pushed\s*\}\}/m);
  assert.match(commit.text, /echo "pushed=true" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(clips.text, /GITHUB_ENV/, 'do not pass state between steps through GITHUB_ENV');
  assert.doesNotMatch(commit.text, /gh workflow run/, 'commit must not start workflows');
  const start = clips.job('start-deploy');
  assert.match(start.text, /^ {4}needs:\s*commit\s*$/m);
  assert.ok(start.condition.includes('!cancelled()'));
  assert.ok(start.condition.includes("needs.commit.outputs.pushed == 'true'"));
  assert.match(start.text, /gh workflow run "\$wf" --ref main/);
  assert.match(start.text, /pages\.yml denylist-guard\.yml/);
  assert.match(start.text, /for attempt in 1 2 3/);
  assert.ok(clips.jobs.at(-1).name === 'start-deploy', 'start-deploy must be the last job');
  assert.equal(start.steps.length, 1, 'start-deploy is one small step');
});

test('actions/cache and every non-first-party action is pinned to a full SHA with a version comment', () => {
  for (const { file, raw } of workflows) {
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(?:-\s+)?uses:\s*([^\s@]+)@(\S+)(.*)$/);
      if (!m) continue;
      const [, action, ref, rest] = m;
      if (/^(actions|github)\//.test(action) && action !== 'actions/cache') continue;
      assert.match(ref, /^[0-9a-f]{40}$/, `${file}: ${action} must be pinned to a full commit SHA`);
      assert.match(rest, /^\s+#\s*v\d\S*\s*$/, `${file}: ${action} needs a trailing "# vX.Y.Z" comment`);
    }
  }
});

test('push triggers are limited to main; pull_request_target and workflow_run are never used', () => {
  for (const { file, text } of workflows) {
    assert.doesNotMatch(text, /pull_request_target/, `${file}: pull_request_target is banned`);
    const lines = text.split('\n');
    const onAt = lines.findIndex(l => /^["']?on["']?:/.test(l));
    assert.ok(onAt >= 0, `${file}: no on: section`);
    assert.match(lines[onAt], /^["']?on["']?:\s*$/, `${file}: on: must be a block, not an inline value such as [push]`);
    const block = [];
    for (const line of lines.slice(onAt + 1)) {
      if (/^\S/.test(line)) break;
      block.push(line);
    }
    const on = block.join('\n');
    assert.doesNotMatch(on, /^\s+workflow_run:/m, `${file}: workflow_run is banned`);
    if (/^\s+push:/m.test(on)) {
      assert.match(on, /^ {2}push:\s*\n {4}branches:\s*\[main\]\s*$/m, `${file}: push must be limited to branches: [main]`);
    }
  }
});

test('the trigger checks bite on inline, comment and workflow_run cases (fixtures)', () => {
  const bad = (src) => {
    const text = stripComments(src);
    const lines = text.split('\n');
    const onAt = lines.findIndex(l => /^["']?on["']?:/.test(l));
    if (!/^["']?on["']?:\s*$/.test(lines[onAt])) return 'inline';
    if (/^\s+workflow_run:/m.test(text)) return 'workflow_run';
    if (/pull_request_target/.test(text)) return 'prt';
    return null;
  };
  assert.equal(bad('on: [push]\njobs:\n'), 'inline');
  assert.equal(bad('on: push\n'), 'inline');
  assert.equal(bad('on:\n  workflow_run:\n    workflows: [x]\n'), 'workflow_run');
  assert.equal(bad('on:\n  pull_request_target:\n'), 'prt');
  assert.equal(bad('on:\n  pull_request:\n# pull_request_target is banned\n'), null, 'a comment must not trip the check');
});

test('the parser separates job-level from step-level settings (fixtures)', () => {
  const src = 'name: x\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - name: s\n        timeout-minutes: 5\n        run: echo\n  b:\n    runs-on: ubuntu-latest\n    timeout-minutes: 3\n    permissions:\n      contents: write\n    steps:\n      - run: echo\n';
  const w = parseWorkflow('fixture', src);
  assert.equal(w.job('a').timeout, false, 'a step-level timeout must not count');
  assert.equal(w.job('b').timeout, true);
  assert.deepEqual([...w.job('b').writes], ['contents:write']);
  assert.equal(w.job('a').writes.size, 0);
});

test('the denylist guard is never behind a path filter', () => {
  assert.doesNotMatch(wf('denylist-guard.yml').text, /^\s+paths(-ignore)?:/m, 'a security gate must not use paths or paths-ignore');
});

test('every uploaded artifact sets retention-days between 1 and 14', () => {
  for (const { file, jobs } of workflows) {
    for (const job of jobs) {
      for (const step of job.steps.filter(s => /upload-(pages-)?artifact@/.test(s.text))) {
        const m = step.text.match(/retention-days:\s*(\d+)/);
        assert.ok(m, `${file}: an upload step has no retention-days`);
        assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= 14, `${file}: retention-days must be 1 to 14`);
      }
    }
  }
});

test('PR checks cancel superseded runs and deploys are never cancelled', () => {
  const cancel = /cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/;
  assert.match(wf('pages.yml').text, cancel);
  assert.match(wf('denylist-guard.yml').text, cancel);
  assert.match(wf('generate-clips.yml').text, /cancel-in-progress:\s*false/);
});

test('bot commits made by the clip workflow carry [skip ci]', () => {
  assert.match(wf('generate-clips.yml').raw, /git commit -m "[^"]*\[skip ci\]"/);
});

test('the clip validator checks the bytes it copies', () => {
  const run = wf('generate-clips.yml').text;
  // settings.json: read at most 5000, reject over 4000, write the validated bytes, never copy the file.
  assert.match(run, /fh\.read\(5000\)/);
  assert.match(run, /len\(raw\) > 4000/);
  assert.match(run, /open\(dst, "wb"\)[\s\S]{0,40}fh\.write\(raw\)/);
  assert.doesNotMatch(run, /copyfile/, 'copyfile would copy bytes that were not validated');
  assert.doesNotMatch(run, /json\.load\(/, 'use json.loads on bytes that were size-checked');
  // manifest.json: getsize before parsing.
  const sizeAt = run.indexOf('os.path.getsize(fp) >= 1000000');
  const parseAt = run.indexOf('json.loads(raw_manifest)');
  assert.ok(sizeAt > 0 && parseAt > sizeAt, 'manifest.json size must be checked before it is parsed');
});

// ---- hosted fallback and deploy independence ----

const fetchScript = read('scripts/fetch-voice-assets.mjs');
const REVISION = fetchScript.match(/const REVISION = '([0-9a-f]{40})'/)?.[1];

test('the fetch script retries, times out and caps the stream, and still verifies size and hash', () => {
  assert.ok(REVISION, 'REVISION must be a 40-hex constant in scripts/fetch-voice-assets.mjs');
  assert.match(fetchScript, /MAX_ATTEMPTS = 3/);
  assert.match(fetchScript, /AbortSignal\.timeout\(/);
  assert.match(fetchScript, /BIG_TIMEOUT_MS = 300_000/);
  assert.match(fetchScript, /SMALL_TIMEOUT_MS = 60_000/);
  assert.match(fetchScript, /2 \*\* \(attempt - 1\)/);
  assert.match(fetchScript, /more than the pinned/);
  assert.match(fetchScript, /Size mismatch/);
  assert.match(fetchScript, /SHA-256 mismatch/);
  assert.match(fetchScript, /existsSync\(target\) && \(await sha256\(target\)\) === expected/, 'an existing file must be re-hashed');
});

test('pages deploy caches the pinned voice model between the build and the fetch', () => {
  const steps = wf('pages.yml').job('deploy').steps.map(s => s.text);
  const at = re => steps.findIndex(s => re.test(s));
  const build = at(/run:\s*npm run build/);
  const cache = at(/uses:\s*actions\/cache@/);
  const fetchStep = at(/npm run fetch-voice-assets/);
  assert.ok(build >= 0 && cache > build && fetchStep > cache, 'order must be build, cache, fetch');
  assert.match(steps[cache], /^\s+path:\s*_site\/voice-assets\s*$/m);
  const key = steps[cache].match(/^\s+key:\s*(\S+)\s*$/m)?.[1];
  assert.equal(key, `voice-assets-${REVISION}`, 'the cache key must be voice-assets-<REVISION from scripts/fetch-voice-assets.mjs>');
  assert.match(wf('pages.yml').raw, /uses:\s*actions\/cache@[0-9a-f]{40} # v4\.\d+\.\d+/);
});

test('pages deploy ends with a smoke check of the live site', () => {
  const steps = wf('pages.yml').job('deploy').steps;
  const deployAt = steps.findIndex(s => /uses:\s*actions\/deploy-pages@/.test(s.text));
  const smokeAt = steps.findIndex(s => /curl /.test(s.text));
  assert.ok(deployAt >= 0 && smokeAt > deployAt, 'the smoke check must come after deploy-pages');
  const smoke = steps[smokeAt];
  assert.match(smoke.text, /--fail --silent --show-error --retry 5 --retry-delay 10/);
  assert.match(smoke.text, /PAGE_URL:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/);
  for (const body of runBodies(smoke)) {
    assert.doesNotMatch(body, /\$\{\{/, 'pass the page URL through env:, not into the script body');
    for (const target of ['words.json', 'clips/af_heart/_preview.mp3', 'voice-assets/models/onnx-community/Kokoro-82M-v1.0-ONNX/config.json']) {
      assert.ok(body.includes(target), `smoke check must request ${target}`);
    }
  }
});

// ---- repository files ----

test('SECURITY.md explains private vulnerability reporting and the takedown', () => {
  const file = join(root, '.github', 'SECURITY.md');
  assert.ok(existsSync(file), '.github/SECURITY.md is required');
  const text = readFileSync(file, 'utf8');
  assert.match(text, /private vulnerability reporting/i);
  assert.match(text, /Report a vulnerability/);
  assert.match(text, /Unpublish site/);
  assert.doesNotMatch(text, /[\w.+-]{1,64}@[\w-]{1,64}\.[\w.]{1,64}/, 'no email address');
});

test('repository hygiene files', () => {
  assert.ok(existsSync(join(root, 'CLAUDE.md')), 'CLAUDE.md is required');
  const lines = read('CLAUDE.md').split('\n').length;
  assert.ok(lines <= 200, `CLAUDE.md is ${lines} lines (limit 200)`);
  assert.ok(!existsSync(join(root, 'CODEX_HANDOFF.md')), 'the publishing handoff file must stay removed');
  assert.ok(statSync(join(root, 'README.md')).size > 1000);
});

test('scripts, tools, .github and CLAUDE.md name no internal tools, hosts or paths', () => {
  const banned = /cqc-kit|litellm|obsidian|clickup|\/Users\/|CQC_VAULT|iCloud/i;
  const textExt = new Set(['.mjs', '.js', '.cjs', '.json', '.py', '.yml', '.yaml', '.md', '.txt', '.html', '.css', '.sh', '.toml']);
  const files = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (textExt.has(extname(entry.name))) files.push(child);
    }
  };
  for (const top of ['scripts', 'tools', '.github']) if (existsSync(join(root, top))) walk(top);
  files.push('CLAUDE.md');
  assert.ok(files.length > 5);
  for (const rel of files) {
    const m = read(rel).match(banned);
    assert.equal(m, null, `${rel} contains "${m?.[0]}"`);
  }
});
