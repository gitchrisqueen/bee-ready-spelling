# Child-safety filter: source and licence

`mine/filter.sha256` holds the SHA-256 of each word the child-safety filter (`mine/filter.js`) blocks, one per line, sorted. It holds no plain words. The repository owner owns the file.

## Source

| Item | Value |
|---|---|
| List | "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (LDNOOBW), the English list (file `en`) |
| URL | https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words |
| Commit | `5faf2ba42d7b1c0977169ec3611df25a3c08eb13` (latest commit on `master` when read on 2026-11-10, dated 2020-07-13) |
| Raw file | https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/en (3,777 bytes, SHA-256 `af851ecef1d5f212caba17339b12ac39cc2fef7d78c74876f67237644fcee8bd`) |
| Licence | Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/ |
| Licence evidence | The repository's `LICENSE` file at that commit is the CC BY 4.0 legal text, its `README.md` says "This work is licensed under a Creative Commons Attribution 4.0 International License", and the GitHub licence field reads `CC-BY-4.0`. |

The licence allows reuse, including a derived work, with attribution. Hashing and normalising the entries is an adaptation, and it is marked as one here.

## Attribution text

> Child-safety word list derived from "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (LDNOOBW), copyright 2012-2020 Shutterstock, Inc., https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: each entry was normalised (lowercase, accents removed, letters only) and replaced by its SHA-256 hash; multi-word phrases, entries with digits or symbols, and entries shorter than two letters were left out.

## What was done to the list

`tools/library/build-filter.mjs` reads the downloaded list and, for each line:

1. Normalises it the way `variants()` in `mine/filter.js` does: accents stripped, lowercase, letters a-z only.
2. Skips an entry shorter than 2 letters, and an entry with a digit or a symbol other than a hyphen or apostrophe (stripping it would change its meaning).
3. Skips a multi-word phrase, unless every word in it is itself a single-word entry (then it adds nothing new).
4. Writes the SHA-256 of each remaining word, sorted and unique, under `#` header lines that name the source, commit, licence, date and count.

Counts for the commit above: 403 lines, 276 single words hashed, 122 multi-word phrases skipped, 5 entries skipped for a digit or symbol. The file has 276 hashes.

## Limits

This is a deny-list of one source. It will not catch every unsafe word, every spelling variant or a definition that is unsafe in context, and it can block a harmless word that the source lists. The review screen, where a grown-up accepts or edits what is saved, is the second control (see `docs/my-words-plan.md`). A harmless word that is blocked by mistake is fixed by regenerating the file from a changed list, never by editing a hash by hand.

## How to regenerate

```bash
mkdir -p /tmp/library-filter-src
curl -sSL -o /tmp/library-filter-src/en \
  https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/en
sha256sum /tmp/library-filter-src/en
node tools/library/build-filter.mjs /tmp/library-filter-src/en --date YYYY-MM-DD
```

The `sha256sum` output must match the table above. To move to a newer commit, change the commit in the URL, the `SOURCE` constant in `tools/library/build-filter.mjs` and this file, then run the library build again, because the library skips every word the filter blocks.
