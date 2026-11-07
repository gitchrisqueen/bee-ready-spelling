# Pronunciation audit: summary

<!-- generated:start (written by audit.py; do not edit by hand) -->
## Run summary

- Inputs: words.json SHA-256 `df47f3cad6bb3320c32d5b67108573d0d8dd0e70537eb1b489335501fc7527e8` (1155 words). If `shasum -a 256 words.json` no longer matches, this shortlist is stale.
- Words scored: 1155. Shortlisted: **241** at score >= 0.25.
- Signal A (speech round trip): 749 words transcribed exactly as spelled; 406 differ in some way, of which 48 are far from the word (similarity of 0.5 or less). Clips transcribed: 1155; clips missing: 0.
- Signal B (espeak against CMUdict): 261 words have no CMUdict entry; 19 have a coarse-phoneme distance of at least 0.30.
- Signal C (origin prior): 915 words belong to a group with a bump; the bump is at most 0.10 points, so it cannot shortlist a word alone.

Score = 0.5 x A + 0.4 x B + origin bump + at most 0.05 for low recogniser confidence. A is 1 minus the best of letter similarity, a double-metaphone match (0.85) and CMU phoneme similarity of the transcript. B is the weighted phoneme distance divided by 0.6 (cap 1), plus 0.15 when the stressed syllable differs; a word with no entry counts as 0.35.

Words at or above a score, for choosing the threshold: 0.20: 357, 0.25: 241, 0.30: 113, 0.35: 83, 0.40: 54, 0.45: 38, 0.50: 17.

Shortlist by language group (shortlisted of total):

| Group | Shortlisted | Total |
|---|---|---|
| German | 38 | 79 |
| French | 27 | 98 |
| Arabic | 24 | 83 |
| Dutch | 24 | 99 |
| Slavic | 22 | 52 |
| Spanish | 20 | 72 |
| Asian | 18 | 54 |
| Japanese | 15 | 40 |
| New World | 12 | 56 |
| Eponym | 11 | 53 |
| Italian | 11 | 88 |
| Old English | 8 | 96 |
| Greek | 7 | 141 |
| Latin | 4 | 144 |

Precision check, known-wrong words:

- croissant: IN the shortlist (score 0.592, rank 3 of 1155; heard "Kwi-san"; reasons: ASR heard "Kwi-san"; French origin; low ASR confidence (-1.168)).
- blasé: IN the shortlist (score 0.388, rank 59 of 1155; heard "Bluzzy"; reasons: ASR heard "Bluzzy" (sounds alike, may be a spelling difference); espeak and CMUdict disagree (distance 0.32); French origin).

Method versions:

- Recogniser: faster-whisper 1.1.1 with CTranslate2 4.8.5, model base.en (pinned revision in setup_assets.py), beam_size=5, temperature=0, language=en, compute_type=int8, no VAD, no prompt; voice af_heart; transcription took 1903 s.
- Phonemes: kokoro-js 1.2.1 and phonemizer 1.2.1 (espeak-ng), language en-us, with kokoro-js's replacement rules (espeak.mjs leaves out only the text clean-up before phonemizing: digits, titles, abbreviations).
- Dictionary: CMU Pronouncing Dictionary (cmudict.dict), pinned commit and SHA-256 in setup_assets.py.
- Scoring: audit.py in this folder; knobs are at its top. Metaphone 0.6.
<!-- generated:end -->

