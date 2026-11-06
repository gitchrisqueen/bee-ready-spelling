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

Every word, and the voice sample, is a short **pre-recorded clip** made with the Kokoro neural voice, so it plays almost at once. There is nothing to download first, and it works on any phone or tablet.

```
Recorded clip  →  live Kokoro  →  Piper  →  Device speech
  (instant)        (optional)     (backup)   (always works)
```

- **Recorded clips** cover every word in four American English voices: Sunny and Bella (female), Miles and Finn (male). Slow and Clear speeds change the playback speed of the same clip.
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
2. The **Generate voice clips** workflow (`.github/workflows/generate-clips.yml`) records only the new or changed words in all four voices, commits them under `clips/`, and redeploys. Removed words have their clips pruned. It also runs when `voice-service.js` or `tools/clips/` changes, and you can start it by hand from the **Actions** tab.

The word count and "1,155" appear as static text in `index.html` and this README. Update them by hand when the list changes. The tests check that the list is well-formed (unique words, valid level), not that it has a particular size.

**Safeguards.** The generator downloads the Kokoro model at one pinned revision and checks the model file's SHA-256 before it records anything. (The deploy step separately verifies every self-hosted voice file.) One failing word does not stop the run: finished clips are still committed and the run is marked failed. It refuses to delete more than 5% of a voice's clips without `--force-prune`, so an emptied `words.json` cannot wipe the clips. The workflow's `generate` job has a read-only token and runs npm with install scripts off. A separate `commit` job holds the write token, runs no npm code, and accepts only validated `.mp3` files, per-voice `manifest.json` files and `settings.json`. A manual run from any branch other than `main` does nothing.

To generate clips on your own machine instead:

```bash
ffmpeg -hide_banner -encoders | grep libmp3lame     # ffmpeg must include the MP3 encoder
cd tools/clips && npm ci
node generate.mjs                                    # all voices; only missing or changed clips
node generate.mjs --voice af_heart --limit 10        # try a few
node generate.mjs --prune                            # also delete clips for removed words
```

Needs Node 22 or newer, `ffmpeg`, a download of about 90 MB for the model (cached in `tools/clips/node_modules`), and about 30 MB of disk for the clips. Pull before you generate, and do not push local clips while the workflow is running, because both rewrite the manifests.

Voices are named by Kokoro id on disk: `af_heart` (Sunny), `af_bella` (Bella), `am_michael` (Miles) and `am_fenrir` (Finn). A clip is `clips/<voice id>/<key>.mp3`, where the key is the word in lowercase ASCII: accents are dropped (`blasé` → `blase`) and any other character except `a-z`, `0-9` and `-` becomes `_`. The generator stops if two words would share a key. Each voice's `manifest.json` records a fingerprint of the text, voice, model revision and an `ENCODER` label. If you change the encoder filter, ffmpeg flags, model dtype, speed, model revision or `kokoro-js` version, the generator stops and asks you to bump the `ENCODER` label in `generate.mjs`, which regenerates every clip.

Timings I measured while generating the current set: 1.4 to 2.0 seconds per clip for one process on a laptop and on two servers, so roughly 30 to 40 minutes per voice. I have not timed GitHub's runners. The job limit is 350 minutes.

**Check what a run would do:** `node generate.mjs --dry-run` prints how many clips each voice still needs and exits without loading the model. On an up-to-date tree every voice shows `0`.

