# My words: Phase 0 findings

Measured and read on 2026-11-10. Anything marked **not verified** was not checked. Nothing here is legal advice.

## Decisions this note settles

| Question | Decision |
|---|---|
| Live dictionary API (import time) | The Wikimedia Action API with `origin=*`: `simple.wiktionary.org` first (child-readable definition and example), then `en.wiktionary.org` for etymology and for words Simple lacks. Keyless, CORS enabled. |
| Seed for the static library | Open English WordNet 2025 (CC BY 4.0) for part of speech, definition and example; an origin label from English Wiktionary etymology; Simple English Wiktionary (CC BY-SA 4.0) as a gap filler, with provenance kept per field. |
| OCR | Tesseract.js 7.0.0 (Apache-2.0), default `eng` model `4.0.0_best_int`, self-hosted, with a photo pre-processing step. |
| Merriam-Webster | Link-out only. Its terms: free use is non-commercial, at most 1,000 queries per day per reference work, at most two reference works, and no automated or recorded queries without written approval (terms of service, `dictionaryapi.com/info/terms-of-service`, §2 and §5(a)). |

## Live dictionary API

I called each endpoint with `curl` and an `Origin` header on 2026-11-10.

| Endpoint | CORS | What it returns | Verdict |
|---|---|---|---|
| `https://en.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=<word>&format=json&origin=*` | `access-control-allow-origin: *` | Plain-text page extract with the Etymology section, parts of speech and definitions. Must be parsed. | **Chosen** (with the Simple English site first) |
| `https://simple.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=<word>&format=json&formatversion=2&origin=*` | `access-control-allow-origin: *` (curl with an `Origin` header, 2026-11-10) | Child-readable definition and example, but thin coverage. An unknown word returns `"missing": true`. | Chosen, pending the parse check below; first in order |
| `https://api.dictionaryapi.dev/api/v2/entries/en/<word>` | `*` | Clean JSON: part of speech, definitions, sometimes an example, a CC BY-SA licence field. No etymology in the responses checked. One 502 was seen during research. The maintainer asks for donations to cover server costs. | Optional fallback only |
| `https://en.wiktionary.org/api/rest_v1/page/definition/<word>` | `*` | Definitions as HTML, no etymology. The MediaWiki documentation calls it experimental and says RESTBase is being deprecated. | Not used |
| `https://api.datamuse.com/words?sp=<word>&md=dpr` | Reflects the origin | Definitions, part of speech, pronunciation. The site says an API key is required from 2027-02-01. | Not used: it stops being keyless |

Wikimedia limits (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits, new for 2026 and may change): 200 requests per minute for unauthenticated browser requests, 3 or fewer concurrent, honour `Retry-After` on a 429. The import code will use at most 3 concurrent lookups and cache each result in the browser. A typical weekly list is well inside the limit; a very long list of missing words can reach it (see Phase 1 results).

Text from Wiktionary is CC BY-SA 4.0. The page must credit the source and link to the entry.

**Verified on 2026-11-10 with `curl`:** both `en.wiktionary.org` and `simple.wiktionary.org` answer a preflight (`OPTIONS` with `Access-Control-Request-Headers: api-user-agent`) with status 200, `access-control-allow-headers: api-user-agent` and `access-control-allow-origin: *`; both answer a `GET` with `origin=*` with `access-control-allow-origin: *`. This is the server side only: no browser was used.

**Not verified:** how an Etymology parser behaves across many words (see the entry checks below); the `dictionaryapi.dev` rate-limit window; the one `502` from `dictionaryapi.dev` was seen once by the source research and is not reproduced here.

### Phase 1 entry checks

Each open item above has a check that Phase 1 runs before the lookup host is allowed, with a decided fallback:

