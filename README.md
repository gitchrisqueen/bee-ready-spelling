# Bee Ready | Spelling Bee Practice

A no-login, mobile-friendly spelling bee practice site for an eight-year-old, containing **1,155 unique words** from the provided spelling-bee study booklet (**911 Study + 244 Challenge**). Includes definitions, the original language-group categories, clue requests, random rounds, oral/typed modes, missed-word review, voice selection, progress indicators, and PDFs for printing.

## How to use

Visit the deployed GitHub Pages site, choose a word count and pool, and start practicing. All rounds are generated locally; no account is needed. Local practice history and voice settings are stored **per browser and domain**. The original `chatgpt.site` instance has separate local history and is not automatically synced with this GitHub Pages version.

## Speech

The application attempts **Kokoro** neural TTS first, then **Piper**, then built-in **device speech**. Four American English speaker styles are selectable. The natural voices download models on demand; the UI shows file-by-file progress when the download library exposes totals, plus an indeterminate loading indicator otherwise. The user can choose device speech without a model download. The first neural playback can take time, fail on low-memory devices, or require another tap on Safari after a download.

The app imports pinned browser libraries via third-party CDNs and fetches models from their providers. No API key or TTS subscription is used, but an Internet connection is necessary for first-time neural use. The model providers' availability and offline persistence are outside this repository's control. This is practice audio, **not an official competition pronunciation authority**; use a grown-up and dictionary for ambiguous or unfamiliar pronunciations.

## Development

Requirements: Node.js 22+ for the optional tests and build, or any static file server for development. No npm dependencies need to be installed.

```bash
npm test
npm run build
npm run serve
```

Open `http://localhost:8080/` after running `npm run serve`. `npm run build` writes the GitHub Pages deployment content to `_site/`.

## Automatic deployment

`.github/workflows/pages.yml` runs on every push to `main`, on pull requests (tests only), and on manual dispatch. It runs the voice-fallback tests and word-bank checks, builds a minimal `_site/` folder, and deploys it with the official GitHub Pages Actions.

**One-time repository setup:** In GitHub repository **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. For a new repository, you may also create Pages with `gh api -X POST repos/gitchrisqueen/bee-ready-spelling/pages -f build_type=workflow`. The authenticated user must have Pages administration rights. Once configured, new commits to `main` redeploy automatically.

Expected address after successful deployment (not active until verified): `https://gitchrisqueen.github.io/bee-ready-spelling/`

## Operations

The repository owner maintains this site. Inspect the Actions tab for test and deployment logs. A failed test prevents deployment, leaving the last successful site in place. To roll back a code change, use `git revert <commit>` on `main` and push; the same workflow tests and deploys the reversal. For a failed initial deployment, fix the reported Actions error before retrying. GitHub Pages serves only static files; there is no paid application backend.

The included Node tests mock model downloads and speech playback. They verify fallback logic, cancellation, retry caching, and content; they do not prove physical iPad or Safari playback. Natural voices depend on third-party downloads and available device memory.

## Repository layout

- `index.html`, `styles.css`, `app.js`: responsive UI
- `voice-service.js`: free voice system, fallbacks and download progress
- `words.json`: the complete 1,155-word reference data
- `assets/`: three generated printable PDFs
- `scripts/build.mjs`: prepares the public site from an allowlisted set of files
- `tests/`: word-bank and mock speech tests
- `.github/workflows/pages.yml`: GitHub Pages deployment workflow
- `CODEX_HANDOFF.md`: precise instructions for an authenticated Codex session to publish

## Provenance and limitations

This repository package was reconstructed as a **standalone Bee Ready v2** from the original spelling-bee word material and generated PDF reference. It is **not a checkout of the first ChatGPT Sites project's private production source**. It does not update or redirect that original `chatgpt.site` URL. The written example sentences are mostly generic study examples, not official sentence clues. The language grouping in the booklet should not be mistaken for a complete etymology. Grades are simplified; accents/punctuation are not strictly graded by the typed-answer comparison.

The original scan is not committed. Public repository visibility exposes the reconstructed code, word data, and generated PDFs; it does not grant a license to reuse third-party source material. There is intentionally no open-source license on this project.
