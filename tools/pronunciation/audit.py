#!/usr/bin/env python3
"""Combine the three pronunciation signals and write the shortlist.

  python3 audit.py --work-dir <scratch folder> [--threshold 0.25] [--asr asr.json]

  --threshold X  shortlist words with score >= X (default 0.25, which gave 241 words on the recorded run;
                 0.30 is a stricter example that gave 113)
  --asr NAME     the transcript file inside the work folder (default asr.json)

The audit refuses to run, and writes nothing, when the transcript file is incomplete (a --limit smoke test,
a missing clip, a different word count than words.json), when espeak.json does not cover words.json, when
the CMUdict checksum is wrong, or when summary.md exists without both of its generated markers. All three
outputs are built in memory first and then written through temporary files, so a failure leaves the
committed outputs untouched.

Inputs (made by the other scripts, see README.md):
  <work-dir>/asr.json              asr.py            Signal A: what a speech recogniser heard
  <work-dir>/espeak.json           espeak.mjs        Signal B input: phonemes the Kokoro model is given
  <work-dir>/cmudict/cmudict.dict  setup_assets.py   Signal B input: CMU Pronouncing Dictionary
  words.json                                         word, group

Outputs, in this folder:
  scores.json    {"meta": ..., "words": [...]}: the run's inputs (words.json SHA-256, method versions,
                 threshold, weights) and every word with its signals and score (one line per word)
  flagged.json   the shortlist: words with score >= threshold, highest first
  summary.md     counts, threshold and method versions between the generated markers; text outside the
                 markers (the hand-written evidence review) is kept on re-runs

A score is a triage signal for a person to review, not a verdict.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

from metaphone import doublemetaphone

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

# ---- Scoring knobs (all in one place so a change is easy to see in a diff) ----
W_ASR = 0.50        # weight of Signal A (0 = heard exactly right, 1 = heard something unrelated)
W_DICT = 0.40       # weight of Signal B (0 = same coarse phonemes as CMUdict, 1 = very different)
DICT_SATURATION = 0.60   # a coarse-phoneme distance at or above this counts as the maximum for Signal B
NO_ENTRY_DICT = 0.35     # Signal B value used when the dictionary has no entry (0.35 * W_DICT = 0.14 points)
LOGPROB_FLOOR = -0.8     # average log-probability below this adds a small bump ...
LOGPROB_BUMP_MAX = 0.05  # ... of at most this many points (the recogniser was unsure)
STRESS_PENALTY = 0.15    # added to the phoneme distance when the primary-stress syllable differs
DEFAULT_THRESHOLD = 0.25
# Origin prior (Signal C): points added for a language group likely to keep a foreign pronunciation.
# Small on purpose: a prior alone can never put a word on the shortlist.
ORIGIN_PRIOR = {
    "French": 0.10, "Italian": 0.06, "Spanish": 0.06, "Arabic": 0.06, "Japanese": 0.06, "Slavic": 0.06,
    "Asian": 0.06, "German": 0.06, "Dutch": 0.04, "New World": 0.04, "Eponym": 0.04, "Greek": 0.02,
}

# ---- Coarse phoneme classes shared by espeak IPA and CMUdict ARPAbet ----
CONS = {"P", "T", "K", "F", "S", "SH", "TH", "CH", "M", "N", "L", "R", "W", "Y", "H"}
VOWELS = {"i", "e", "a", "ay", "aw", "o", "oy", "u", "@"}

ARPA = {
    "P": "P", "B": "P", "T": "T", "D": "T", "K": "K", "G": "K", "F": "F", "V": "F", "S": "S", "Z": "S",
    "SH": "SH", "ZH": "SH", "TH": "TH", "DH": "TH", "CH": "CH", "JH": "CH", "M": "M", "N": "N", "NG": "N",
    "L": "L", "R": "R", "W": "W", "Y": "Y", "HH": "H",
    "IY": "i", "IH": "i", "EH": "e", "EY": "e", "AE": "a", "AA": "a", "AY": "ay", "AW": "aw",
    "AO": "o", "OW": "o", "OY": "oy", "UW": "u", "UH": "u",
}

# Longest match first. Length marks and tie bars are dropped before matching.
IPA = [
    ("tʃ", ["CH"]), ("dʒ", ["CH"]), ("aɪ", ["ay"]), ("aʊ", ["aw"]), ("ɔɪ", ["oy"]), ("eɪ", ["e"]),
    ("oʊ", ["o"]), ("əʊ", ["o"]), ("ɑ̃", ["a", "N"]), ("ɔ̃", ["o", "N"]), ("ɛ̃", ["e", "N"]), ("æ̃", ["a", "N"]),
    ("ɚ", ["@", "R"]), ("ɝ", ["@", "R"]),
    ("p", ["P"]), ("b", ["P"]), ("t", ["T"]), ("d", ["T"]), ("ɾ", ["T"]), ("k", ["K"]), ("ɡ", ["K"]), ("g", ["K"]),
    ("f", ["F"]), ("v", ["F"]), ("s", ["S"]), ("z", ["S"]), ("ʃ", ["SH"]), ("ʒ", ["SH"]), ("θ", ["TH"]),
    ("ð", ["TH"]), ("m", ["M"]), ("n", ["N"]), ("ŋ", ["N"]), ("l", ["L"]), ("ɫ", ["L"]), ("ɹ", ["R"]),
    ("w", ["W"]), ("j", ["Y"]), ("h", ["H"]), ("ç", ["H"]), ("ɲ", ["N"]),
    ("i", ["i"]), ("ɪ", ["i"]), ("ɨ", ["i"]), ("ɛ", ["e"]), ("e", ["e"]), ("æ", ["a"]), ("a", ["a"]), ("ɑ", ["a"]),
    ("ʌ", ["a"]), ("ɐ", ["@"]), ("ə", ["@"]), ("ᵻ", ["@"]), ("ᵿ", ["@"]), ("ɜ", ["@"]),
    ("ɔ", ["o"]), ("o", ["o"]), ("ɒ", ["o"]), ("u", ["u"]), ("ʊ", ["u"]), ("ʉ", ["u"]), ("y", ["u"]),
]


def ipa_to_classes(ipa: str):
    """Returns (classes, primary-stress syllable index or None). IPA is matched as written (no Unicode
    normalisation, so a nasal vowel stays a base letter plus U+0303)."""
    classes, stress, syllable, pending = [], None, -1, False
    i = 0
    while i < len(ipa):
        if ipa[i] == "ˈ":
            pending = True
            i += 1
            continue
        for sym, cls in IPA:
            if ipa.startswith(sym, i):
                classes += cls
                if cls[0] in VOWELS:
                    syllable += 1
                    if pending and stress is None:
                        stress = syllable
                    pending = False
                i += len(sym)
                break
        else:
            i += 1  # length marks, secondary stress, spaces, unknown symbols: skipped, never guessed
    return classes, stress


ARPA_VOWELS = {"IY", "IH", "EH", "EY", "AE", "AA", "AY", "AW", "AO", "OW", "OY", "UW", "UH", "AH", "ER"}


def arpa_to_classes(phones):
    """Returns (classes, primary-stress syllable index or None) for a CMUdict pronunciation."""
    classes, stress, syllable = [], None, -1
    for p in phones:
        m = re.fullmatch(r"([A-Z]+)([012])?", p)
        base, st = m.group(1), m.group(2)
        if base == "ER":
            classes += ["@", "R"]
        elif base == "AH":
            classes.append("a" if st in ("1", "2") else "@")
        else:
            classes.append(ARPA[base])
        if base in ARPA_VOWELS:
            syllable += 1
            if st == "1" and stress is None:
                stress = syllable
    return classes, stress


def sub_cost(a: str, b: str) -> float:
    if a == b:
        return 0.0
    av, bv = a in VOWELS, b in VOWELS
    if av != bv:
        return 1.0
    if av:
        if "@" in (a, b):
            return 0.4
        if {a, b} <= {"a", "ay", "aw"} or {a, b} <= {"o", "oy", "aw"} or {a, b} <= {"e", "ay"}:
            return 0.4
        return 0.6
    return 0.7


def indel_cost(a: str) -> float:
    return 0.5 if a == "@" else 1.0


def phoneme_distance(x, y) -> float:
    """Weighted edit distance over class lists, divided by the longer length (0 = same, up to 1)."""
    if not x and not y:
        return 0.0
    prev = [0.0]
    for b in y:
        prev.append(prev[-1] + indel_cost(b))
    for a in x:
        cur = [prev[0] + indel_cost(a)]
        for j, b in enumerate(y, 1):
            cur.append(min(prev[j] + indel_cost(a), cur[j - 1] + indel_cost(b), prev[j - 1] + sub_cost(a, b)))
        prev = cur
    return min(1.0, prev[-1] / max(len(x), len(y)))


def lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


NUMBER_WORDS = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
                "sixteen seventeen eighteen nineteen twenty").split()


def spell_numbers(text: str) -> str:
    """The recogniser writes spoken numbers as digits ("zero" -> "0"); turn 0 to 20 back into words."""
    return re.sub(r"\b(\d{1,2})\b", lambda m: NUMBER_WORDS[int(m.group(1))] if int(m.group(1)) <= 20 else m.group(1), text)


def letters(text: str) -> str:
    s = unicodedata.normalize("NFD", text.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s)


def load_cmudict(path: Path):
    table = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        head, *phones = line.split()
        table.setdefault(re.sub(r"\(\d+\)$", "", head), []).append(phones)
    return table


def cmu_variants(table, text: str):
    """Class lists for a word or phrase from CMUdict, or [] when any part is missing.
    A hyphenated or spaced phrase is the concatenation of its parts' first pronunciations plus variants."""
    parts = [p for p in re.split(r"[\s-]+", unicodedata.normalize("NFD", text.lower())) if p]
    parts = ["".join(c for c in p if not unicodedata.combining(c)) for p in parts]
    parts = [re.sub(r"[^a-z']", "", p) for p in parts]
    if not parts or any(p not in table for p in parts):
        return []
    variants = [([], None)]
    for p in parts:
        nxt = []
        for prefix, _ in variants[:4]:
            for phones in table[p][:3]:
                nxt.append((prefix + phones, None))
        variants = nxt
    return [arpa_to_classes(v) for v, _ in variants]


