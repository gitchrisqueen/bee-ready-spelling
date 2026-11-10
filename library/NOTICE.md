# Library notice: sources and licences

Each `library/<letter>.json` shard is a derived data set. Every text field in it comes from the open sources below. Nothing in a shard was written by a model or by this project; the only changes made are listed under "What was changed".

| Field | Where it comes from |
|---|---|
| Word (the key) | Chosen from the New General Service List 1.2 (2723 words kept) |
| `part`, `definition` | Simple English Wiktionary (2650 words), otherwise Open English WordNet (73 words) |
| `sentence` | An example sentence from Simple English Wiktionary (2081), otherwise from Open English WordNet (382) |
| `group` | The language named in the English Wiktionary etymology (2472 words) |

## Licences

- Text derived from Wiktionary (Simple English Wiktionary and English Wiktionary) is licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Share-alike applies to that text.
- Text derived from Open English WordNet is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) and carries the Princeton WordNet notice below.
- The word selection comes from the New General Service List, licensed under CC BY-SA 4.0.
- The rest of the repository keeps its own terms; this notice covers the files in `library/`.

## Sources

### New General Service List 1.2

- Source: https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv
- Licence: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: New General Service List by Browne, C., Culligan, B., and Phillips, J. (https://www.newgeneralservicelist.com), licensed under CC BY-SA 4.0.
- File used: `NGSL_12_stats.csv`, 62566 bytes, SHA-256 `2098bab8955a120a9766c6282a51d7d578c6cb0a7d946600d2ffb73ba25a0b44`, measured 2026-11-10

### Simple English Wiktionary

- Source: https://kaikki.org/dictionary/downloads/simple/simple-extract.jsonl.gz
- Licence: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: Text from Simple English Wiktionary (https://simple.wiktionary.org), extracted by Wiktextract (https://kaikki.org).
- File used: `simple-extract.jsonl.gz`, 4726754 bytes, SHA-256 `79afd871e342db3b87c3f2044ed21efa312e4c4ee006814b57c4cf4536ef70a1`, measured 2026-11-10

### Open English WordNet 2025

- Source: https://en-word.net/static/english-wordnet-2025.xml.gz
- Licence: CC BY 4.0 plus the Princeton WordNet notice (https://creativecommons.org/licenses/by/4.0/)
- Attribution: Open English WordNet 2025 (https://en-word.net, https://github.com/globalwordnet/english-wordnet), derived from Princeton WordNet 3.1.
- File used: `english-wordnet-2025.xml.gz`, 11363503 bytes, SHA-256 `9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe`, measured 2026-11-10

### English Wiktionary

- Source: https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl
- Licence: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: Etymology data from English Wiktionary (https://en.wiktionary.org), extracted by Wiktextract (https://kaikki.org).
- File used: `kaikki.org-dictionary-English.jsonl`, 3431211190 bytes, SHA-256 `ce2b80e5ad1132f14cedd2f531a606e1f0c6aeab422d50515e88db13a16a59a7`, measured 2026-11-10

## Princeton WordNet notice

Open English WordNet is derived from Princeton WordNet. Its licence file (`WNDB_License.txt` in
https://github.com/globalwordnet/english-wordnet) reads:

> This software and database is being provided to you, the LICENSEE, by the Open English Wordnet team under the
> Creative Commons Attribution 4.0 International License (CC-BY 4.0).
>
> Open English Wordnet 2023 Copyright 2023 by the Open English Wordnet team.
>
> Permission to use, copy, modify and distribute this software and database and its documentation for any
> purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following
> copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the
> software, database and documentation, including modifications that you make for internal use or for
> distribution.
>
> WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.
>
> THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR
> WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO
> REPRESENTATIONS OR WARRANTIES OF MERCHANT- ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF
> THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS,
> TRADEMARKS OR OTHER RIGHTS.
>
> The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to
> distribution of the software and/or database. Title to copyright in this software, database and any
> associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve
> same.

## What was changed

- A definition or sentence has its first letter capitalised and a full stop added where it had no final mark.
- A sentence is kept only if it contains its word exactly once as a whole word; a definition or sentence that is
  over its length cap (200 and 160 characters), or that holds markup, a link or a
  word the child-safety filter blocks, is dropped.
- The origin label is the first non-English language named in the first paragraph of the English Wiktionary
  etymology, mapped to a base name (for example "Old French" becomes "French").
- Words are listed in code-point order, one entry per line.

## Corrections and complaints

A bad definition or sentence, or a licence or attribution problem, is fixed by pull request in this repository.
See "Ownership and incidents" in `docs/my-words-plan.md`.