> Note (after PR #15): `words.json` now has `say` values on 123 words, so its SHA-256 no longer matches the one recorded above even though no word text changed. The shortlist above is the one the `say` values were written from. Rerun the audit on the re-recorded clips to check the overrides.


## Why this threshold

The score has no natural cut line, so the threshold was chosen by counting. The ladder above shows 113 words at 0.30 (under the 150 target), 241 at 0.25 and 357 at 0.20 (over the 300 limit). 0.25 is the round number inside the 150 to 300 range, so the shortlist is 241 words. The counts roughly double between 0.30 and 0.25, so the words just under the line are mostly weak evidence (a transcript that differs by one letter, plus an origin bump). Run `audit.py --threshold 0.30` for a stricter list of 113.

## Evidence review (read by a person, not listened to)

Nobody listened to any clip. For each word below I read the evidence in `scores.json`: the transcript, the espeak phonemes, the CMUdict pronunciation, and my own knowledge of how the word is usually said (not checked against a dictionary here, except the CMUdict stress marks). "Likely wrong" and "likely fine" are readings of text, not hearing. The 30 words are not a random sample (the shortlisted ones are every 16th by rank from `flagged.json`; the unflagged ones are words I picked from just under the line, not all of the highest-scoring ones (mercerize at 0.247 and keelhaul, keeshond, mahimahi, malihini, muishond and witloof at 0.242 outscore some of them and are not in the table), plus well-known loanwords), so they give no recall figure and no precision figure.

### 15 shortlisted words

| Rank | Word | Evidence | Conclusion |
|---|---|---|---|
| 1 | foyer | espeak says "FOY-ay"; CMUdict says "FOY-er"; ASR heard "FYA" | Real disagreement, but "foy-ay" is a common variant. Worth one listen; may be acceptable |
| 17 | koan | espeak "KOH-ahn"; ASR heard "Cohen"; no CMUdict entry | Likely fine. ASR mishearing a rare word |
| 33 | greengage | espeak "GREEN-gayj"; ASR heard "Ring edge"; no CMUdict entry | Likely fine. ASR noise on an unusual word |
| 49 | gopak | espeak "GAH-pak" (first vowel as in "father"); ASR heard "Got back" | Likely wrong first vowel: I expect "GOH-pahk" |
| 65 | schipperke | espeak "SKIP-erk", no final vowel; ASR heard "Skipperg" | Likely wrong: the usual ending is "-kee" |
| 81 | picaresque | espeak stresses the first syllable; CMUdict stresses the third | Likely wrong stress, and the dictionary agrees |
| 97 | broadleaf | espeak "BRAWD-leef"; ASR heard "Broadlies" | Likely fine. ASR mishearing the final sound |
| 113 | rouge | espeak "roozh", identical to CMUdict; ASR heard "Rose" | Likely fine. Short word, ASR slip |
| 129 | forlorn | espeak stresses the first syllable; CMUdict stresses the second; ASR heard "4 alarm" | Likely wrong stress ("for-LORN" expected) |
| 145 | purga | espeak "PUR-guh"; ASR heard "Per gay"; no CMUdict entry | Unclear. I am not sure of the usual pronunciation; listen |
| 161 | Borzoi | espeak "BOR-zoy"; ASR heard "Borsai" | Likely fine |
| 177 | jnana | espeak "JAY-NAH-nuh" with two stresses; ASR heard "Jane Anna" | Possibly wrong: the usual start is "j-NAH" or "g-YAH"; listen |
| 193 | umlaut | espeak "UM-lout"; ASR heard "I'm loud" | Likely fine. ASR splitting the word |
| 209 | wiseacre | espeak "WY-sack-er" (s and short a); ASR heard "Why Sucker" | Likely wrong: expected "WY-zay-ker" |
| 225 | catkin | espeak "KAT-kin"; ASR heard "Katkin" | Likely fine. Only the spelling differs |

Reading of the 15: 6 look wrong or worth a listen from the text (gopak, schipperke, picaresque, forlorn, wiseacre, jnana), 2 are open questions (foyer, purga), 7 look like ASR noise on a word whose phonemes look right. That is a reading of 15 words, not an accuracy rate.

### 15 unflagged words

| Word | Score | Evidence | Conclusion |
|---|---|---|---|
| parapet | 0.249 | espeak "PA-ruh-pit"; ASR heard "parabit" | Likely fine. Just under the line |
| cruller | 0.248 | espeak "KRUL-er"; ASR heard "Crullery" | Likely fine |
| begonia | 0.245 | espeak "buh-GOH-nee-uh"; ASR heard "Bagonia" | Likely fine |
| homogeneous | 0.245 | ASR heard it exactly, but espeak drops a syllable ("huh-MOH-jnee-us") against CMUdict ("-jee-nee-us") | Borderline: the clip may sound clipped even though ASR passed it |
| dearth | 0.242 | espeak "DURTH"; ASR heard "Dirth" | Likely fine |
| hock | 0.240 | espeak and CMUdict agree; ASR heard "Hug it" | Likely fine |
| madeleine | 0.240 | espeak "MAD-uh-lin" (stress first, short last vowel); CMUdict stresses the last syllable ("mad-uh-LEN"); ASR heard "Madeline" | Borderline: fine as the name, possibly off for the pastry |
| peloton | 0.240 | espeak "PEL-uh-ton"; ASR exact | Likely fine |
| adagio | 0.182 | espeak "a-DAH-jee-oh"; ASR exact | Likely fine; first vowel slightly full |
| détente | 0.181 | espeak and CMUdict agree ("day-TAHNT"); ASR heard "A day taunt" | Likely fine |
| protégé | 0.100 | espeak and CMUdict agree; ASR exact | Likely fine |
| Fahrenheit | 0.090 | ASR heard "Farron height" (sounds alike by CMUdict); espeak close to CMUdict | Likely fine |
| Buddha | 0.060 | all three agree | Likely fine |
| Swahili | 0.060 | all three agree | Likely fine |
| Kabuki | 0.104 | ASR exact; espeak close to CMUdict | Likely fine |

Reading of the 15: 13 look fine, 2 are borderline (homogeneous, madeleine). Both borderline words sit at 0.24 to 0.245, just under the line, so a lower threshold would catch them at the cost of a longer list. These were chosen to test the line, so the count of 2 says nothing about words further down.

### The two known-wrong words

- **croissant** is rank 3. ASR heard "Kwi-san", which supports the known fault, and espeak puts the stress on the first syllable while CMUdict puts it on the second.
- **blasé** is rank 59. By reading, espeak's phonemes ("blah-ZAY") look right, while CMUdict lists it as "blaze". ASR heard "Bluzzy", which suggests the audio is not clear. It is shortlisted by both signals, so the audit finds the known fault even though the phoneme string alone would not explain it.

### Limits seen in this run

- Signal A carries most of the top of the list. Signal B alone rarely moves a word over the line, because CMUdict is missing 261 words and the coarse classes hide voicing and vowel length.
- Many shortlisted words are rare words with no dictionary entry whose transcript is one letter off. Expect a large share of false alarms in the lower half of the list.
- A word the recogniser corrects toward a real word passes Signal A even if the clip is slightly off.
