# Finding mispronounced words

The Kokoro voice guesses how to say a word from its spelling, and it gets some loanwords wrong ("croissant" is a known one). Nobody can listen to every word, so this audit shortlists the words most likely to sound wrong. A person then listens to a few hundred clips instead of all of them.

**The shortlist is a triage signal, not a verdict.** A word on it may sound fine, and a word off it may still sound wrong. The audit reads recordings through software and compares phonemes with a dictionary; nobody has listened to the clips.

Outputs, committed in this folder:

| File | What it is |
|---|---|
| `flagged.json` | The shortlist: `{id, word, group, score, reasons, asr, cmu, espeak}`, highest score first |
| `scores.json` | `{meta, words}`: `meta` records the `words.json` SHA-256 and word count, the transcript and phoneme tool versions, the threshold and the weights; `words` has every word with its signals, for checking a word that is not on the shortlist |
| `summary.md` | Counts, the threshold and why, method versions, and a hand-read evidence check |

## The three signals

- **A, speech round trip.** `asr.py` transcribes each recorded word clip (`clips/af_heart/<key>.mp3`, the key from `clipKey` in `voice-service.js`) with a local Whisper model. The transcript is lowercased and stripped of accents and punctuation, then compared with the word: an exact match scores 0, otherwise the score is 1 minus the best of letter similarity, a double-metaphone match, and phoneme similarity from CMUdict. ASR is noisy: it may spell a homophone differently, so the reason text says when the transcript sounds alike.
- **B, dictionary disagreement.** `espeak.mjs` produces the phonemes `kokoro-js` really gives the model (the `phonemizer` package, which wraps espeak-ng, then kokoro-js's own replacements). `audit.py` reduces those and the CMUdict pronunciation to the same coarse classes (for example `b` and `p` are both `P`, and most vowels collapse to nine classes) and computes a weighted edit distance, plus a penalty when the stressed syllable differs. Words missing from CMUdict are flagged "no dictionary entry" and get a moderate default.
- **C, origin prior.** A small bump for language groups that tend to keep a foreign pronunciation (French, Italian, Spanish, Arabic, Japanese, Slavic, Asian, German, Dutch, New World, Eponym, a little for Greek). Never enough to shortlist a word alone.

The weights, the threshold and the class tables are at the top of `audit.py`.

## Run it

Needs Node.js 22 or newer and Python 3.10 or newer. Disk, as measured on the recorded run: about 350 MB for the Python environment, about 141 MB for the Whisper model and 3.5 MB for CMUdict in the scratch folder, plus about 410 MB for `tools/clips/node_modules`. Every download is verified against a SHA-256 in `setup_assets.py`. Nothing below writes into the repository except the three output files (`flagged.json`, `scores.json`, `summary.md`) and `tools/clips/node_modules` (gitignored) from `npm ci`. Keep the scratch folder outside the repository, and keep it until step 5 has finished: a reboot can clear a `/tmp` folder, and step 3 is the slow one.

```bash
# from the repository root
WORK=/tmp/bee-pron-work                       # any folder outside the repository
mkdir -p "$WORK"

# 1. Python environment with pinned packages
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -r tools/pronunciation/requirements.txt

# 2. Pinned CMUdict and Whisper model, each checked against its SHA-256
"$WORK/venv/bin/python" -I tools/pronunciation/setup_assets.py --work-dir "$WORK" --model base.en

# 3. Signal A: transcribe every word clip (about 32 minutes; progress prints every 50 words)
"$WORK/venv/bin/python" -I tools/pronunciation/asr.py --work-dir "$WORK" --model base.en
#    quick smoke test of the same step; audit.py ignores and refuses this file:
#    "$WORK/venv/bin/python" -I tools/pronunciation/asr.py --work-dir "$WORK" --model base.en --limit 20 --out asr-smoke.json

# 4. Signal B input: the phonemes kokoro-js feeds the model
(cd tools/clips && npm ci)
node tools/pronunciation/espeak.mjs "$WORK/espeak.json"

# 5. Combine, write flagged.json, scores.json and summary.md
"$WORK/venv/bin/python" -I tools/pronunciation/audit.py --work-dir "$WORK"
```

The default threshold is 0.25. `audit.py --threshold 0.30` is a stricter example that changes the cut line without re-running the slow steps. Rerun step 3 only when the clips change; rerun step 5 when only the weights or threshold change. `summary.md` keeps whatever you wrote outside its generated markers.

`audit.py` refuses to run, writes nothing and exits non-zero when: the transcript file came from `--limit`, is missing words or clips, or covers a different number of words than `words.json`; `espeak.json` does not cover every word or lacks its version fields; `cmudict.dict` is not the pinned file; or `summary.md` lacks its two generated markers. It builds all three outputs in memory and swaps them in through temporary files, so a failed run leaves the committed outputs as they were.

**Time and failure.** On the recorded run, step 3 took 1903 s (about 32 minutes, on a laptop CPU with 4 threads) and the other steps took seconds. Step 3 writes its file once at the end, through a temporary file, and has no resume: if it stops, start it again and it begins at the first word. A missing model folder stops it at once with a message pointing at step 2.

## Verify a run

After step 5, these should hold for the committed data (all at the default threshold 0.25):

- The command prints `1155 words scored, 241 flagged at threshold 0.25`.
- `summary.md` says 0 clips missing and lists croissant and blasé as in the shortlist.
- The words.json hash in `summary.md` (also in `scores.json` under `meta`) equals `shasum -a 256 words.json`. If it does not, `words.json` changed after the run and the shortlist is stale: rerun from step 3 if the words or clips changed. After PR #15 added `say` values the hash no longer matches although no word text changed: that mismatch is expected, and rerunning the audit on the re-recorded clips (step 3 onward) is also the check of whether the overrides worked.

The 241 and 1,155 figures belong to the recorded run. If `words.json` or the clips have changed they will differ, and that is expected; the hash check above is what tells you.

## Roll back

`git checkout -- tools/pronunciation/flagged.json tools/pronunciation/scores.json tools/pronunciation/summary.md` restores the committed outputs.

## Owner

The repository owner decides when to rerun the audit and may assign an agent to do it. Rerun it after any change to `words.json` (new or reworded words) or to the voice, model or encoder settings, because the clips and so the transcripts change. A confirmed bad word becomes a spelling-override task in this repository (add a `say` value; see "Fixing a mispronounced word" in the main README). If the audit fails in a way this page does not explain, open an issue in this repository with the command and its output.

The audit is run by hand. It is not part of `npm test` or CI; the only automated checks on this folder are the syntax checks in `npm test`, the public-repo scan in `tests/workflows.test.mjs`, and the `denylist-guard` workflow, which scans the whole tree and history, this folder included.

## Reading the result

Open `flagged.json`, start at the top, and listen to `clips/af_heart/<key>.mp3` (the key is the lowercase word with accents dropped, for example `blase`). `reasons` says why a word is there; `asr` is what the recogniser heard; `espeak` is what the model was given; `cmu` is the dictionary pronunciation reduced to coarse classes.

A confirmed bad word cannot be fixed by recording it again (see "Fixing one bad clip" in the main README); it needs a spelling override, the `say` field (see "Fixing a mispronounced word" and the Data format section in the main README).

## Licences and limits

- **CMU Pronouncing Dictionary**: Copyright Carnegie Mellon University, BSD-style licence (the licence text is in the dictionary's repository). Downloaded to the scratch folder at a pinned commit and not committed.
- **Whisper** (OpenAI, MIT) via **faster-whisper** (MIT) and **CTranslate2** (MIT); the converted `base.en` weights are published under MIT. Downloaded to the scratch folder and not committed. `small.en` also works (`--model small.en`, slower, larger).
- **Metaphone** 0.6 (BSD): double-metaphone codes.
- **kokoro-js** and **phonemizer** (Apache-2.0 per their package metadata; phonemizer wraps eSpeak NG, which has its own licence) are used from `tools/clips/node_modules` as the clip generator installs them. Nothing from them is copied into this repository except the short list of string replacements in `espeak.mjs`.
- Only the American female voice `af_heart` is transcribed. The four voices share one phonemizer, so a wrong phoneme string affects all of them, but a voice-specific artefact would not be seen.
- Whisper `base.en` is small. It can mishear a clear clip and can "fix" a bad one toward a real word, so both directions of error exist.
- The coarse classes ignore voicing and vowel length on purpose, so a voicing or length error is invisible to Signal B.
