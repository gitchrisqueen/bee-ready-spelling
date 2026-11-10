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

## Storage and rollback of data

- Custom lists are stored under `bee-ready-mine-v1`; the practice history for custom words is stored under `bee-ready-mine-history-v1`. Custom stars live inside the `bee-ready-mine-v1` object, per list. The default keys (`bee-ready-history-v2` for history and `bee-ready-starred-v1` for stars) are never written by `mine` code. A test runs a `mine`-mode session against a fake storage object and asserts that both default keys are unchanged.
- Ids: a word that matches the default list keeps its default numeric id (its recorded clip is found by spelling, not by id). Any other custom word gets an id of the form `m-<n>`, unique within the stored data. Because custom history has its own key, ids can never collide with the default history.
- Schema versioning: before any change from `bee-ready-mine-v1` to a new schema, the code first copies the old value to `bee-ready-mine-v1.bak` and offers the JSON export. The export file carries a `version` field and is validated on import like every other entry path.
- Corrupt or unreadable stored data is treated as an empty state: the raw text is kept under `bee-ready-mine-v1.bak`, a visible message says so, and the page does not crash. A storage write that fails (quota or blocked storage) shows a message that offers the JSON export. Both follow the try/catch pattern `stars.js` already uses.
- Stored data is untrusted when read back. The site origin (`gitchrisqueen.github.io`) is shared with other pages under the same account, so anything another page wrote to these keys is validated like any other input.

## Validation on every entry path

One validator (`mine/validate.js`) is the only way text becomes words. It applies to typed or pasted text, the share-link fragment, OCR output, the JSON backup import, `lists/<id>.json`, and data read back from storage on load:

- At most 200 words per list and 40 characters per word; letters, hyphens and apostrophes only (so the `|` multi-title separator of the dictionary API can never appear in a lookup).
- A cap on the number of saved lists (Phase 1 sets the number and tests it).
- Hard caps on the share-link fragment length and on the decompressed size, enforced while decompressing (the decoder stops at the cap rather than inflating first), then the 200-word and 40-character limits again on the unpacked text.
- Parsed JSON is shape-checked, and keys such as `__proto__`, `constructor` and `prototype` are rejected.
- The filter described in the next section runs on the words themselves.
- Everything shown goes through `escapeHtml`, and the dictionary `titles` value goes through `encodeURIComponent`.

## Where a word's data comes from

For each word, the first hit wins:

1. **Default list.** If the word is in `words.json`, use that entry as it is, with its recorded clip.
2. **Static library.** `library/<letter>.json` shards in the repo: part of speech, a short definition, an origin and a sentence. The page fetches only the shards it needs. No third party is involved.
3. **Live dictionary**, only after an explicit tap (see "Third-party requests").
4. **Manual entry** by the grown-up. Words with no definition show a "Look it up in Merriam-Webster" link, the same link-out the word cards already have.

`group` (the origin clue) is filled from the etymology's source language where one is found. Otherwise the origin clue says origin is not available.

**Child-safety filter.** One filter covers the word itself, the definition, the origin text and every example sentence, each with a length cap (Phase 1 sets and tests the caps). It fails closed: a field that matches the filter or exceeds its cap is not displayed. A word that matches is not added and the page says so; any other field falls through to manual entry or the Merriam-Webster link-out. Its word list is kept as SHA-256 hashes, like `denylist.sha256`, so the repository holds no plain offensive words; Phase 1 names the open source the list is built from and records its licence.

Looked-up definitions and examples are shown on the review screen, and the grown-up accepts or edits them before anything is saved.

**Sentences** are tiered: a library sentence first; then a dictionary example, only if it contains the word exactly once as a whole word and passes the filter; then the generic fallback from `sentences.js`, which the grown-up can edit. Every sentence must contain its word exactly once. Library sentences are only taken from the open sources' own example sentences (never written by a model) and must pass the filter; the repository owner spot-checks a sample when reviewing the library pull request.

**Audio:** words in the default list use their recorded clips. Other words use the device voice, or live Kokoro if the grown-up turned it on. The page says that device pronunciation of rare words can be wrong. No clips are added for custom words.

## Third-party requests

