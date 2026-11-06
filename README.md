<div align="center">

# 🐝 Bee Ready

**Spelling bee practice for any speller. Hear a word, ask for clues, and spell it like a champion.**

[**▶ Open the live site**](https://gitchrisqueen.github.io/bee-ready-spelling/)

[![Deploy to GitHub Pages](https://github.com/gitchrisqueen/bee-ready-spelling/actions/workflows/pages.yml/badge.svg)](https://github.com/gitchrisqueen/bee-ready-spelling/actions/workflows/pages.yml)
![Words](https://img.shields.io/badge/words-1%2C155-f5b700)
![No login](https://img.shields.io/badge/account-not%20required-6c4fc7)
![Static site](https://img.shields.io/badge/backend-none-2b2155)

<img src="docs/screenshot-desktop.png" alt="Bee Ready home page on a desktop browser, showing the practice round builder" width="820">

</div>

---

## Contents

- [For spellers and grown-ups](#for-spellers-and-grown-ups)
- [Speech and voices](#speech-and-voices)
- [For developers](#for-developers)
- [Deployment](#deployment)
- [Repository layout](#repository-layout)
- [Testing and known limits](#testing-and-known-limits)
- [Content and license](#content-and-license)

## For spellers and grown-ups

Open the site, pick how many words you want, and start. There is nothing to install and no account to create.

| | |
|---|---|
| **1,155 words** | 911 Study words and 244 Challenge words, each with a definition and its language group. |
| **Random rounds** | Choose 5, 10, 15, 20 or your own number. Draw from all words, Study only, Challenge only, or words you missed. |
| **Two ways to answer** | *Type the letters*, or *say it out loud* with a grown-up who reveals the spelling and marks it. |
| **Clues on request** | Ask for a definition, part of speech, language group or a sentence before you spell. |
| **Review missed words** | Words you miss are saved so you can practice them again. |
| **Natural voices** | Choose from four American English voices, adjust the talking speed, or use your device's own voice. Every word plays instantly from a recording. |
| **Printable PDFs** | A practice workbook, an alphabetical list and a definitions reference. |
| **Phone and tablet ready** | The layout adapts to phones, iPads and desktops. |

<p align="center">
  <img src="docs/screenshot-phone.png" alt="Bee Ready on a phone" width="260">
</p>

### Printables

- [Practice workbook](assets/Spelling_Bee_Practice_Workbook.pdf)
- [Alphabetical list](assets/Spelling_Bee_Alphabetical_List.pdf)
- [Definitions reference](assets/Spelling_Bee_Definitions_Reference.pdf)

### Your progress stays on your device

Practice history and voice settings are saved in your browser's local storage. Nothing is sent to a server. History is separate for each browser and each web address, and the **Grown-ups** tab has a button to clear it.

## Speech and voices

Every word, and the voice sample, is a short **pre-recorded clip** made with the Kokoro neural voice, so it plays the moment you tap it. There is nothing to download first, and it works on any phone or tablet.

```
Recorded clip  →  live Kokoro  →  Piper  →  Device speech
  (instant)        (optional)     (backup)   (always works)
```

- **Recorded clips** cover all 1,155 words in four American English voices (two female, two male). Slow and Clear speeds change the playback speed of the same clip.
- **No clip yet?** A word that has no recording (for example one just added), and every sentence clue, speaks right away with the **device voice**. A child never waits for a model.
- **Live voice (optional).** *Add live voice for sentences* downloads the Kokoro model (about 90 MB, once) so sentences and new words can be spoken in the natural voice. It can be slow on phones. If it fails, Piper and then the device voice take over automatically.
- **Device voice only** skips everything above and uses the browser's built-in voice.

**Good to know**

- The Kokoro model files are served from this site itself, with Hugging Face as a per-request fallback. The speech libraries (`kokoro-js`, the ONNX runtime) and the Piper backup load from third-party CDNs.
- No API key or subscription is used.
- Safari can ask for a second tap before it plays audio. The app shows a message when that happens.
- This is practice audio, **not an official competition pronunciation authority**. Check a dictionary for unfamiliar or ambiguous words.

## For developers

Bee Ready is a dependency-free static site: plain HTML, CSS and JavaScript modules. There is no framework, bundler or backend.

**Requirements:** Node.js 22 or newer for tests and the build. Python 3 only for the optional local server. No `npm install` step is needed.

```bash
git clone https://github.com/gitchrisqueen/bee-ready-spelling.git
cd bee-ready-spelling

npm test          # syntax checks, word-bank checks, mocked voice tests
npm run build     # stages the deployable site into _site/
npm run serve     # serves the repo at http://localhost:8080/
```

To test the self-hosted voice model locally, run `npm run build && npm run fetch-voice-assets` and serve `_site/` (for example `cd _site && python3 -m http.server 8080`). Without that step, local development loads the model from Hugging Face instead.

You can also use any static file server. Open `index.html` through a server, not from `file://`, so the voice modules and `words.json` load.

### How it fits together

| File | Role |
|---|---|
| `index.html`, `styles.css`, `app.js` | Responsive UI, round logic, history and the word bank |
| `voice-service.js` | Recorded-clip playback, speech engine selection, on-demand model download, progress events, cancellation and fallback |
| `tools/clips/` | Clip generator (Kokoro + ffmpeg). Not part of the deployed site |
| `clips/` | Pre-recorded word clips, one folder per voice |
| `words.json` | The complete word data: word, part of speech, definition, language group, level |
| `scripts/build.mjs` | Copies an allowlist of files into `_site/` |
| `scripts/fetch-voice-assets.mjs` | Downloads the pinned Kokoro model files into `_site/voice-assets/` and verifies every file's SHA-256 |

`voice-service.js` exposes a small status object (`phase`, `engine`, `label`, `percent`, `detail`, `fallback`) that the UI subscribes to. That is what drives the download panel and the voice status line.

### Adding or changing words

Edit `words.json` and push to `main`. Two things happen automatically:

1. The site deploys right away. New words work immediately, spoken by the device voice.
2. The **Generate voice clips** workflow (`.github/workflows/generate-clips.yml`) records only the new or changed words in all four voices, commits them under `clips/`, and redeploys. Removed words have their clips pruned.

To generate clips on your own machine instead (needs Node 22 and `ffmpeg`):

```bash
cd tools/clips && npm ci
node generate.mjs                 # all voices; only missing or changed clips
node generate.mjs --voice af_heart --limit 10   # try a few
node generate.mjs --prune         # also delete clips for removed words
```

A clip is `clips/<voice>/<word>.mp3` (lowercase, URL-encoded). A `manifest.json` per voice records a fingerprint of the text, voice, model revision and encoder settings, so a change to any of them regenerates that clip. The first full run takes a couple of hours on a laptop. Later runs only do what changed.

### Data format

Each entry in `words.json` looks like this:

```json
{
  "id": 1,
  "word": "abdicate",
  "part": "v",
  "definition": "To give up a throne or an important responsibility.",
  "group": "Latin",
  "level": "Study"
}
```

`level` is `Study` or `Challenge`. `group` is the language group from the source booklet, not a full etymology.

## Deployment

`.github/workflows/pages.yml` runs on every push to `main`:

1. **Test:** `npm test`, then `npm run build`.
2. **Deploy:** builds `_site/`, adds the self-hosted voice model with `npm run fetch-voice-assets`, and publishes it with the official GitHub Pages actions.

The Kokoro model (Apache-2.0, pinned to one Hugging Face revision) is downloaded during the deploy and is **not committed to git**, which keeps the repository small. A checksum mismatch fails the deploy. Its license notice is published at `voice-assets/NOTICE.txt` on the site.

Pull requests run the tests only. The workflow can also be started by hand from the **Actions** tab. If a test fails, nothing deploys and the last good version stays live.

`generate-clips` keeps the recordings in sync with `words.json`, and `denylist-guard` scans the tree and history on each push and pull request.

**Setup for a fork:** in **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. Or run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

**Roll back:** `git revert <commit>` on `main` and push. The same workflow tests and deploys the revert.

## Repository layout

```
.
├── index.html · styles.css · app.js     UI and practice logic
├── voice-service.js                     Clips → Kokoro → Piper → device speech
├── clips/                               Pre-recorded word clips (4 voices)
├── tools/clips/                         Clip generator and its dependencies
├── words.json                           1,155-word data set
├── assets/                              Three printable PDFs
├── docs/                                README screenshots
├── scripts/
│   ├── build.mjs                        Stages the site into _site/
│   ├── fetch-voice-assets.mjs           Adds the verified voice model at deploy time
│   └── denylist_guard.py                Repository scanning helper
├── tests/                               Word-bank and voice tests
└── .github/workflows/                   pages.yml, generate-clips.yml, denylist-guard.yml
```

## Testing and known limits

`npm test` runs 14 automated tests. The voice tests **mock** model downloads and speech playback, so they cover fallback order, cancellation, retry caching and content checks. They do not prove playback on a physical iPhone or iPad or in Safari.

Beyond the automated tests, the deployed site has been exercised in desktop Chromium: a real Kokoro download and playback, Piper taking over when Kokoro was blocked, device speech when both were blocked, and phone and tablet viewport widths with no horizontal overflow. Real-device checks on iOS and iPadOS are still open.

Other limits:

- Example sentences are generic study examples, not official competition clues.
- Definitions are simplified study explanations, not dictionary entries. Competition rules and word lists vary by organizer.
- The language group is a label from the booklet. Many words passed through several languages.
- Typed answers are compared simply; accents and punctuation are not graded strictly.
- The word *learned* and a few others can be pronounced differently depending on meaning, so confirm with a grown-up.

## Content and license

Bee Ready is a standalone static app built from original spelling-bee study material and generated PDF references. The source scan is not included in this repository.

There is intentionally **no open-source license**. Viewing the code, word data and PDFs does not grant permission to reuse the underlying third-party source material.