| Check | Fallback if it fails |
|---|---|
| A parser test over at least 50 named words (listed in `tests/mine-lookup-parse.test.mjs`, mixing common words, loanwords and words missing from one site) extracts a clean origin label, or correctly reports "not available", from the Etymology section of the English extract | Show "origin not available" for the words the parser cannot read; never show unparsed text |
| The same test file parses the Simple English extract (the page's default heading format, `== Heading ==`): a definition and an example from the plain text, and the `"missing": true` case, over the same 50 words | Fall through to `en.wiktionary.org`, then to manual entry; never show unparsed text |
| A browser test in `tools/device-test` (WebKit emulation) makes one lookup to each host with the planned request headers and gets a response | Drop the `Api-User-Agent` header (the browser's own `User-Agent` is sent), or use `en.wiktionary.org` only |
| Request volume for a 200-word list stays under the browser limit of 200 requests per minute with at most 3 requests at a time | Lower the concurrency, or slow the queue and show progress with a Cancel button |

Contact for the Wikimedia User-Agent policy: the policy asks for contact details in the `User-Agent`. A page script cannot set `User-Agent`, so the planned header is `Api-User-Agent: BeeReady/1.0 (https://github.com/gitchrisqueen/bee-ready-spelling)`, whose contact is the repository, owned by the repository owner.

## How to read the figures below

The library and OCR figures in the next two sections were measured by the author during the spike. The scripts and test images were kept outside this repository, so they are **author-measured and not reproducible from this repository alone**. Where a figure comes from a public source, the source is named so a reader can re-derive it:

- Package versions and licences: `npm view tesseract.js@7.0.0 version license` and `npm view tesseract.js-core@7.0.0 version license`.
- Model and core sizes: `curl -sI https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz` (the `content-length` header), the same for the files under `https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/` and `https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/`, and the `fast` model from the `tessdata_fast` repository on GitHub.
- Library source sizes: the `content-length` of `https://en-word.net/static/english-wordnet-2025.xml.gz` and of `https://kaikki.org/dictionary/downloads/simple/simple-extract.jsonl.gz` (listed on `https://kaikki.org/dictionary/rawdata.html`) and `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl` (listed on `https://kaikki.org/dictionary/English/index.html` as 3.2GB, which is 3,431,211,190 bytes in binary units and about 3.4 GB in decimal units).
- Coverage figures (examples and etymology on the Simple English records): counted by streaming `simple-extract.jsonl.gz` from that page.
- Word count of NGSL 1.2: the list's own page, `https://www.newgeneralservicelist.com/new-general-service-list`.
- OCR accuracy and timing: produced by the author's own scripts on synthetic images. No public artifact exists; Phase 2 adds generated fixtures and tests to the repository so the figures can be re-run.

## Seed data for the static library

| Source | Licence | What it has | Notes |
|---|---|---|---|
| Open English WordNet 2025 | CC BY 4.0 plus the Princeton WordNet notice | Part of speech, glosses, examples on about 32% of senses. No etymology. Download: 11,363,503 bytes (`content-length`, 2026-11-10). | No share-alike. The only attribution-only candidate. |
| Simple English Wiktionary (via kaikki.org extract) | CC BY-SA 4.0 | The most child-readable definitions. Etymology on about 11% of records, examples on about 22%. Download: 4,726,754 bytes (`content-length`, 2026-11-10). | Share-alike: any shard that copies its text is CC BY-SA. |
| English Wiktionary (via kaikki.org) | CC BY-SA 4.0 | Etymology text. The file `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl` has `content-length` 3,431,211,190 bytes (about 3.4 GB; last modified 2026-10-30, read with `curl -sI` on 2026-11-10). The raw all-language dump listed on the kaikki raw-data page is a different, larger file. kaikki.org marks this English file DEPRECATED and to be removed "in the near future" (`https://kaikki.org/dictionary/English/index.html`). If it is gone, use `raw-wiktextract-data.jsonl.gz` from the raw-data page (about 2.9 GB compressed), filtered to English entries, and regenerate and re-review the shards. | Used at build time only, for an origin language label. Definitions are often adult-level or archaic (the `abdicate` entry starts with an obsolete sense). |

Sample definitions fetched during research:

- abdicate: Simple Wiktionary "When a ruler abdicates, he formally gives up his power and reign over a country."; WordNet "give up, such as power, as of monarchs and emperors, or duties and obligations".
- cemetery: Simple Wiktionary "A place where dead people are buried; a place for graves."; WordNet "a tract of land used for burials".

**Licence plan.** Library shards live in their own folder with their own notice file stating the source and licence of each field. Wiktionary-derived text carries CC BY-SA 4.0 and a link back; WordNet-derived text carries CC BY 4.0 and the Princeton notice. The rest of the repository keeps its current terms. This follows the Creative Commons FAQ position that a collection does not have to be released under the share-alike licence, while each adapted work keeps it. Whether a page that renders shard text counts as an adaptation of the whole page is **not verified**; keeping the data separate and credited is the mitigation.

**Word selection.** NGSL 1.2 (CC BY-SA 4.0, 2,809 words) is the cleanest openly licensed base. Dolch and Fry lists have an unclear copyright status and are not used. The `google-10000-english` list is restricted to educational and personal use and is not used. No openly licensed grade-by-grade spelling curriculum list was found.

## OCR spike

Run on 2026-11-10 in Node 22 against synthetic images only (no children's data). Scripts and images were kept outside the repository. Not run in a browser.

| Item | Result |
|---|---|
| Package | `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0, both Apache-2.0 |
| Model | Default `eng` is `4.0.0_best_int`: 5,199,098 bytes unpacked, 2,952,873 bytes as served (gzip). The "fast" model is 4,113,088 bytes raw (about 1,976,309 gzipped locally) and gave similar results on the printed samples. The float "best" model aborts with the LSTM-only core. |
| Core | The wasm is embedded in a `.wasm.js` file: about 3.9 MB each (about 1.46 MB gzipped) for the relaxed-SIMD, SIMD and plain variants. A browser picks one. |
| Worker | `worker.min.js` 111,307 bytes; `tesseract.min.js` 62,961 bytes |
| First-load total | About 7.0 MB raw with one core variant (about 4.5 MB with gzip on the JS files) |
| Time | About 0.2 to 0.55 seconds per image in Node, plus about 0.4 seconds worker start |

Self-hosting needs `workerPath`, `corePath` and `langPath` set to the site's own origin (they all default to a CDN). With `workerBlobURL: false` the worker is a plain same-origin worker. Shipping all three core variants is about 11.7 MB, so the fetch step should pull the variants at deploy time rather than commit them, as the Kokoro files are.

Accuracy on 12 expected words per image:

| Image | Original | After grayscale and flat-field normalisation |
|---|---|---|
| Clean printed list | 12 of 12 | 12 of 12 |
| Two-column numbered list | 12 of 12 (block page mode removes the numbering junk) | 12 of 12 |
| Phone-photo-like list (3 degree rotation, uneven light, noise, blur) | 5 of 12 | 12 of 12 |
| Comma-separated line | 12 of 12 | 12 of 12 |
| Handwriting | **Not tested**: no handwriting font was available, so no image was made | Not tested |

Findings that shape Phase 2:

- Photos need grayscale plus flat-field normalisation (divide by a blurred background estimate) before OCR. Plain contrast, 2x upscaling and a global threshold did not fix the lighting problem. This was tested in Python; the browser version must be implemented and re-tested.
- Use block page mode for clean or columned prints and automatic page mode for a normalised photo.
- The review screen is required: heading words, numbering and punctuation appear in the output, and handwriting accuracy is unknown and likely much worse.

**Not verified:** any real phone photo, any handwriting, browser behaviour (including the `wasm-unsafe-eval` and worker requirements for any content security policy), and the browser flat-field implementation.

## Effects on the plan

- Library data starts from OEWN plus a Wiktionary origin label, with Simple English Wiktionary as a gap filler. Coverage of reviewed example sentences will be partial, so the sentence fallback tiers matter.
- The `mine/` lookup module uses the Wikimedia Action API; its hosts (`simple.wiktionary.org`, `en.wiktionary.org`) are the only third-party hosts the `mine` mode device-test check will allow once Phase 1 adds that assertion (today `tools/device-test/device-test.mjs` flags every request that is not to the page's own origin). Credit and link to the source entry are shown next to any text taken from it.
- The OCR files are about 7 MB on first load and are fetched only when a photo import starts.

## Phase 1 results

The entry checks above were run in the Phase 1 pull request. The parser figures are asserted by `tests/mine-lookup-parse.test.mjs` (the test named "the figures quoted in docs/my-words-phase0-findings.md") on the recorded responses in `tests/fixtures/wiktionary-extracts.json` (50 words, fetched 2026-11-10).

| Check | Result |
|---|---|
| Parser over the 50 words | The English page gave a definition for all 50 and an origin label for 46; the other four (igloo, kangaroo, sandwich, fluorescent) correctly report "origin not available". The Simple English page was missing for 1 word and gave a definition for 49 and an example sentence for 32. Every result passes the validator; no unparsed text reaches the page. |
| Simple extract format | The page uses `== Heading ==` for parts of speech (level 2) and has no language heading; the English page has `== English ==`. The first version of the parser assumed otherwise and returned nothing for every Simple page; the test over all 50 words caught it. |
| Browser check | `tools/device-test/mine-check.mjs`, iPhone SE and iPad (gen 7) presets, Chromium emulation (WebKit could not start on the build machine), with Wikimedia answered from the fixtures. It confirms default mode requests only `mine/config.js` from `mine/` and nothing from the library, and makes no third-party request, that nothing is sent before the lookup button, that a dialog asks a grown-up first, that lookups go only to the two hosts, that no custom word is requested from this site's host as an audio clip, that a failed safety-list download leaves the saved lists untouched, and that the keys written are the My words keys. A real cross-origin request from a browser to the live Wikimedia hosts was not exercised; only the server-side CORS and preflight `curl` results above support it. |
| Request volume | At most 3 requests at a time; two hosts per word, so a list of 200 missing words is at most 400 requests. The Wikimedia browser limit is 200 per minute per client, so a very long list can reach a `429`, which stops the lookup and leaves the rest for manual entry. Only words found in neither the Bee Ready list nor the library are looked up, so a typical weekly list makes few requests. |

## Phase 2 results

| Check | Result |
|---|---|
| Real OCR in a browser engine | `tools/device-test/ocr-check.mjs`, iPhone SE and iPad (gen 7) presets, Chromium emulation (WebKit could not start on the build machine). A synthetic photo drawn on a canvas (grey paper bright on the left and dim on the right, a 2 degree tilt, noise, a bold heading and 12 numbered words in a printed font) went through the page's file input and the real Tesseract.js 7.0.0 files served by the site: 12 of 12 words were read, with 2 more tokens from the heading. Each posted run read all 12 words in under 5 seconds on the build machine (the exact time is in each run's output and varies from run to run). |
| Same origin, nothing kept | In that run every request stayed on this site (the OCR files came from `voice-assets/ocr/`), no key was added to `localStorage` and no IndexedDB database was created. `tests/mine-ocr-photo.test.mjs` asserts the same against fakes, plus that the canvas ends at 0 by 0, the bitmap is closed and the worker is stopped, including when the read fails. |
| Image preparation | The browser version of the grayscale and flat-field step is `flattenIllumination` in `mine/ocr.js` (block percentile, smoothing, bilinear spread, divide). `tests/mine-ocr.test.mjs` shows it bringing a page that starts with paper levels more than 80 apart to within 16 of each other, with text still dark. This is a different method from the Python version used in the spike, so the spike's figures do not carry over to it. |
| Not tested | Handwriting, real phone photos (other lighting, shadows, curved pages, EXIF rotation), WebKit, a real device and the first-load time on a phone connection. The review screen and the "handwriting is harder to read" note are the controls for what OCR gets wrong. |

## Phase 3 results

| Check | Result |
|---|---|
| Published lists | `mine/registry.js` loads `lists/<id>.json` for a link that has only an id. The request goes to this site with `credentials: 'omit'` and no referrer; the id must pass the 22-character check first (no request otherwise); the file goes through the same validator and filter as typed words, may not carry `__proto__`, `constructor` or `prototype` keys, and must hash back to the id. `tests/mine-registry.test.mjs` covers each refusal (missing file, offline, not JSON, wrong shape, too long, a blocked or invalid word, a non-string, words that do not match the id) and checks that every file in `lists/` loads and is in the form the tool writes. |
| Browser check | `tools/device-test/mine-check.mjs`, iPhone SE and iPad (gen 7) presets, Chromium emulation (WebKit could not start on the build machine): the sample link shows the three words for review with the list's name, the only request beyond the page files is `lists/<id>.json` on this site, nothing is stored until Save, and an unknown id shows "does not include the words". |
| Growth tooling | `build.mjs --extra-words <file>` (parser in `tools/library/wordlist.mjs`, tested) adds words after the NGSL seed, requires `# source:` and `# licence:` lines and credits them in `library/NOTICE.md`. The shipped library was not regrown in this phase: it is still the NGSL seed, so no new library text exists to be read. |
| Not tested | WebKit, a real device and a screen reader; a published list that is long (200 words) on a phone; a list file served with a stale cache after an edit. |

## Shared-link screen and plain labels (follow-up to Phase 3)

The first live use showed two problems. A link opened the full review editor, so a speller saw every word and could not hide them, and the list was not started. Word cards also printed labels a child cannot read ("Mine", and a placeholder "word" where the part of speech was not known).

- A link now opens a card with the list name and word count, a **Start my spelling bee** button, and a closed **Grown-ups: check the words first** control. Start saves the list under its own name and begins a round. (An earlier version also hid the saved words and the Word bank behind a closed control; the owner asked for the Word bank to be always open, so that was removed in the next section.)
- Word cards show only what is known (origin and part of speech), or "My word". An unknown part or origin reads "Not known yet" instead of repeating the label. The default list's cards are unchanged.
- "Filter by group" is now "Filter by origin".
- Checks: `tools/device-test/mine-check.mjs` (links, Start, card tags) and `tests/wordcard.test.mjs`. Emulation only; not tested on a real device or with a screen reader.

## Lists and words live in the Word bank (follow-up)

The owner's review: the custom list editor sat on the Practice tab, and the Word bank was behind a closed control. Both were wrong for how the site is used.

- **Practice** is for practicing, in both versions. In My words it shows a small panel: "Practicing: <list name>", how many words, and **Change list or add words** (or **Add my words** when the list is empty). It has no editor. It also holds a share link's start card.
- **Word bank** holds everything about the words, and is always open: **My lists** (pick, rename, new, delete, share link, backup), **Add words** (typing, photo, the check-and-save review), then the searchable word cards. Each card has **Remove**, which replaced the separate saved-word list. It asks first, like **Delete this list**, and if the device cannot save it says so instead of "Removed". The origin filter and **Show more words** are kept after a Remove.
- A share link still opens the start card on Practice with the words hidden until Start or the grown-up check. While it waits, the Word bank keeps its lists but swaps Add words for a note, because a second review would replace the link's words. The review block moves into the card's grown-up check and back.
- Messages go to the live region of the tab the person is on, because a region inside a hidden tab is not read out.
- The default version is unchanged: its markup for the new panels is hidden, and its cards have no Remove.
- Trade-off the owner chose: anyone who taps Word bank can read the whole list. The link's start card is the only place words stay hidden, until Start.
- Not changed: a saved word's definition and sentence cannot be edited after saving (remove it and add it again).

## Definitions that did not travel, and the backup buttons (follow-up)

Two problems from the owner's use of a shared link.

- **Definitions do not travel in a link.** A link carries only the words (by design: short, no text from a third party in a URL). A word the library lacks therefore arrives with no definition, and after Start the review is gone, so there was no way to fetch one. A saved list now shows **Get missing definitions** in the Word bank when any word has none, with how many. It checks the Bee Ready library on this site first, then (only if lookups are on in Grown-ups, and only after the same confirm dialog as **Look up the missing words**) Wiktionary. It fills only empty fields, so anything a grown-up typed is kept, and it asks again for a word Wiktionary earlier answered "not found" for. The link card also says a grown-up can look words up now or later in the Word bank.
- **Backup buttons were unclear.** "Download a backup" and "Open a backup" are now **Save a backup file** and **Restore from a backup file**, under a heading "Back up or move all your lists" that says what a backup is (all lists and their definitions), when to use it (keep a copy, or move to another browser or device) and that restoring adds lists and never replaces or deletes. "Share this list" is a separate heading that says the link carries only the words. The messages after each action say what happened (where the file went, how many lists were added, and if some did not fit within the 20-list limit).
- The privacy test now requires exactly two lookup call sites, each behind the toggle and the confirm dialog (the saved-list dialog says how many words would be sent). The fill runs one pass at a time, has its own result line beside the button, keeps a failed-save message instead of reporting success, and says so when Wiktionary is switched off. The Grown-ups and privacy text name both buttons.
- Rollback: revert the pull request. Saved lists are unchanged by it (no schema change).
- Not changed: there is still no way to re-fetch a definition for a word that has one; a saved word's text cannot be edited after saving.