- No third-party request on page load, and none in default mode. `tests/mine-privacy.test.mjs`, which runs under `npm test` and so in CI, asserts that the files the default page loads contain no request to any origin other than the ones the page already uses today, and that each `mine` module's external hosts are a subset of the allowlist (`simple.wiktionary.org`, `en.wiktionary.org`). It does not run a browser, so `tools/device-test` stays as the manual emulation check and gains a `mine`-mode assertion that any external request goes only to those two hosts.
- **Order of events.** Step 1: words come in (typed, pasted, a share link or a photo) and are validated; opening a share link saves nothing and sends nothing. Step 2: the grown-up confirms or edits the word chips; default-list and library matches are resolved here, locally. Step 3: for the words still missing, a separate "Look up the missing words" button sends them to the dictionary, and only if the Grown-ups toggle is on. No request is made before step 3's tap.
- **Default of the toggle:** on, because the grown-up must still tap the button in step 3. The disclosure text beside the button says that the words and the device's IP address are sent to Wiktionary (Wikimedia).
- Sources are credited next to any text taken from them, with a link to the entry, where a licence requires it.
- Merriam-Webster is a link-out only. No Merriam-Webster API key is shipped in the page or the repository, and the API is never bulk-queried, because its terms bar automated or recorded queries without written approval.
- **Failure handling.** Each lookup has a timeout and sends at most 3 requests at the same time (Phase 1 sets the timeout and the progress and cancel behaviour for a 200-word list and tests them). On a timeout, a network error, a 403, a 429 or 5xx response, or a response that does not have the expected shape, the lookup stops, the word keeps its manual-entry state, and a visible message explains it. On a 429 the code honours `Retry-After` once, then stops. Results are cached in the browser so a word is not requested twice.
- **Kill switches.** `mine/config.js` holds `MINE_ENABLED` (hides the entry link and turns the mode off), `LIVE_LOOKUP_ENABLED` (turns live lookups off for everyone) and `OCR_ENABLED` (hides the photo button). An operator flips one by pull request.
- CSP: one page serves both modes and the optional live voice loads CDN scripts, so a meta Content-Security-Policy is not adopted in this feature. The privacy test and the device-test assertion above are the checks instead.

## Share links

`?mode=mine&l=<id>#w=<packed words>`

- `id` is the first 22 characters, base64url, of the SHA-256 (128 bits) over a salt constant (`mine/salt.js`) plus the list's unique words, lowercased and sorted by code point. This is longer than the 12 characters first proposed, because a 48-bit id was judged too short to trust as a key. The salt is public: it is a version label, not a secret.
- The same words always give the same id, on any device, so importing a list you already have is detected. Detection, storage and registry resolution compare the full normalised word set and never merge or overwrite on an id match alone.
- The words travel in the URL fragment (which browsers do not send to the server), packed with the browser's built-in `DecompressionStream` and `CompressionStream` (deflate) and base64url. The page re-hashes the unpacked words and rejects a link whose words do not match `l`. This is a corruption check, not authentication.
- A saved list can always regenerate its link.
- A hash cannot be decrypted. A link that has only an id resolves through an optional `lists/<id>.json` registry in the repository. The resolver re-hashes the file's words and rejects a mismatch. If neither a saved list nor a registry file exists, the page says to ask the sender for a new link.
- `lists/` holds only lists the repository owner chose to publish, added by reviewed pull request, never a child's real list. No personal data goes in a registry file. The build copies `lists/` only if it exists. `denylist-guard` already scans every file in the tree, so it covers `lists/`.

## Getting words in

- Type or paste a list (commas, new lines or spaces).
- Take a photo or scan. OCR runs on the device with Tesseract.js, and the photo is never uploaded. A photo is never persisted: object URLs are revoked, the canvas is released, and nothing about the image is stored in `localStorage` or IndexedDB. `ocr.js` sets `workerPath`, `corePath` and `langPath` to the site origin (all three default to a CDN), and `tests/mine-privacy.test.mjs` fails if any OCR path resolves to another origin.
- A review screen with editable chips is required before anything is saved. Each chip says found, not found or "did you mean". A handwriting-accuracy warning is shown for photos.
- Several named lists, delete a list, and JSON export and import as a backup.

## Library generator (ships with the library in Phase 1)

- Lives in `tools/library/` (not deployed). It runs by hand, offline from the site, because the English Wiktionary extract is large (about 3.4 GB, see the findings). It writes `library/<letter>.json` and `library/NOTICE.md` (the sources and licence of each field).
- Its inputs are pinned in `tools/library/sources.json`: for each source the URL, the version or date, the size and the SHA-256, checked before use, the way `scripts/fetch-voice-assets.mjs` checks the model files. The sources are Open English WordNet 2025, the Simple English Wiktionary extract and, for origin labels only, per-word English Wiktionary extracts, as chosen in the findings. Phase 1 fills in the checksums.
- Size budget: each shard stays under 150 KB and the whole library under 3 MB (Phase 1 tests both).
- A test checks that every shard is valid under `mine/validate.js`, that every sentence contains its word exactly once, and that `library/NOTICE.md` names every source used.
- A fresh engineer regenerates a shard with the commands in `tools/library/README.md`, which Phase 1 writes. Phase 3 extends the tooling (word-list selection and growth), not the first generator.

