# Library generator

Builds the static word library (`library/<letter>.json`, `a` to `z`, and `library/NOTICE.md`) from open sources, and the child-safety filter hash file (`mine/filter.sha256`). It runs by hand, offline from the site, and is not deployed. The plan is in `docs/my-words-plan.md` ("Library generator").

Needs Node 22 and `curl`. There are no npm dependencies. Everything downloaded is untrusted data: keep it in its own directory outside the repository (below, `/tmp/library-inputs`), and never commit it.

## What goes into library v1

- **Seed word list: New General Service List 1.2** (CC BY-SA 4.0, 2,809 words), the plain CSV `NGSL_12_stats.csv` from the list's own site. The build keeps the lemmas that are 2 or more lowercase letters (case is ignored, so `TRUE` becomes `true`) and drops any word the child-safety filter blocks. A word's priority is its frequency rank in the CSV, and that order decides which words are cut first if the size budget is ever exceeded.
- **Definition and part of speech:** the Simple English Wiktionary sense, else the Open English WordNet gloss. A definition that opens with a bracketed note is used only if no other one works.
- **Sentence:** only an example from those two sources. It is kept if it has no digits, quotation marks, brackets, colons or dashes (a sentence is read aloud, and a dash often holds a source credit), passes the same checks as the page (`cleanField` with the 160-character cap, and `sentenceHasWordOnce`) and has the word exactly once as a whole word. A word with no such example has no `sentence` key.
- **Origin (`group`):** `originLabel()` from `mine/origin.js`, fed with the English Wiktionary `etymology_text`. The extract starts that text with an "Etymology tree" block, one ancestor per line, which would make every word look Indo-European or Latin first. The build therefore removes the tree, uses only the first paragraph and cuts it before any "cognate", "compare", "doublet of", "displaced", "eclipsed", "related to" or "more at" remark (`etymologyText()` in `build.mjs`). If no label results, `group` is left out.
- **Budget:** each shard under 150,000 bytes and the whole library under 3,000,000. If a build goes over, the words with the highest rank number are cut, one at a time, until it fits. The v1 build is far under both limits, so nothing is cut.
- If NGSL ever becomes unavailable, the agreed fallback is: single-word, lowercase, letters-only headwords found in both the Simple English Wiktionary extract and Open English WordNet, with words that have an example sentence first and then alphabetical order. That fallback is not implemented, because NGSL was available.

Inputs are pinned (URL, size, SHA-256, licence) in `tools/library/sources.json`. `build.mjs` checks each file against it and exits non-zero on a mismatch.

## 1. Download the inputs

```bash
mkdir /tmp/library-inputs      # must be a new, empty directory
cd /tmp/library-inputs
curl -fsSL -O https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv
curl -fsSL -O https://en-word.net/static/english-wordnet-2025.xml.gz
curl -fsSL -O https://kaikki.org/dictionary/downloads/simple/simple-extract.jsonl.gz
curl -fSL --retry 5 -O https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl   # 3.4 GB
cd -
```

(`curl -L` is needed for the WordNet URL only if it redirects; `-O` writes each file under its own name, which is the name `sources.json` expects.)

### The English extract is deprecated upstream

kaikki.org marks `kaikki.org-dictionary-English.jsonl` as DEPRECATED and says it will be removed. It was downloaded once on 2026-11-10 and pinned: 3,431,211,190 bytes, SHA-256 `ce2b80e5ad1132f14cedd2f531a606e1f0c6aeab422d50515e88db13a16a59a7`. If the URL returns 404, use the fallback `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz` (about 2.9 GB), keep only the lines whose `lang` is `English`, write them to a file named `kaikki.org-dictionary-English.jsonl`, and then:

1. update the `english-wiktionary` entry in `tools/library/sources.json` (url, bytes, sha256, measured date);
2. regenerate every shard, and review the diff, because the raw dump may word its etymologies differently;
3. check that the origin counts look sane (the build prints them).

## 2. Verify the downloads

The build does this itself, but you can check by hand first:

```bash
cd /tmp/library-inputs && sha256sum *
```

Compare with `sources.json` (for example `jq -r '.inputs[] | "\(.sha256)  \(.file)"' tools/library/sources.json`).

## 3. Build the filter

The filter list is the English list of LDNOOBW (CC BY 4.0). The exact commit, hash and steps are in `mine/FILTER-NOTICE.md`.

```bash
mkdir /tmp/library-filter-src
curl -fsSL -o /tmp/library-filter-src/en \
  https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/en
node tools/library/build-filter.mjs /tmp/library-filter-src/en
```

This writes `mine/filter.sha256` (SHA-256 hashes only; no plain word is ever written). Build the filter before the library, because the library build loads it and skips every word it blocks.

## 4. Build the library

```bash
node tools/library/build.mjs --inputs /tmp/library-inputs
```

It takes about 1.5 minutes (hashing and streaming the 3.4 GB file) and writes `library/a.json` to `library/z.json` and `library/NOTICE.md`. The same inputs always give the same output.

To regenerate just one shard, for example `library/a.json` (this does not rewrite `NOTICE.md` or check the total size):

```bash
node tools/library/build.mjs --inputs /tmp/library-inputs --letter a
```

`--out <dir>` writes somewhere other than `library/`.

## 5. Test

```bash
node --test tests/mine-library.test.mjs
```

It checks every shard against `mine/validate.js` with the real filter, the size budget, the notice and the pinned sources. A reviewer should also read a sample of sentences and definitions by eye: the filter is a word list, not a judgement of context.

## Licences

Shard text derived from Wiktionary is CC BY-SA 4.0. Text derived from Open English WordNet is CC BY 4.0 with the Princeton WordNet notice. The word selection comes from NGSL (CC BY-SA 4.0). `library/NOTICE.md` records each source, its licence and its attribution line, and is rewritten by every full build.