**Manual run options.** In **Actions → Generate voice clips → Run workflow** you can set `voice`, `limit` (stop after N new clips per voice, to split a big job), `redo` (clip keys to record again) and `force_prune` (allow deleting more than 5% of a voice's clips). Locally the same options are `--voice`, `--limit`, `--redo` and `--force-prune`.

**Fixing one bad clip.** Run **Generate voice clips** with `redo` set to the clip key (for example `blase`). Locally: `node generate.mjs --redo blase`, then commit the change. Recording again uses the same model, voice and settings, so it normally produces the same audio. If a word is mispronounced, re-recording will not fix it. The remedy would be a spelling override (for example a `say` field in `words.json` used as the speech text), which does not exist yet.

**Adding a voice.**
1. Add it to `VOICES` in `voice-service.js`, keeping the `kokoro:'id'` form (the workflow reads the list with that pattern; a test checks it). Fill in the `piper` backup voice too, and update the "four voices" wording in this README and the page.
2. Add its `voices/<id>.bin` to `scripts/fetch-voice-assets.mjs` with the size and SHA-256 from the pinned revision:

   ```bash
   curl -sSL "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/<id>.bin" -o /tmp/v.bin && stat -f%z /tmp/v.bin && shasum -a 256 /tmp/v.bin
   ```
3. Push. Expect a full run for the new voice. A test fails if a voice is missing from either place, or if `clips/` has a folder for a voice that is no longer in `VOICES`.

**Changing the encoder** (bitrate, filter, speed, model revision, `kokoro-js` version): edit the constants at the top of `tools/clips/generate.mjs`, bump `ENCODER`, try `node generate.mjs --voice af_heart --limit 3` and listen to the result, then push. Every clip is regenerated, which takes hours, so consider splitting it with the `limit` option. If you edit the constants and forget to bump `ENCODER`, the generator stops with a message asking for it.

### When a run fails

| What you see | What it means | What to do |
|---|---|---|
| `Model SHA-256 mismatch ... Refusing to generate` | The cached or downloaded model is not the pinned file. | Delete `tools/clips/node_modules/@huggingface/transformers/.cache` and run again. If it persists, the pinned Hugging Face revision may have changed or been removed. |
| `Bump ENCODER` | You changed a generator setting without changing the `ENCODER` label. | Bump `ENCODER` in `generate.mjs` (see above). |
| `refusing to prune N of M clips` | `words.json` lost more than 5% of its words, or a naming change made old files look stale. The run is red but still records new words and keeps the old clips. | Check `words.json`. If the removal is intended, run again with `force_prune`. |
| `FAILED <voice>/<key>` and `N clip(s) failed` | Individual words failed. The run is red, but every good clip is still committed. | Find the words in the generate step log and run again; only the failed clips are retried. |
| Generate job red, commit job green | Expected after a partial failure: the finished clips were committed. | Read the failed words in the log as above. |
| `clips/ changed on main after this run started` | Someone pushed to `clips/` while the run was generating. Nothing was pushed. | Run **Generate voice clips** again from `main`. |
| Commit job fails on `git pull --rebase` or `git push` | A concurrent push conflicted, or `main` now has branch protection. | Use **Re-run failed jobs** within 3 days (the artifact is kept that long); after that, run again. If you turned on branch protection, allow `github-actions[bot]` to push. |
| `... would replace N (more than 5% fewer)` | The validator thinks an artifact would delete too many clips. | Run again with `force_prune` only if the removal is intended. |

GitHub emails only the person who triggered a run (for a push, whoever pushed). There is no separate alert channel, so check the **Actions** tab after changing `words.json`. If the pinned model is ever removed from Hugging Face, both clip generation and the deploy stop. The fix is to host the pinned files yourself and update the URLs and hashes.

### Data format

Each entry in `words.json` looks like this:

```json
{
  "id": 1,
  "word": "abdicate",
  "part": "v",
  "definition": "To give up a throne or an important responsibility.",
  "group": "Latin",
  "level": "Study",
  "scan_page": 15
}
```

`level` is `Study` or `Challenge`. `group` is the language group from the source booklet, not a full etymology. `scan_page` is the page in the source booklet and is not shown in the app.

## Deployment

`.github/workflows/pages.yml` runs on every push to `main`:

1. **Test:** `npm test`, then `npm run build`.
2. **Deploy:** builds `_site/`, adds the self-hosted voice model with `npm run fetch-voice-assets`, and publishes it with the official GitHub Pages actions.

The Kokoro model (Apache-2.0, pinned to one Hugging Face revision) is downloaded during the deploy and is **not committed to git**, which keeps the repository small. A checksum mismatch fails the deploy. Its license notice is published at `voice-assets/NOTICE.txt` on the site.

Pull requests run the tests only. The workflow can also be started by hand from the **Actions** tab. If a test fails, nothing deploys and the last good version stays live.

`generate-clips` keeps the recordings in sync with `words.json`. `denylist-guard` scans the tree and history on each push and pull request. Commits made by the clip workflow do not trigger workflows on their own, so that workflow starts the deploy and the scan directly after it pushes.

Branch protection is not enabled on `main`. If you turn it on, allow `github-actions[bot]` to push, or the clip workflow's push will be rejected.

**Setup for a fork:** in **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. Or run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

**Roll back:** `git revert <commit>` on `main` and push. The same workflow tests and deploys the revert. Reverting a commit that only touches `clips/` does not start **Generate voice clips**. If you revert an encoder change, revert the code commit and the clip commit together, or the next run will regenerate everything.

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

`npm test` runs the automated tests in `tests/`. The voice tests **mock** the network and speech playback. They cover recorded-clip playback and fallback, instant device speech when a clip is missing, the Kokoro → Piper → device order, cancellation, retry caching, and content checks such as unique words, ASCII clip names, and clip folders matching the voice list. They do not prove playback on a physical iPhone or iPad or in Safari.

Manual checks, not part of CI: I exercised a local build in desktop Chromium at a phone-sized viewport. All four voices played recorded clips, Slow speed played at 0.7×, a prefetched word started playing in 43 ms, and the sentence clue used the device voice. I confirmed that every word has a clip in every voice, and sampled 120 clips for cut-off starts and ends. I checked the model used for generation against the pinned SHA-256 on the three machines that generated clips. Real-device checks on iOS and iPadOS, including Safari's tap-to-play rule, are still open.

Other limits:

- Example sentences are generic study examples, not official competition clues.
- Definitions are simplified study explanations, not dictionary entries. Competition rules and word lists vary by organizer.
- The language group is a label from the booklet. Many words passed through several languages.
- Typed answers are compared simply; accents and punctuation are not graded strictly.
- The word *learned* and a few others can be pronounced differently depending on meaning, so confirm with a grown-up.

## Content and license

Bee Ready is a standalone static app built from original spelling-bee study material and generated PDF references. The source scan is not included in this repository.

There is intentionally **no open-source license**. Viewing the code, word data and PDFs does not grant permission to reuse the underlying third-party source material.
