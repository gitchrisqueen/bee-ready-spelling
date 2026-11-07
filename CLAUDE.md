# Bee Ready: instructions for coding agents

Public repository. A static spelling-bee practice site for children, hosted on GitHub Pages. Everything here is publicly readable, so treat every file, commit message and issue as public.

## What it is

- Plain HTML, CSS and JavaScript modules. No framework, bundler or backend. No runtime npm dependencies.
- `words.json` is the word data: id, word, part, definition, group, level, scan_page, sentence, and an optional `say`.
- Speech: recorded clips in `clips/` first, then live Kokoro, then Piper, then the device voice (`voice-service.js`).
- Everything the child saves (history, stars, voice settings) stays in that browser's local storage and is never sent by the site. GitHub hosts the site and sees visitor IP addresses; the optional live voice also loads files from cdn.jsdelivr.net, esm.sh and huggingface.co.
- Read `README.md` first: it documents features, the clip pipeline, deployment, the failure runbook and testing.

## Commands

```bash
npm test                 # syntax checks plus every test in tests/ (must pass before any PR)
npm run build            # stages the deployable site into _site/
npm run serve            # serves the repo on http://localhost:8080/
node tools/clips/generate.mjs --dry-run       # what the clip generator would record (needs `npm ci` in tools/clips)
node tools/device-test/device-test.mjs        # iPhone/iPad checks in WebKit (needs `npm install` in tools/device-test)
```

## Public-repo rules (always)

- No secrets, tokens, hostnames, private paths, personal data, or student, client or prospect data. The only per-child data is local to the child's browser.
- No names of internal systems, internal tools or private notes. Do not reference private documents or private servers in code, docs, issues, PRs or commit messages.
- No claim without something a reader can check (a URL, a run id, a SHA, a command). No invented numbers or dates.
- Anything shown to children must be plain, kind and age-appropriate. Sentences are factual and gentle, even for hard topics.
- The word list comes from a third-party study booklet. Do not add the scan or copy extra third-party text.
- CI runs `denylist-guard` on every push to `main` and on every PR. Never put it behind a path filter and never weaken it.

## How work lands

1. Branch from `main`. Never push straight to `main`: the ruleset "main protection" (Settings > Rules) requires a pull request, the checks `test` and `guard`, and blocks force-push and deletion. Only the owner can bypass it, and only through a pull request.
2. Open a PR. CI (`npm test` and build) must be green.
3. Run an independent review before merge, using the profile that fits the change: workflow, docs and code changes need security, operator and claims review; anything a child sees also needs an accessibility review. Fix findings, re-run the failing reviewers, keep the review record.
4. Commits end with `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`. PR bodies end with the Claude Code attribution line.
5. The clip workflow never pushes to `main`. It opens a bot pull request titled "Update pre-recorded voice clips [skip ci]" from a `clips/update-<run id>` branch. Events caused by the workflow token do not start other workflows, so its `start-deploy` job starts `test` and `guard` on that branch, turns on auto-merge, waits for the merge, then starts the deploy and the scan on `main`. Only that job holds `actions: write`; the `commit` job holds `contents: write` and `pull-requests: write`.

## Content rules

- Each word needs a `sentence` that uses the word exactly once, as a whole word (a test checks it). A word without one falls back to a generic sentence, so write one.
- Do not hand-edit `clips/`, except deleting a removed voice's folder in the commit that removes the voice (README, "Removing a voice"). Change `words.json` or `sentences.js` and let the clip workflow record the difference, or run `tools/clips/generate.mjs`. One bad clip is fixed with `--redo` (see README).
- A mispronounced word is fixed with the optional `say` field in `words.json` (the word's sounds as IPA in the model's notation, checked by `tools/clips/say.js` and `npm test`), not by re-recording. See README, "Fixing a mispronounced word".
- The page reads the word count from `words.json`. Do not hard-code 1,155 in code.

## UI rules (children on phones and tablets)

- Form fields are at least 16 px (iOS Safari zooms the page below that). Tap targets are at least 44 px. No text under 12 px.
- Buttons keep one fixed accessible name; state goes in `aria-pressed` or `aria-expanded`, not in a changing label.
- `tests/a11y.test.mjs` parses `app.js` as text: keep `initAnswerBox`, `shouldBlockInsert`, `isBigJump` and `BLOCKED_INPUT_TYPES` as written, or update the tests in the same PR.
- Run `tools/device-test` after any layout change. It is emulation (WebKit with iPhone and iPad presets), not a real device; say so when you report.

## CI standard (every workflow in this repo)

- `permissions: contents: read` at workflow level; a job that writes raises its own.
- `timeout-minutes` on every job; `retention-days` on every artifact.
- `push` limited to `main`; PR checks cancel superseded runs; deploys are serialized and never cancelled.
- Security and privacy gates never sit behind `paths` or `paths-ignore`.
- First-party actions may stay on major tags. Any third-party action is pinned to a full commit SHA with the version in a comment. No `pull_request_target`.
- A test (`tests/workflows.test.mjs`) enforces these. Change the test only together with an explicit decision.

## Triage labels

Every open issue and PR carries exactly one state label:

| Label | Meaning |
|---|---|
| `blocked-on-chris` | Needs the owner: a merge decision, a secret, a public post, money, a domain change, or a choice only the owner can make |
| `blocked-on-external` | Waiting on a third party; nobody here can act |
| `agent-ready` | Every input exists; an agent can start now. Red CI is `agent-ready`, not an escalation |
| `agent-blocked` | An agent tried and hit a wall that is not the owner; fix it |
| `stale` | No activity for 21 days and unclaimed; close it or turn it into a task |

`needs-decision` marks an issue with an unanswered question for the owner (treated as `blocked-on-chris`).

## Do not

- Do not commit generated output (`_site/`, `node_modules/`, device-test screenshots).
- Do not add runtime dependencies or third-party requests (fonts, scripts, analytics). The page makes none on load; only the optional live voice loads libraries and model files from the three hosts above. A test guards the fonts.
- Do not delete branches, repositories or history without the owner's word.