## Repository touchpoints

- `scripts/build.mjs` has an allowlist. Phase 1 adds `mine/` and `library/`, and copies `lists/` only if it exists (the way `clips/` is handled). A site test fails if `mine/` or `library/` is missing from the staged `_site`, so a missing directory cannot ship silently.
- **OCR files (new in Phase 2).** `scripts/fetch-voice-assets.mjs` gets extra pinned rows for the Tesseract.js worker, one core file and the English model, written to `_site/voice-assets/ocr/`. That folder is inside the path the existing cache step already caches (`_site/voice-assets`), and the cache key already includes a hash of the fetch script, so a cache hit means an outage at the upstream host cannot fail a deploy or a rollback, and adding rows saves a fresh cache. The upstream is the npm package files pinned by exact version (`tesseract.js@7.0.0`, `tesseract.js-core@7.0.0` and the `@tesseract.js-data/eng` package at the `4.0.0_best_int` folder), each with its size and SHA-256 recorded in the script, as the Kokoro files are. If the download fails and there is no cache, the deploy fails closed and the rollback is to revert the pull request.
- `.github/workflows/pages.yml` and `tests/workflows.test.mjs` pin the cache path, the cache key format and the smoke-check list. Phase 2 does not change them, so the workflow file stays as it is. Adding an OCR path to the smoke check is optional; if it is done, the workflow and its test are edited together in the same pull request, by explicit decision. Phase 2 instead proves the OCR files are live with an HTTP check recorded in its pull request.
- `npm test` and `npm run serve` do not fetch the voice or OCR assets (only the deploy job does). Phase 2's fixture tests cover the pure image-processing and word-parsing code on generated images; the real OCR run is a manual check with `npm run build && npm run fetch-voice-assets`, as the README already describes for the voice model.
- `README.md` and `CLAUDE.md` get the new feature and the documented import-time third-party exception in the same pull request that adds live lookup (Phase 1), not later. The README's "never sent by the site" privacy text gets the same exception.
- Health: the site has no analytics by design, so health is the deploy smoke check plus a manual check of `?mode=mine`. Each photo import downloads the OCR files (about 7 MB on first load, see the findings) from GitHub Pages, which counts toward Pages bandwidth.

## Safety and limits

- No accounts, no analytics, no photo upload, no backend.
- UI rules for children on phones apply: form fields at least 16 px, tap targets at least 44 px, no text under 12 px, fixed accessible button names (state in `aria-pressed` or `aria-expanded`).
- `tools/device-test` is WebKit emulation, not a real iPhone or iPad. Results are reported as emulation.

## Ownership and incidents

The owner is the repository owner (the GitHub account that owns this repository), as the README's "Ownership and incidents" section already says for the site.

| Case | Action |
|---|---|
| A licence or attribution complaint about shard text | Fix `library/NOTICE.md` or remove the field, by pull request. Removed text stays in git history; say so in the reply. |
| A bad definition or sentence reported by a grown-up | Edit the shard by pull request. The route is the repository's issue tracker or its private vulnerability report for anything sensitive. |
| Wikimedia blocks the site or changes its limits | Set `LIVE_LOOKUP_ENABLED` to `false` by pull request. The page falls back to manual entry. |
| A personal list appears in `lists/` | Remove it by pull request, and follow the repository's incident steps (history may need cleaning by the owner). |
| A child's list appears in a pull request, issue or comment | Close and remove it; no student data belongs in this repository. |

## Phases, one pull request each

| Phase | Lands | Rollback |
|---|---|---|
| 0 Spike | This plan and the findings note | Revert the docs pull request. No runtime effect. |
| 1 MVP | The `app.js` seam, `mine/` modules, storage, list id and share link, paste import, default-list match, the library generator and library v1, live lookup with disclosure and toggle, review screen, practice from a list, tests, README and `CLAUDE.md` updates | Revert the pull request and redeploy through `pages.yml`; or set `MINE_ENABLED` to `false`. Keys already saved in a browser stay inert when the code is gone. The default keys are never touched. |
| 2 Photo | OCR import, the OCR rows in `scripts/fetch-voice-assets.mjs`, fixture tests, device-test extension | Revert the pull request (this also removes the fetch rows); or set `OCR_ENABLED` to `false`. If the OCR download fails with no cache, the deploy fails closed. |
| 3 Registry and growth | The `lists/<id>.json` resolver, library growth tooling, final README and `CLAUDE.md` pass | Revert the pull request; the resolver then finds nothing and the page says to ask the sender for a new link. |

Each pull request gets an independent security, operator and claims review, plus an accessibility review for anything a child sees and a privacy review for Phases 1 to 3.