def best_distance(esp_classes, esp_stress, variants):
    best = None
    for classes, stress in variants:
        d = phoneme_distance(esp_classes, classes)
        if esp_stress is not None and stress is not None and esp_stress != stress:
            n_esp = sum(c in VOWELS for c in esp_classes)
            n_cmu = sum(c in VOWELS for c in classes)
            if n_esp >= 2 and n_cmu >= 2:
                d = min(1.0, d + STRESS_PENALTY)
        if best is None or d < best[0]:
            best = (d, classes)
    return best


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    ap.add_argument("--asr", default="asr.json")
    args = ap.parse_args()
    work = Path(args.work_dir)

    words_path = REPO / "words.json"
    words = json.loads(words_path.read_text(encoding="utf-8"))
    words_sha = hashlib.sha256(words_path.read_bytes()).hexdigest()
    asr = load_json(work / args.asr, "transcript file (run asr.py)")
    esp = load_json(work / "espeak.json", "phoneme file (run espeak.mjs)")
    cmu_path = work / "cmudict" / "cmudict.dict"
    check_inputs(words, asr, esp, cmu_path)
    cmu = load_cmudict(cmu_path)

    rows = []
    for w in words:
        wid, word, group = w["id"], w["word"], w["group"]
        key = letters(word)
        a = asr["words"].get(str(wid))
        e = esp["words"][str(wid)]["espeak"]
        e_classes, e_stress = ipa_to_classes(e)
        variants = cmu_variants(cmu, word)
        reasons = []

        # Signal A
        if a is None:
            a_score, transcript, logprob, a_detail = 1.0, None, None, {"note": "no clip"}
            reasons.append("no clip to transcribe")
        else:
            transcript, logprob = a["transcript"], a["avg_logprob"]
            spoken = spell_numbers(transcript)
            heard = letters(spoken)
            if heard == key and heard:
                a_score, a_detail = 0.0, {"match": "exact"}
            elif not heard:
                a_score, a_detail = 1.0, {"match": "empty transcript"}
                reasons.append("empty transcript")
            else:
                letter_sim = 1 - lev(heard, key) / max(len(heard), len(key))
                sims = {"letters": letter_sim}
                if (set(doublemetaphone(heard)) & set(doublemetaphone(key))) - {""}:
                    sims["metaphone"] = 0.85
                t_variants = cmu_variants(cmu, spoken)
                if t_variants and variants:
                    sims["cmu"] = 1 - min(phoneme_distance(x, y) for x, _ in t_variants for y, _ in variants)
                best = max(sims, key=sims.get)
                a_score = round(1 - sims[best], 3)
                a_detail = {"match": best, "similarity": round(sims[best], 3)}
                if sims.get("metaphone") or sims.get("cmu", 0) >= 0.9:
                    reasons.append(f"ASR heard \"{transcript}\" (sounds alike, may be a spelling difference)")
                else:
                    reasons.append(f"ASR heard \"{transcript}\"")

        # Signal B
        if not variants:
            b_value, cmu_text, b_distance = NO_ENTRY_DICT, None, None
            reasons.append("no dictionary entry")
        else:
            b_distance, cmu_classes = best_distance(e_classes, e_stress, variants)
            b_value = min(1.0, b_distance / DICT_SATURATION)
            cmu_text = " ".join(cmu_classes)
            if b_value >= 0.5:
                reasons.append(f"espeak and CMUdict disagree (distance {b_distance:.2f})")

        # Signal C and the confidence bump
        prior = ORIGIN_PRIOR.get(group, 0.0)
        if prior:
            reasons.append(f"{group} origin")
        bump = 0.0
        if logprob is not None and logprob < LOGPROB_FLOOR:
            bump = min(LOGPROB_BUMP_MAX, (LOGPROB_FLOOR - logprob) * LOGPROB_BUMP_MAX)
            reasons.append(f"low ASR confidence ({logprob})")

        score = W_ASR * a_score + W_DICT * b_value + prior + bump
        rows.append({
            "id": wid, "word": word, "group": group, "score": round(score, 3),
            "signals": {"asr": round(a_score, 3), "dict": None if b_distance is None else round(b_distance, 3),
                        "origin": prior},
            "reasons": reasons, "asr": transcript, "cmu": cmu_text, "espeak": e, "espeak_classes": " ".join(e_classes),
        })

    rows.sort(key=lambda r: (-r["score"], r["id"]))
    flagged = [r for r in rows if r["score"] >= args.threshold]

    meta = {
        "words_json_sha256": words_sha, "word_count": len(words), "threshold": args.threshold,
        "asr": asr["meta"], "espeak": esp["meta"],
        "cmudict_sha256": setup_assets().CMUDICT_SHA256, "metaphone": importlib.metadata.version("Metaphone"),
        "weights": {
            "asr": W_ASR, "dict": W_DICT, "dict_saturation": DICT_SATURATION, "no_entry_dict": NO_ENTRY_DICT,
            "logprob_floor": LOGPROB_FLOOR, "logprob_bump_max": LOGPROB_BUMP_MAX, "stress_penalty": STRESS_PENALTY,
            "origin_prior": ORIGIN_PRIOR,
        },
    }

    def line_json(items):
        return "[\n" + ",\n".join(json.dumps(i, ensure_ascii=False) for i in items) + "\n]\n"

    short = [{k: r[k] for k in ("id", "word", "group", "score", "reasons", "asr", "cmu", "espeak")} for r in flagged]
    scores_text = '{"meta": ' + json.dumps(meta, ensure_ascii=False) + ',\n"words": ' + line_json(rows).rstrip("\n") + "}\n"
    flagged_text = line_json(short)
    summary_text = build_summary(rows, flagged, args, asr, esp, words_sha, len(words))

    # Everything is built; write each file to a temporary name first, then swap them in.
    outputs = {"scores.json": scores_text, "flagged.json": flagged_text, "summary.md": summary_text}
    for name, text in outputs.items():
        (HERE / (name + ".tmp")).write_text(text, encoding="utf-8")
    for name in outputs:
        os.replace(HERE / (name + ".tmp"), HERE / name)
    print(f"{len(rows)} words scored, {len(flagged)} flagged at threshold {args.threshold}")


