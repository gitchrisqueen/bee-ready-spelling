#!/usr/bin/env python3
"""Download the two pinned inputs of the audit into a scratch folder and verify their SHA-256.

  python3 setup_assets.py --work-dir <scratch folder> [--model base.en]

Nothing is written inside the repository. Downloads:
  * CMU Pronouncing Dictionary (cmudict.dict) from the cmusphinx/cmudict repository at one pinned commit.
  * The faster-whisper (CTranslate2) conversion of the Whisper English model, at one pinned revision.
"""
import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

CMUDICT_COMMIT = "74790861f652b15e4ac49015a90074ad62a27690"
CMUDICT_URL = f"https://raw.githubusercontent.com/cmusphinx/cmudict/{CMUDICT_COMMIT}/cmudict.dict"
CMUDICT_SHA256 = "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22"

# model name -> (Hugging Face repo, pinned revision, SHA-256 of model.bin)
MODELS = {
    "base.en": (
        "Systran/faster-whisper-base.en",
        "3d3d5dee26484f91867d81cb899cfcf72b96be6c",
        "2a166925539a16005f14ff328359f9b9adb9dc4fb631bb3b227526862e93e2ef",
    ),
    "small.en": (
        "Systran/faster-whisper-small.en",
        "d1d751a5f8271d482d14ca55d9e2deeebbae577f",
        "62b2a45b05ee59acb4a5341b33ee35e041395d378d418a18acfe4c9e768ee37a",
    ),
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check(path: Path, expected: str) -> None:
    got = sha256(path)
    if got != expected:
        sys.exit(f"SHA-256 mismatch for {path.name}: expected {expected}, got {got}. Delete the file and retry.")
    print(f"ok  {path.name}  sha256 {got}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--model", default="base.en", choices=sorted(MODELS))
    args = ap.parse_args()
    work = Path(args.work_dir)

    cmu = work / "cmudict" / "cmudict.dict"
    cmu.parent.mkdir(parents=True, exist_ok=True)
    if not cmu.exists():
        print("downloading CMUdict", CMUDICT_COMMIT)
        urllib.request.urlretrieve(CMUDICT_URL, cmu)
    check(cmu, CMUDICT_SHA256)

    repo, revision, model_sha = MODELS[args.model]
    from huggingface_hub import snapshot_download

    target = work / "models" / args.model
    snapshot_download(repo_id=repo, revision=revision, local_dir=str(target))
    check(target / "model.bin", model_sha)


if __name__ == "__main__":
    main()
