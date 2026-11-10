# Test fixtures

`wiktionary-extracts.json` holds plain-text page extracts that were fetched from `simple.wiktionary.org` and
`en.wiktionary.org` on 2026-11-10 (the Wikimedia Action API, `prop=extracts`), for 50 named words. A `null` means the
page did not exist or the request failed. They are used only by `tests/mine-lookup-parse.test.mjs`.

The text is from Wiktionary and is available under the Creative Commons Attribution-ShareAlike 4.0 licence
(https://creativecommons.org/licenses/by-sa/4.0/). Each entry's source page is
`https://<host>/wiki/<word>`, where its authors are listed in the page history. These files are not part of the
deployed site.
