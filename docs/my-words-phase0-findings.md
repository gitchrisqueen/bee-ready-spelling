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
| `https://simple.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=<word>&format=json&formatversion=2&origin=*` | `access-control-allow-origin: *` (curl with an `Origin` header, 2026-11-10) | Child-readable definition and example, but thin coverage. An unknown word returns `"missing": true`. | **Chosen**, first in order |
| `https://api.dictionaryapi.dev/api/v2/entries/en/<word>` | `*` | Clean JSON: part of speech, definitions, sometimes an example, a CC BY-SA licence field. No etymology in the responses checked. One 502 was seen during research. The maintainer asks for donations to cover server costs. | Optional fallback only |
| `https://en.wiktionary.org/api/rest_v1/page/definition/<word>` | `*` | Definitions as HTML, no etymology. The MediaWiki documentation calls it experimental and says RESTBase is being deprecated. | Not used |
| `https://api.datamuse.com/words?sp=<word>&md=dpr` | Reflects the origin | Definitions, part of speech, pronunciation. The site says an API key is required from 2027-02-01. | Not used: it stops being keyless |

Wikimedia limits (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits, new for 2026 and may change): 200 requests per minute for unauthenticated browser requests, 3 or fewer concurrent, honour `Retry-After` on a 429. The import code will use at most 3 concurrent lookups and cache each result in the browser. A 200-word list is well inside the limit.

Text from Wiktionary is CC BY-SA 4.0. The page must credit the source and link to the entry.

**Verified on 2026-11-10 with `curl`:** both `en.wiktionary.org` and `simple.wiktionary.org` answer a preflight (`OPTIONS` with `Access-Control-Request-Headers: api-user-agent`) with status 200, `access-control-allow-headers: api-user-agent` and `access-control-allow-origin: *`; both answer a `GET` with `origin=*` with `access-control-allow-origin: *`. This is the server side only: no browser was used.

**Not verified:** how an Etymology parser behaves across many words (see the entry checks below); the `dictionaryapi.dev` rate-limit window; the one `502` from `dictionaryapi.dev` was seen once by the source research and is not reproduced here.

### Phase 1 entry checks

Each open item above has a check that Phase 1 runs before the lookup host is allowed, with a decided fallback:

| Check | Fallback if it fails |
|---|---|
| A parser test over at least 50 named words (listed in the test file, mixing common words, loanwords and words missing from one site) extracts a clean origin label, or correctly reports "not available", from the Etymology section of the English extract | Show "origin not available" for the words the parser cannot read; never show unparsed text |
| A browser test in `tools/device-test` (WebKit emulation) makes one lookup to each host with the planned request headers and gets a response | Drop the `Api-User-Agent` header (the browser's own `User-Agent` is sent), or use `en.wiktionary.org` only |
| Request volume for a 200-word list stays under the browser limit of 200 requests per minute with at most 3 requests at a time | Lower the concurrency, or slow the queue and show progress with a Cancel button |

Contact for the Wikimedia User-Agent policy: the policy asks for contact details in the `User-Agent`. A page script cannot set `User-Agent`, so the planned header is `Api-User-Agent: BeeReady/1.0 (https://github.com/gitchrisqueen/bee-ready-spelling)`, whose contact is the repository, owned by the repository owner.

## How to read the figures below

The library and OCR figures in the next two sections were measured by the author during the spike. The scripts and test images were kept outside this repository, so they are **author-measured and not reproducible from this repository alone**. Where a figure comes from a public source, the source is named so a reader can re-derive it:

- Package versions and licences: `npm view tesseract.js@7.0.0 version license` and `npm view tesseract.js-core@7.0.0 version license`.
- Model and core sizes: `curl -sI https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` (the `content-length` header), the same for the files under `https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/` and `https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/`, and the `fast` model from the `tessdata_fast` repository on GitHub.
- Library source sizes: the `content-length` of `https://en-word.net/static/english-wordnet-2025.xml.gz` and of the files listed at `https://kaikki.org/dictionary/rawdata.html`.
- Coverage figures (examples and etymology on the Simple English records): counted by streaming `simple-extract.jsonl.gz` from that page.
- Word count of NGSL 1.2: the list's own page, `https://www.newgeneralservicelist.com/new-general-service-list`.
- OCR accuracy and timing: produced by the author's own scripts on synthetic images. No public artifact exists; Phase 2 adds generated fixtures and tests to the repository so the figures can be re-run.

## Seed data for the static library

| Source | Licence | What it has | Notes |
|---|---|---|---|
| Open English WordNet 2025 | CC BY 4.0 plus the Princeton WordNet notice | Part of speech, glosses, examples on about 32% of senses. No etymology. Download: 11,363,503 bytes (`content-length`, 2026-11-10). | No share-alike. The only attribution-only candidate. |
| Simple English Wiktionary (via kaikki.org extract) | CC BY-SA 4.0 | The most child-readable definitions. Etymology on about 11% of records, examples on about 22%. Download: 4,726,754 bytes (`content-length`, 2026-11-10). | Share-alike: any shard that copies its text is CC BY-SA. |
| English Wiktionary (via kaikki.org) | CC BY-SA 4.0 | Etymology text. The English dump is about 3.4 GB. | Used at build time only, for an origin language label. Definitions are often adult-level or archaic (the `abdicate` entry starts with an obsolete sense). |

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