def setup_assets():
    """Loads setup_assets.py from this folder (it holds the pinned checksums)."""
    sys.dont_write_bytecode = True  # keep a __pycache__ folder out of the repository
    spec = importlib.util.spec_from_file_location("setup_assets", HERE / "setup_assets.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_json(path: Path, what: str):
    if not path.exists():
        sys.exit(f"audit.py: missing {what}: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


MARK_START = "<!-- generated:start"
MARK_END = "<!-- generated:end -->"


def check_inputs(words, asr, esp, cmu_path: Path) -> None:
    """Exit non-zero, before anything is written, when an input is incomplete or not the pinned one."""
    problems = []
    ids = {str(w["id"]) for w in words}
    meta = asr.get("meta", {})
    if meta.get("limit"):
        problems.append(f"the transcript file was made with --limit {meta['limit']} (a smoke test); run asr.py without it")
    if meta.get("words_total") not in (None, len(words)):
        problems.append(f"the transcript file was made for {meta['words_total']} words, words.json has {len(words)}")
    if meta.get("missing_clips"):
        problems.append(f"{len(meta['missing_clips'])} clips were missing when the transcripts were made")
    if meta.get("words") != len(words):
        problems.append(f"the transcript file holds {meta.get('words')} words, words.json has {len(words)}")
    missing_asr = ids - set(asr.get("words", {}))
    if missing_asr:
        problems.append(f"{len(missing_asr)} word ids have no transcript")
    missing_esp = ids - set(esp.get("words", {}))
    if missing_esp:
        problems.append(f"{len(missing_esp)} word ids have no espeak phonemes")
    for key in ("kokoro-js", "phonemizer", "lang"):
        if key not in esp.get("meta", {}):
            problems.append(f"espeak.json meta has no '{key}'")
    for key in ("model", "voice", "faster_whisper", "ctranslate2", "decoding", "seconds"):
        if key not in meta:
            problems.append(f"the transcript file meta has no '{key}'")
    if not cmu_path.exists():
        problems.append(f"{cmu_path} not found (run setup_assets.py)")
    else:
        got = hashlib.sha256(cmu_path.read_bytes()).hexdigest()
        if got != setup_assets().CMUDICT_SHA256:
            problems.append(f"cmudict.dict SHA-256 is {got}, not the pinned one (run setup_assets.py)")
    summary = HERE / "summary.md"
    if summary.exists():
        text = summary.read_text(encoding="utf-8")
        if text.count(MARK_START) != 1 or text.count(MARK_END) != 1 or text.index(MARK_START) > text.index(MARK_END):
            problems.append("summary.md does not have exactly one generated:start and one generated:end marker; "
                            "restore it with git checkout -- tools/pronunciation/summary.md")
    if problems:
        sys.exit("audit.py: refusing to run, nothing was written:\n  - " + "\n  - ".join(problems))


def build_summary(rows, flagged, args, asr, esp, words_sha, word_count):
    n = len(rows)
    exact = sum(1 for r in rows if r["signals"]["asr"] == 0.0)
    asr_mismatch = sum(1 for r in rows if r["signals"]["asr"] > 0)
    asr_far = sum(1 for r in rows if r["signals"]["asr"] >= 0.5)
    no_entry = sum(1 for r in rows if r["signals"]["dict"] is None)
    dict_far = sum(1 for r in rows if r["signals"]["dict"] is not None and r["signals"]["dict"] >= 0.5 * DICT_SATURATION)
    prior_words = sum(1 for r in rows if r["signals"]["origin"] > 0)
    by_group = {}
    for r in flagged:
        by_group[r["group"]] = by_group.get(r["group"], 0) + 1
    totals = {}
    for r in rows:
        totals[r["group"]] = totals.get(r["group"], 0) + 1
    in_short = {r["word"].lower() for r in flagged}
    m = asr["meta"]

    def thr(t):
        return sum(1 for r in rows if r["score"] >= t)

    ladder = ", ".join(f"{t:.2f}: {thr(t)}" for t in (0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50))
    lines = [
        MARK_START + " (written by audit.py; do not edit by hand) -->",
        "## Run summary",
        "",
        f"- Inputs: words.json SHA-256 `{words_sha}` ({word_count} words). If `shasum -a 256 words.json` no longer "
        "matches, this shortlist is stale.",
        f"- Words scored: {n}. Shortlisted: **{len(flagged)}** at score >= {args.threshold}.",
        f"- Signal A (speech round trip): {exact} words transcribed exactly as spelled; {asr_mismatch} differ in some "
        f"way, of which {asr_far} are far from the word (similarity of 0.5 or less). Clips transcribed: {m['words']}; "
        f"clips missing: {len(m['missing_clips'])}.",
        f"- Signal B (espeak against CMUdict): {no_entry} words have no CMUdict entry; "
        f"{dict_far} have a coarse-phoneme distance of at least {0.5 * DICT_SATURATION:.2f}.",
        f"- Signal C (origin prior): {prior_words} words belong to a group with a bump; the bump is at most "
        f"{max(ORIGIN_PRIOR.values()):.2f} points, so it cannot shortlist a word alone.",
        "",
        f"Score = {W_ASR} x A + {W_DICT} x B + origin bump + at most {LOGPROB_BUMP_MAX} for low recogniser confidence. "
        "A is 1 minus the best of letter similarity, a double-metaphone match (0.85) and CMU phoneme similarity of "
        f"the transcript. B is the weighted phoneme distance divided by {DICT_SATURATION} (cap 1), plus "
        f"{STRESS_PENALTY} when the stressed syllable differs; a word with no entry counts as {NO_ENTRY_DICT}.",
        "",
        f"Words at or above a score, for choosing the threshold: {ladder}.",
        "",
        "Shortlist by language group (shortlisted of total):",
        "",
        "| Group | Shortlisted | Total |",
        "|---|---|---|",
    ]
    for g in sorted(totals, key=lambda g: (-by_group.get(g, 0), g)):
        lines.append(f"| {g} | {by_group.get(g, 0)} | {totals[g]} |")
    lines += ["", "Precision check, known-wrong words:", ""]
    for w in ("croissant", "blasé"):
        hit = next((r for r in rows if r["word"].lower() == w), None)
        if hit is None:
            lines.append(f"- {w}: not in words.json, so not checked.")
            continue
        rank = rows.index(hit) + 1
        lines.append(f"- {w}: {'IN' if w in in_short else 'NOT in'} the shortlist (score {hit['score']}, "
                     f"rank {rank} of {n}; heard \"{hit['asr']}\"; reasons: {'; '.join(hit['reasons']) or 'none'}).")
    lines += [
        "",
        "Method versions:",
        "",
        f"- Recogniser: faster-whisper {m['faster_whisper']} with CTranslate2 {m['ctranslate2']}, model {m['model']} "
        f"(pinned revision in setup_assets.py), {m['decoding']}; voice {m['voice']}; transcription took "
        f"{m['seconds']} s.",
        f"- Phonemes: kokoro-js {esp['meta']['kokoro-js']} and phonemizer {esp['meta']['phonemizer']} (espeak-ng), "
        f"language {esp['meta']['lang']}, with kokoro-js's replacements (espeak.mjs lists the one it leaves out).",
        "- Dictionary: CMU Pronouncing Dictionary (cmudict.dict), pinned commit and SHA-256 in setup_assets.py.",
        f"- Scoring: audit.py in this folder; knobs are at its top. Metaphone {importlib.metadata.version('Metaphone')}.",
        MARK_END,
    ]
    block = "\n".join(lines)
    path = HERE / "summary.md"
    if not path.exists():
        return "# Pronunciation audit: summary\n\n" + block + "\n"
    old = path.read_text(encoding="utf-8")
    a, b = old.index(MARK_START), old.index(MARK_END) + len(MARK_END)
    return old[:a] + block + old[b:]


if __name__ == "__main__":
    main()
