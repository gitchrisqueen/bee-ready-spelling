# My words: custom word lists for Bee Ready

Status: plan, written at the start of Phase 0 and updated with the Phase 0 findings (see `my-words-phase0-findings.md`). This file is the source of truth for the feature while it is being built.

## Goal

Let any child, at any age or school level, practise their own words (for example this week's spelling list) with the same practice screen as the default 1,155-word list. Words already in the default list are brought in as they are. New words get a definition, part of speech, origin and a practice sentence where one can be found. A list can be typed, pasted, shared as a link, or captured from a photo.

The default experience must not change.

## Entry point and isolation

- `?mode=mine` on the same site, plus a "Use your own words" link in the Grown-ups tab. There is no new tab and no new button in the default view.
- `app.js` gets one small seam (about 20 lines): the word source is `words.json` by default, or the active custom list in `mine` mode. `initAnswerBox`, `shouldBlockInsert`, `isBigJump` and `BLOCKED_INPUT_TYPES` stay as written, because `tests/a11y.test.mjs` reads them as text.
- Custom words have their own ids, the level `Mine`, and separate storage keys (`bee-ready-mine-v1` and a separate history key). The default list's history and stars are never touched. The Study and Challenge pool options are hidden in `mine` mode.
- New code lives in `mine/`: `lists.js` (storage and list id), `lookup.js` (enrichment behind a small interface), `import.js` (parsing and the review screen), `ocr.js` (photo), `ui.js`. Pure logic is tested without a browser, like `stars.js`.
- `words.json`, `sentences.js`, `voice-service.js`, `clips/` and `tools/clips/` are not modified, because changing them starts the clip-recording workflow and nothing here needs that.

## Where a word's data comes from

For each imported word, the first hit wins:

1. **Default list.** If the word is in `words.json`, use that entry as it is, with its recorded clip.
2. **Static library.** `library/<letter>.json` shards in the repo: part of speech, a short definition, an origin and a reviewed sentence. The page fetches only the shards it needs. No third party is involved.
3. **Live dictionary**, at import time only. See "Third-party requests" below.
4. **Manual entry** by the grown-up. Words with no definition show a "Look it up in Merriam-Webster" link, the same link-out the word cards already have.

`group` (the origin clue) is filled from the etymology's source language where one is found. Otherwise the origin clue says origin is not available.

Sentences are tiered: a reviewed library sentence first; then a dictionary example, only if it contains the word exactly once as a whole word and passes a child-safety filter; then the generic fallback from `sentences.js`, which the grown-up can edit. Every sentence must contain its word exactly once.

Audio: words in the default list use their recorded clips. Other words use the device voice, or live Kokoro if the grown-up turned it on. The page says that device pronunciation of rare words can be wrong. No clips are added for custom words.

## Third-party requests

- No third-party request on page load, and none in default mode. A test proves this.
- Live lookups happen only when an import runs in `mine` mode. The import screen shows a one-line disclosure, and a grown-up toggle in the Grown-ups tab turns live lookup off.
- Sources are credited where a licence requires it.
- Merriam-Webster is a link-out only. No Merriam-Webster API key is shipped in the page or the repo, and the API is never bulk-queried, because its terms bar automated or recorded queries. Any later use of that API belongs behind a server-side proxy, which is out of scope.
- The live API is chosen in Phase 0 (see the findings file).

## Share links

`?mode=mine&l=<id>#w=<packed words>`

- `id` is the first 12 characters of SHA-256 over a salt constant (`mine/salt.js`) plus the list's unique words, lowercased and sorted by code point. The salt is public: it is a version label, not a secret.
- The same words always give the same id, on any device, so importing a list you already have is detected.
- The words travel in the URL fragment (which browsers do not send to the server), compressed and URL-safe. The page re-hashes them and rejects a link whose words do not match `l`.
- A saved list can always regenerate its link.
- A hash cannot be decrypted. A link that has only an id resolves through an optional `lists/<id>.json` registry in the repo (the resolver is built; there is no publish UI). If neither exists, the page says to ask the sender for a new link.

## Getting words in

- Type or paste a list (commas, new lines or spaces).
- Take a photo or scan. OCR runs on the device with Tesseract.js, and the photo is never uploaded. The OCR files are self-hosted and fetched at deploy with pinned SHA-256 hashes, the way the Kokoro model is.
- A review screen with editable chips is required before anything is saved. Each chip says found, not found or "did you mean". A handwriting-accuracy warning is shown for photos.
- Several named lists, delete a list, and JSON export and import as a backup.

## Safety and limits

- Everything imported or fetched goes through `escapeHtml`.
- At most 200 words per list and 40 characters per word; letters, hyphens and apostrophes only.
- No accounts, no analytics, no photo upload, no backend.
- UI rules for children on phones apply: form fields at least 16 px, tap targets at least 44 px, no text under 12 px, fixed accessible button names.
- `tools/device-test` is WebKit emulation, not a real iPhone or iPad. Results are reported as emulation.

## Repository touchpoints

- `scripts/build.mjs` has an allowlist: `mine/`, `library/` and `lists/` must be added or they never deploy.
- OCR assets are fetched at deploy. Wiring this through the existing fetch step keeps the workflow file unchanged where possible; any workflow edit follows the CI standard in `CLAUDE.md`, and `denylist-guard` and `tests/workflows.test.mjs` are never weakened.
- `README.md` and `CLAUDE.md` get the new feature and the documented import-time third-party exception. The `tools/device-test` third-party check allows only the chosen API hosts, and only in `mine` mode.

## Phases, one pull request each

| Phase | Lands |
|---|---|
| 0 Spike | This plan, and the findings note: live API and library source chosen, licences checked, OCR measured on synthetic samples |
| 1 MVP | The `app.js` seam, list storage, list id and share link, paste import, default-list match, library v1, live lookup with disclosure and toggle, review screen, practice from a list, tests |
| 2 Photo | OCR import, deploy-time fetch of the OCR files with pinned hashes, fixture tests, device-test extension |
| 3 Library and registry | The `lists/<id>.json` resolver, library growth tooling, final README and `CLAUDE.md` pass |

Each pull request gets an independent security, operator and claims review, plus an accessibility review for anything a child sees and a privacy review for Phases 1 to 3.
