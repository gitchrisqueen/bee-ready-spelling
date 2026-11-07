# Finding mispronounced words

The Kokoro voice guesses how to say a word from its spelling, and it gets some loanwords wrong ("croissant" is a known one). Nobody can listen to every word, so this audit shortlists the words most likely to sound wrong. A person then listens to a few hundred clips instead of all of them.

**The shortlist is a triage signal, not a verdict.** A word on it may sound fine, and a word off it may still sound wrong. The audit reads recordings through software and compares phonemes with a dictionary; nobody has listened to the clips.

Outputs, committed in this folder:

| File | What it is |
|---|---|
| `flagged.json` | The shortlist: `{id, word, group, score, reasons, asr, cmu, espeak}`, highest score first |
| `scores.json` | Every word with its signals, for checking a word that is not on the shortlist |
| `summary.md` | Counts, the threshold and why, method versions, and a hand-read evidence check |

## The three signals

- **A, speech round trip.** `asr.py` transcribes each recorded word clip (`clips/af_heart/<key>.mp3`, the key from `clipKey` in `voice-service.js`) with a local Whisper model. The transcript is lowercased and stripped of accents and punctuation, then compared with the word: an exact match scores 0, otherwise the score is 1 minus the best of letter similarity, a double-metaphone match, and phoneme similarity from CMUdict. ASR is noisy: it may spell a homophone differently, so the reason text says when the transcript sounds alike.
- **B, dictionary disagreement.** `espeak.mjs` produces the phonemes `kokoro-js` really gives the model (the `phonemizer` package, which wraps espeak-ng, then kokoro-js's own replacements). `audit.py` reduces those and the CMUdict pronunciation to the same coarse classes (for example `b` and `p` are both `P`, and most vowels collapse to nine classes) and computes a weighted edit distance, plus a penalty when the stressed syllable differs. Words missing from CMUdict are flagged "no dictionary entry" and get a moderate default.
- **C, origin prior.** A small bump for language groups that tend to keep a foreign pronunciation (French, Italian, Spanish, Arabic, Japanese, Slavic, Asian, German, Dutch, New World, Eponym, a little for Greek). Never enough to shortlist a word alone.

The weights, the threshold and the class tables are at the top of `audit.py`.

## Run it

Needs Node.js 22 or newer, Python 3.10 or newer, and about 1 GB of free disk in a scratch folder (the Whisper model is about 145 MB). Every download is verified against a SHA-256 in `setup_assets.py`. Nothing below writes into the repository except the three output files; keep the scratch folder outside it.

```bash
# from the repository root
WORK=/tmp/bee-pron-work                       # any folder outside the repository
mkdir -p "$WORK"

# 1. Python environment with pinned packages
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -r tools/pronunciation/requirements.txt

# 2. Pinned CMUdict and Whisper model, each checked against its SHA-256
"$WORK/venv/bin/python" -I tools/pronunciation/setup_assets.py --work-dir "$WORK" --model base.en

# 3. Signal A: transcribe every word clip
"$WORK/venv/bin/python" -I tools/pronunciation/asr.py --work-dir "$WORK" --model base.en

# 4. Signal B input: the phonemes kokoro-js feeds the model
(cd tools/clips && npm ci)
node tools/pronunciation/espeak.mjs "$WORK/espeak.json"

# 5. Combine, write flagged.json, scores.json and summary.md
"$WORK/venv/bin/python" -I tools/pronunciation/audit.py --work-dir "$WORK"
```

`audit.py --threshold 0.35` changes the cut line without re-running the slow steps. `asr.py --limit 20` is a quick smoke test. Rerun step 3 only when the clips change; rerun step 5 when only the weights change. `summary.md` keeps whatever you wrote outside its generated markers.

**Runtime.** Step 3 dominates: see `summary.md` for the measured time on the recorded run. Steps 4 and 5 take seconds. Step 2 downloads about 150 MB once.

## Reading the result

Open `flagged.json`, start at the top, and listen to `clips/af_heart/<key>.mp3` (the key is the lowercase word with accents dropped, for example `blase`). `reasons` says why a word is there; `asr` is what the recogniser heard; `espeak` is what the model was given; `cmu` is the dictionary pronunciation reduced to coarse classes.

A confirmed bad word cannot be fixed by recording it again (see "Fixing one bad clip" in the main README); it needs a spelling override, which does not exist yet.

## Licences and limits

- **CMU Pronouncing Dictionary**: Copyright Carnegie Mellon University, BSD-style licence (the licence text is in the dictionary's repository). Downloaded to the scratch folder at a pinned commit and not committed.
- **Whisper** (OpenAI, MIT) via **faster-whisper** (MIT) and **CTranslate2** (MIT); the converted `base.en` weights are published under MIT. Downloaded to the scratch folder and not committed. `small.en` also works (`--model small.en`, slower, larger).
- **Metaphone** 0.6 (BSD): double-metaphone codes.
- **kokoro-js** and **phonemizer** (Apache-2.0 per their package metadata; phonemizer wraps eSpeak NG, which has its own licence) are used from `tools/clips/node_modules` as the clip generator installs them. Nothing from them is copied into this repository except the short list of string replacements in `espeak.mjs`.
- Only the American female voice `af_heart` is transcribed. The four voices share one phonemizer, so a wrong phoneme string affects all of them, but a voice-specific artefact would not be seen.
- Whisper `base.en` is small. It can mishear a clear clip and can "fix" a bad one toward a real word, so both directions of error exist.
- The coarse classes ignore voicing and vowel length on purpose, so a voicing or length error is invisible to Signal B.
