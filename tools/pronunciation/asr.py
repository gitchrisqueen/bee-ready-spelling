#!/usr/bin/env python3
"""Signal A: transcribe every word clip with a local Whisper model (faster-whisper, no API key).

  python3 asr.py --work-dir <scratch folder> [--model base.en] [--voice af_heart]

Reads words.json and clips/<voice>/<key>.mp3 from the repository, writes <work-dir>/asr.json.
Decoding is deterministic (beam 5, temperature 0, no conditioning on earlier text).
"""
import argparse
import json
import time
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def clip_key(text: str) -> str:
    """Port of clipKey in voice-service.js: lowercase, accents dropped, anything but a-z 0-9 - becomes _."""
    s = unicodedata.normalize("NFD", str(text).strip().lower())
    s = "".join(c for c in s if not 0x300 <= ord(c) <= 0x36F)
    return "".join(c if (c.isascii() and (c.isalnum() or c == "-")) else "_" for c in s)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--model", default="base.en")
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--limit", type=int, default=0, help="only the first N words (smoke test)")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--out", default="asr.json", help="output file name inside the work dir")
    args = ap.parse_args()
    work = Path(args.work_dir)

    import av
    import ctranslate2
    import faster_whisper
    from faster_whisper import WhisperModel

    words = json.loads((REPO / "words.json").read_text(encoding="utf-8"))
    if args.limit:
        words = words[: args.limit]
    model = WhisperModel(str(work / "models" / args.model), device="cpu", compute_type="int8", cpu_threads=args.threads)

    out, missing = {}, []
    started = time.time()
    for i, w in enumerate(words, 1):
        path = REPO / "clips" / args.voice / f"{clip_key(w['word'])}.mp3"
        if not path.exists():
            missing.append(w["word"])
            continue
        segments, _info = model.transcribe(
            str(path), language="en", beam_size=5, temperature=0.0,
            condition_on_previous_text=False, vad_filter=False, without_timestamps=True,
        )
        segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        logprob = round(sum(s.avg_logprob for s in segs) / len(segs), 3) if segs else None
        out[str(w["id"])] = {"word": w["word"], "transcript": text, "avg_logprob": logprob}
        if i % 100 == 0:
            print(f"{i}/{len(words)} words, {time.time() - started:.0f}s", flush=True)

    result = {
        "meta": {
            "model": args.model, "voice": args.voice, "faster_whisper": faster_whisper.__version__,
            "ctranslate2": ctranslate2.__version__, "av": av.__version__,
            "decoding": "beam_size=5, temperature=0, language=en, compute_type=int8, no VAD, no prompt",
            "seconds": round(time.time() - started), "words": len(out), "missing_clips": missing,
        },
        "words": out,
    }
    target = work / args.out
    target.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {target}: {len(out)} transcripts, {len(missing)} missing clips, {result['meta']['seconds']}s")


if __name__ == "__main__":
    main()
