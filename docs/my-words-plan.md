# My words: custom word lists for Bee Ready

Status: plan, written at the start of Phase 0 and updated with the Phase 0 findings and the Phase 0 review (see `my-words-phase0-findings.md`). This file is the source of truth for the feature while it is being built. Where a later pull request must change it, that pull request edits this file too.

## Goal

Let any child, at any age or school level, practise their own words (for example this week's spelling list) with the same practice screen as the default word list. Words already in the default list are brought in as they are. New words get a definition, part of speech, origin and a practice sentence where one can be found. A list can be typed, pasted, shared as a link, or captured from a photo.

The default experience must not change.

## Entry point and isolation

- `?mode=mine` on the same site, plus a "Use your own words" link in the Grown-ups tab. There is no new tab and no new button in the default view.
- `app.js` gets one small seam (an estimate of about 20 lines; Phase 1 reports the real count): the word source is `words.json` by default, or the active custom list in `mine` mode. `initAnswerBox`, `shouldBlockInsert`, `isBigJump` and `BLOCKED_INPUT_TYPES` stay as written, because `tests/a11y.test.mjs` reads them as text.
- New code lives in `mine/`: `config.js` (the kill switches), `lists.js` (storage and list id), `validate.js` (the one validator every entry path uses), `lookup.js` (enrichment behind a small interface), `import.js` (parsing and the review screen), `ocr.js` (photo), `ui.js`. Pure logic is tested without a browser, like `stars.js`.
- `words.json`, `sentences.js`, `voice-service.js` and `tools/clips/` are not modified, because a push that changes any of them starts the clip-recording workflow (`.github/workflows/generate-clips.yml`) and nothing here needs that. `clips/` is not modified either.
- `mine/` code never builds markup from untrusted text with `innerHTML` or `insertAdjacentHTML`; it uses `textContent` and DOM calls. `tests/mine-privacy.test.mjs` scans `mine/` for those two names and fails if it finds either.

## Storage and rollback of data

- Custom lists are stored under `bee-ready-mine-v1`; the practice history for custom words under `bee-ready-mine-history-v1`; cached lookup results under `bee-ready-mine-lookup-v1` (at most 500 entries, validated on read). Custom stars are kept under `bee-ready-mine-starred-v1`, reached through a small adapter (`starsStorage` in `mine/lists.js`) that maps the existing star code's key to this one and ignores every other key; ids are unique across lists, so one set serves them all. The Grown-ups switch is kept under `bee-ready-mine-settings-v1`. The default keys (`bee-ready-history-v2` for history and `bee-ready-starred-v1` for stars) are never written by `mine` code. A test runs a `mine`-mode session against a fake storage object and asserts that both default keys are unchanged.
- Ids: a word that matches the default list keeps its default numeric id (its recorded clip is found by spelling, not by id). Any other custom word gets an integer id from 1,000,000 up, unique within the stored data, so the existing practice code (which expects numbers) works unchanged. Because custom history has its own key, ids can never collide with the default history.
- Schema versioning: before any change from `bee-ready-mine-v1` to a new schema, the code first copies the old value to a backup key `bee-ready-mine-v1.bak.<n>` (the next free number; an existing backup is never overwritten) and offers the JSON export. If the copy fails (quota or blocked storage), the migration aborts, the old data is left untouched and the grown-up is offered the JSON export. A backup is validated like any other stored data before it is restored. No backup is written when its text is identical to an existing one, and there are at most 3 `.bak` keys: at the limit the code stops, offers the JSON export and asks before dropping the oldest, so corrupt data on every load, or data planted by another page on the shared origin, cannot fill the browser's storage with backups. A test asserts each of these rules. The export file carries a `version` field and is validated on import like every other entry path.
- Corrupt or unreadable stored data is treated as an empty state: the raw text is kept under the next free `bee-ready-mine-v1.bak.<n>`, a visible message says so, and the page does not crash. A storage write that fails (quota or blocked storage) shows a message that offers the JSON export. Both follow the try/catch pattern `stars.js` already uses.
- Deleting: each list has a Delete button, and the Grown-ups tab has a "Delete all my words" control. "Delete all my words" removes every `bee-ready-mine-v1.bak.*` key, the history, the stars and the lookup cache. Deleting a single list removes its history in `bee-ready-mine-history-v1`, its stars, and each `.bak` key that holds it. A `.bak` that holds several lists is dropped entirely (not rewritten), and so is every `.bak` that is unreadable or fails validation, because it cannot be shown to be free of the list. A cached lookup is removed only if no remaining list uses that word. A test asserts each of these, so a deleted child's list does not stay behind in a backup or the lookup cache.
- Stored data is untrusted when read back. The site origin (`gitchrisqueen.github.io`) is shared with other pages under the same account, so anything another page wrote to these keys is validated like any other input.

## Validation on every entry path

One validator (`mine/validate.js`) is the only way text becomes words or stored fields. It applies to typed or pasted text, the share-link fragment, OCR output, the JSON backup import, `lists/<id>.json`, backup keys, and data read back from storage on load. Limits (Phase 1 may tighten them, never raise them; `tests/mine-validate.test.mjs` asserts each one):

| Limit | Value |
|---|---|
| Words per list | 200 |
| Saved lists | 20 |
| Characters per word | 40; letters, hyphens and apostrophes only (so the `|` multi-title separator of the dictionary API can never appear in a lookup) |
| Share-link fragment | 8,000 characters |
| Decompressed share-link text | 16,384 bytes, enforced while decompressing (the decoder stops at the cap rather than inflating first); the word and character limits above are applied again to the unpacked text |
| Definition | 200 characters |
| Origin | 40 characters |
| Sentence | 160 characters |

- These per-field caps and the child-safety filter (next section) run on the word, definition, origin and sentence fields on every path above, not only on lookup results. Any field that contains `<`, `>`, a URL scheme such as `http:` or `javascript:`, or `://` is rejected, so a hostile backup file cannot plant a link or markup in front of a child.
- Parsed JSON is shape-checked, and keys such as `__proto__`, `constructor` and `prototype` are rejected.
- Source-credit links are built at render time from the word and a fixed host allowlist (`simple.wiktionary.org`, `en.wiktionary.org`). They are never read from stored or imported data.
- `mine/` code sets text with `textContent` only. `escapeHtml` is used only by the existing `app.js` and `wordcard.js` code that already builds markup for word cards and the practice screen; it is not permission for `mine/` to build markup from untrusted text. The dictionary `titles` value goes through `encodeURIComponent`.

## Where a word's data comes from

For each word, the first hit wins:

1. **Default list.** If the word is in `words.json`, use that entry as it is, with its recorded clip.
2. **Static library.** `library/<letter>.json` shards in the repo: part of speech, a short definition, an origin and a sentence. The page fetches only the shards it needs. No third party is involved.
3. **Live dictionary**, only after an explicit tap (see "Third-party requests").
4. **Manual entry** by the grown-up. Words with no definition show a "Look it up in Merriam-Webster" link, the same link-out the word cards already have.

`group` (the origin clue) is filled from the etymology's source language where one is found. Otherwise the origin clue says origin is not available.

**Child-safety filter.** One filter covers the word itself, the definition, the origin text and every example sentence, with the length caps above. It fails closed: a field that matches the filter or exceeds its cap is not displayed. A word that matches is not added and the page says so; any other field falls through to manual entry or the Merriam-Webster link-out.

- The hashed word list is `mine/filter.sha256`, one SHA-256 per line like `denylist.sha256`, so the repository holds no plain offensive words. `tools/library/build-filter.mjs` builds it from an open-licensed word list. The repository owner owns the file.
- Phase 1 records the source list and its licence in `mine/FILTER-NOTICE.md` before the filter is merged. The list can be updated by regenerating the file, with no code change.
- The filter normalises case, simple plurals and common letter-for-digit substitutions (Phase 1 lists them and tests them). It will not catch every variant or a context-dependent unsafe definition, so the review-screen acceptance below is the second control.

Looked-up definitions and examples are shown on the review screen, and the grown-up accepts or edits them before anything is saved.

**Sentences** are tiered: a library sentence first; then a dictionary example, only if it contains the word exactly once as a whole word and passes the filter; then the generic fallback from `sentences.js`, which the grown-up can edit. Every sentence must contain its word exactly once. Library sentences are only taken from the open sources' own example sentences (never written by a model) and must pass the filter; the repository owner spot-checks a sample when reviewing the library pull request.

**Audio:** words in the default list use their recorded clips. Other words use the device voice, or live Kokoro if the grown-up turned it on. The page says that device pronunciation of rare words can be wrong. No clips are added for custom words.

## Third-party requests

- No third-party request on page load, and none in default mode. `tests/mine-privacy.test.mjs`, which runs under `npm test` and so in CI, asserts that the files the default page loads contain no request to any origin other than the ones the page already uses today, and that each `mine` module's external hosts are a subset of the allowlist (`simple.wiktionary.org`, `en.wiktionary.org`). It is static text analysis and does not run a browser, so a URL built at runtime could evade it. `tools/device-test` therefore gains a `mine`-mode assertion that any external request goes only to those two hosts; it is a manual emulation check, run by the agent or engineer who makes the Phase 1 change, with the output recorded in that pull request.
- **Order of events.** Step 1: words come in (typed, pasted, a share link or a photo) and are validated; opening a share link saves nothing and sends nothing. Step 2: the grown-up confirms or edits the word chips; default-list and library matches are resolved here, locally. Step 3: for the words still missing, a separate "Look up the missing words" button sends them to the dictionary, and only if the Grown-ups toggle is on. No request is made before step 3's tap.
- **Default of the toggle:** on, because the grown-up must still tap the button in step 3. The disclosure text sits on the same screen right at the button and is part of the button's accessible description; it says that the words and the device's IP address are sent to Wiktionary (Wikimedia).
- Sources are credited next to any text taken from them, with a link to the entry, where a licence requires it.
- Merriam-Webster is a link-out only. No Merriam-Webster API key is shipped in the page or the repository, and the API is never bulk-queried, because its terms bar automated or recorded queries without written approval.
- **Failure handling.** Each lookup has a timeout and sends at most 3 requests at the same time (Phase 1 sets the timeout and the progress and Cancel behaviour for a 200-word list and tests them). On a timeout, a network error, a 403, a 429 or 5xx response, or a response that does not have the expected shape, the lookup stops, the word keeps its manual-entry state, and a visible message explains it. On a 429 the code waits for `Retry-After` once, for at most 30 seconds, and stops if the value is larger. Results are cached in the browser (`bee-ready-mine-lookup-v1`) so a word is not requested twice.
- **Kill switches.** `mine/config.js` holds `MINE_ENABLED` (hides the entry link and turns the mode off), `LIVE_LOOKUP_ENABLED` (turns live lookups off for everyone) and `OCR_ENABLED` (hides the photo button). An operator flips one by pull request. It takes effect after that pull request merges and the Pages deploy finishes; browsers that cached the old files pick up the change when they revalidate them. If the deploy needs a manual start, use the workflow's **Run workflow** button on `main` (the workflow has `workflow_dispatch`).
- CSP: one page serves both modes and the optional live voice loads CDN scripts, so a meta Content-Security-Policy is not adopted in this feature. The privacy test and the device-test assertion above are the checks instead.

## Share links

`?mode=mine&l=<id>#w=<packed words>`

- `id` is the first 22 characters, base64url, of the SHA-256 (128 bits) over a salt constant (`mine/salt.js`) plus the list's unique words, lowercased and sorted by code point. This is longer than the 12 characters first proposed, because a 48-bit id is short enough to craft collisions for. The salt is public: it is a version label, not a secret.
- The same words always give the same id, on any device, so importing a list you already have is detected. Detection, storage and registry resolution compare the full normalised word set and never merge or overwrite on an id match alone.
- The words travel in the URL fragment (which browsers do not send to the server), packed with the browser's built-in `CompressionStream` and `DecompressionStream` (deflate) and base64url, within the caps above. The page re-hashes the unpacked words and rejects a link whose words do not match `l`. This is a corruption check, not authentication.
- The `l=` id is in the query string, so it reaches GitHub Pages request logs. Because the salt is public, someone who can guess a list (a published weekly list, say) can match its id. The README privacy text says so. The fragment, which holds the words, is not sent.
- A saved list can always regenerate its link.
- The `l` value must match `^[A-Za-z0-9_-]{22}$` before any use: the lookup in saved lists, the re-hash compare and the registry fetch. A value that fails is treated as no link and no request is made. The registry path is built only from that validated string, so it can contain no `/`, `.`, `%` or `?`. `tests/mine-validate.test.mjs` asserts that `l=../x`, `l=a%2Fb`, a 21-character id and a 23-character id make no fetch.
- A hash cannot be decrypted. A link that has only an id resolves through an optional `lists/<id>.json` registry in the repository. The resolver re-hashes the file's words and rejects a mismatch. If neither a saved list nor a registry file exists, the page says to ask the sender for a new link.
- `lists/` holds only lists the repository owner chose to publish, added by reviewed pull request, never a child's real list. No personal data goes in a registry file. `denylist-guard` already scans every file in the tree, so it covers `lists/`.

## Getting words in

- Type or paste a list (commas, new lines or spaces).
- Take a photo or scan. OCR runs on the device with Tesseract.js, and the photo is never uploaded. `ocr.js` sets `workerPath`, `corePath` and `langPath` to the site origin (all three default to a CDN), sets `workerBlobURL: false` so no `blob:` worker is needed, and sets `cacheMethod: 'none'` so the OCR library keeps nothing in IndexedDB. `tests/mine-privacy.test.mjs` fails if any OCR path resolves to another origin.
- A photo is never persisted. `tests/mine-ocr-photo.test.mjs`, under `npm test` and so in CI, asserts three things against a mocked photo import: a fake storage object records zero writes to `localStorage` and IndexedDB; every `URL.createObjectURL` is matched by a `URL.revokeObjectURL`; and the canvas width and height are set to 0 when the import finishes.
- A review screen with editable chips is required before anything is saved. Each chip says found, not found or "did you mean". A handwriting-accuracy warning is shown for photos.
- Several named lists, delete a list, and JSON export and import as a backup.

## Library generator (ships with the library in Phase 1)

- Lives in `tools/library/` (not deployed). It runs by hand, offline from the site. It writes `library/<letter>.json` and `library/NOTICE.md` (the sources and licence of each field).
- **Inputs.** Pinned in `tools/library/sources.json`, which Phase 1's first commit creates, before any generator code, with these values:

| Input | URL | Size (bytes) | SHA-256 |
|---|---|---|---|
| Open English WordNet 2025 (XML) | `https://en-word.net/static/english-wordnet-2025.xml.gz` | 11,363,503 | `9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe` |
| Simple English Wiktionary extract | `https://kaikki.org/dictionary/downloads/simple/simple-extract.jsonl.gz` | 4,726,754 | `79afd871e342db3b87c3f2044ed21efa312e4c4ee006814b57c4cf4536ef70a1` |
| English Wiktionary extract (origin labels only) | `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl` | 3,431,211,190 (last modified 2026-10-30) | `ce2b80e5ad1132f14cedd2f531a606e1f0c6aeab422d50515e88db13a16a59a7` (measured when the Phase 1 generator was built; recorded in `tools/library/sources.json`) |
| NGSL 1.2 word list (which words go in the library) | `https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv` | 62,566 | `2098bab8955a120a9766c6282a51d7d578c6cb0a7d946600d2ffb73ba25a0b44` |

  kaikki.org marks the English file as deprecated and to be removed "in the near future" (`https://kaikki.org/dictionary/English/index.html`, which lists it as 3.2GB: the same 3,431,211,190 bytes in binary units). Phase 1's first commit therefore does two things before any generator code: it downloads the file once, and it records its SHA-256 and byte count in `tools/library/sources.json`. If the URL returns 404 when a later engineer needs it, the fallback is the raw dump listed on `https://kaikki.org/dictionary/rawdata.html` (`raw-wiktextract-data.jsonl.gz`, about 2.9 GB compressed), filtered to English entries; the shards are then regenerated and reviewed again, and the new source and hash are recorded in `sources.json`.

  The English file is streamed and processed offline, never loaded whole. Sizes and the two hashes were measured on 2026-11-10. The kaikki files change when it re-extracts Wiktionary, so a hash mismatch means the upstream moved: update `sources.json` deliberately and review the regenerated shards.
- Size budget: each shard stays under 150 KB and the whole library under 3 MB (Phase 1 tests both).
- A test checks that every shard is valid under `mine/validate.js`, that every sentence contains its word exactly once, and that `library/NOTICE.md` names every source used.
- A fresh engineer regenerates a shard with the commands in `tools/library/README.md`, which Phase 1 writes. Phase 3 extends the tooling (word-list selection and growth), not the first generator.

**Library v1 (as built in Phase 1).** About 2,700 words from the New General Service List in 26 shards (about 500 KB in all, the largest under 60 KB). Definitions come from Simple English Wiktionary (about 2,650 words) or Open English WordNet (about 70), sentences only from those sources' own examples, and origins from English Wiktionary etymologies. A second check, `mine/sensitive.js`, holds back library and looked-up text that touches violence, sex, drugs, alcohol and similar topics (and, for example sentences only, a few rude or distressing words); a word whose best definition is held back is left out of the library rather than shown with a lesser sense. The profanity list is `mine/filter.sha256`, built from the LDNOOBW list (CC BY 4.0, see `mine/FILTER-NOTICE.md`). Nobody has read every entry; the repository owner spot-checks a sample when reviewing, and the kill switch and the grown-up's review screen are the other controls.

## Repository touchpoints

- `scripts/build.mjs` has an allowlist. Phase 1 adds `mine/` (copying only `.js` files and `filter.sha256`, so no README or test fixture ships) and `library/`, and copies `lists/` only if it exists (the way `clips/` is handled). A new test in `tests/site.test.mjs` runs the build and asserts that `_site/mine/` and `_site/library/` exist and are non-empty, and that `_site/lists/` exists only when `lists/` does. A missing directory therefore cannot ship silently.
- `package.json`: the `npm test` script lists its syntax checks file by file, so Phase 1 edits it to run `node --check` on the `mine/*.js` files and on any new `tools/library/*.mjs` file.
- **OCR files (new in Phase 2).** `scripts/fetch-voice-assets.mjs` is changed to take a per-row URL and output directory: today its rows are `[name, size, sha]` with a Hugging Face URL and a `models/<model>` folder built in. Phase 2 adds these pinned rows, written to `_site/voice-assets/ocr/`. Sizes and hashes were measured on 2026-11-10 from the files at these URLs:

| File | URL | Size (bytes) | SHA-256 |
|---|---|---|---|
| `tesseract.min.js` | `https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js` | 62,961 | `000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e` |
| `worker.min.js` | `https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js` | 111,307 | `576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d` |
| `tesseract-core-relaxedsimd-lstm.wasm.js` | `https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-relaxedsimd-lstm.wasm.js` | 3,905,767 | `861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3` |
| `tesseract-core-simd-lstm.wasm.js` | `https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js` | 3,899,472 | `c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38` |
| `tesseract-core-lstm.wasm.js` | `https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js` | 3,896,484 | `eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680` |
| `eng.traineddata.gz` | `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz` | 2,952,873 | `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91` |

  `@tesseract.js-data/eng@1.0.0` is the package version (the `4.0.0_best_int` folder is the model version inside it). The model file's size and SHA-256 above were checked against the versioned `@1.0.0` URL on 2026-11-10 and are the same bytes the unversioned URL serves.
- **Cache.** `.github/workflows/pages.yml` caches the path `_site/voice-assets`, and its key already includes a hash of `scripts/fetch-voice-assets.mjs`. The OCR folder is inside that path, so a cache hit means an outage at the upstream host cannot fail a deploy or a rollback, and adding rows saves a fresh cache. If the download fails and there is no cache, the deploy fails closed and the rollback is to revert the pull request, which removes the rows. The cache key changes whenever the fetch script changes, so the first deploy after Phase 2 has no OCR cache: if the upstream host is down at that moment, that deploy fails closed, and it is re-run when the host is back.
- **Licence notice (Phase 2).** The OCR files are Apache-2.0 and are served from the site. The fetch script today writes `voice-assets/NOTICE.txt` with Kokoro text only, so Phase 2 extends that notice (or adds `voice-assets/ocr/NOTICE.txt`) with the licence and source of `tesseract.js`, `tesseract.js-core` and the English model.
- **Smoke check: explicit decision not to add an OCR path.** `tests/workflows.test.mjs` asserts that the three current smoke-check targets (`words.json`, a clip, the Kokoro `config.json`) are present; it does not pin an exact list. Phase 2 does not edit `pages.yml` or that test. The fetch script's size and SHA-256 check, plus the fail-closed deploy, are the guard that the OCR files are in the artifact. Phase 2 also runs a one-off manual check after the merge deploys: an HTTP request for each file under `voice-assets/ocr/` on the live site, with the output reported to the repository owner. Adding the OCR path to the smoke check later is a separate decision that edits the workflow and its test together.
- `npm test` and `npm run serve` do not fetch the voice or OCR assets (only the deploy job does). Phase 2's fixture tests cover the pure image-processing and word-parsing code on generated images; the real OCR run is a manual check with `npm run build && npm run fetch-voice-assets`, as the README already describes for the voice model.
- `README.md` and `CLAUDE.md` get the new feature and the documented import-time third-party exception in the same pull request that adds live lookup (Phase 1), not later. The README sentence "The site never sends your practice to a server" (under "Your progress stays on your device") and the matching sentence in `CLAUDE.md` ("is never sent by the site") get the same exception. The Phase 1 README also tells grown-ups how to clear the site's saved data in their browser, because a rollback or `MINE_ENABLED=false` leaves saved lists in browsers with no Delete control.
- Health: the site has no analytics by design, so health is the deploy smoke check plus a manual check of `?mode=mine`. Each photo import downloads the OCR files (about 7 MB on first load, see the findings) from GitHub Pages, which counts toward Pages bandwidth; GitHub's published Pages usage limits apply, and the owner checks them if photo use grows.

## Safety and limits

- No accounts, no analytics, no photo upload, no backend.
- UI rules for children on phones apply: form fields at least 16 px, tap targets at least 44 px, no text under 12 px, fixed accessible button names (state in `aria-pressed` or `aria-expanded`).
- `tools/device-test` is WebKit emulation, not a real iPhone or iPad. Results are reported as emulation.

## Ownership and incidents

The owner is the repository owner (the GitHub account that owns this repository), as the README's "Ownership and incidents" section already says for the site.

| Case | Action |
|---|---|
| A licence or attribution complaint about shard text | Fix `library/NOTICE.md` or remove the field, by pull request. Removed text stays in git history; say so in the reply. |
| A bad definition or sentence in a shard, reported by a grown-up | Edit the shard by pull request. The route is the repository's issue tracker, or its private vulnerability report for anything sensitive. |
| A bad definition that came from a live lookup | The grown-up edits or rejects it on the review screen. The source entry is on Wiktionary and is fixed there; the credit link next to the text leads to it. |
| Wikimedia blocks the site or changes its limits | Set `LIVE_LOOKUP_ENABLED` to `false` by pull request. The page falls back to manual entry. Effect: after the next deploy. |
| A personal list appears in `lists/` | Remove it by pull request, and follow the repository's incident steps (history may need cleaning by the owner). |
| A child's list appears in a pull request, issue or comment | Close and remove it; no student data belongs in this repository. |

## Phases, one pull request each

| Phase | Lands | Rollback |
|---|---|---|
| 0 Spike | This plan and the findings note | Revert the docs pull request. No runtime effect. |
| 1 MVP | The `app.js` seam, `mine/` modules, storage, list id and share link, paste import, default-list match, the library generator and library v1, live lookup with disclosure and toggle, review screen, practice from a list, tests, README and `CLAUDE.md` updates | Revert the pull request and redeploy through `pages.yml`; or set `MINE_ENABLED` to `false`. Keys already saved in a browser stay inert when the code is gone. The default keys are never touched. |
| 2 Photo | OCR import, the OCR rows and per-row URL support in `scripts/fetch-voice-assets.mjs`, fixture tests, device-test extension | Revert the pull request (this also removes the fetch rows); or set `OCR_ENABLED` to `false`. If the OCR download fails with no cache, the deploy fails closed. |
| 3 Registry and growth | The `lists/<id>.json` resolver, library growth tooling, final README and `CLAUDE.md` pass | Revert the pull request; the resolver then finds nothing and the page says to ask the sender for a new link. |

Each pull request gets an independent security, operator and claims review, plus an accessibility review for anything a child sees and a privacy review for Phases 1 to 3.
