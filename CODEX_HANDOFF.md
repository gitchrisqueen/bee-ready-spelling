# Codex handoff: create gitchrisqueen/bee-ready-spelling and publish to GitHub Pages

## Goal
Publish THIS directory as a public GitHub repository owned by `gitchrisqueen` and deploy its static web app through GitHub Pages. Do not create a new ChatGPT Sites project. The existing `chatgpt.site` link is a separate origin and is not under GitHub Pages control. Use the Pages URL as the canonical repo-hosted site once verified.

## Inputs
Unzip `Bee_Ready_GitHub_Pages_Repo.zip` from the originating conversation. All app source, 1,155-word JSON data, tests, three printable PDFs, `scripts/build.mjs`, and `.github/workflows/pages.yml` are in the root.

## Steps
1. Confirm `gh auth status` shows the correct `gitchrisqueen` account with permission to create public repositories and manage GitHub Pages. If needed, have the user authenticate with `gh auth login` in their own Codex/browser session. Never request or paste their PAT or password in chat, commits, files, or logs.
2. Run `npm test && npm run build`. Inspect for malformed source and ensure `_site/index.html`, `_site/words.json`, the PDFs, and both `app.js` and `voice-service.js` are present. Test locally with `python3 -m http.server 8080` if a browser is available.
3. Check whether `gitchrisqueen/bee-ready-spelling` already exists (`gh repo view gitchrisqueen/bee-ready-spelling`). If it exists, **inspect before modifying**, and avoid overwriting any unrelated files, branches, or user changes. If it does not exist, initialize `git`, commit source on `main`, then create and push the public repository with `gh repo create gitchrisqueen/bee-ready-spelling --public --source=. --remote=origin --push --description='Kid-friendly spelling bee practice with free natural voice and automatic fallback'`.
4. Enable GitHub Pages with **Source = GitHub Actions** in Settings → Pages. For authenticated CLI automation, `gh api -X POST repos/gitchrisqueen/bee-ready-spelling/pages -f build_type=workflow` may configure it. If already configured, inspect or update its build type rather than treating a 409 conflict as success. If a permissions error occurs, ask the user to authorize the session or perform the Pages setting in the GitHub UI.
5. The provided `.github/workflows/pages.yml` should run automatically on push to `main`. If Pages was enabled after the first push, trigger the workflow with `gh workflow run pages.yml -R gitchrisqueen/bee-ready-spelling` or a no-op commit only after checking the workflow state. Verify the newest run concludes successfully using `gh run list/view` and check GitHub Pages deployment status.
6. Check the live site at `https://gitchrisqueen.github.io/bee-ready-spelling/` (this is **only an expected URL until verified**). Confirm that the page and linked PDFs return HTTP 200, the word count is 1,155, and there are no console errors. Test mobile (390px) and tablet (820px) viewports, random rounds, pronunciation requests, voice-selector controls, per-file download indicators, and Kokoro→Piper→device fallback. Do not claim natural voice works on physical iOS devices without actual device validation.
7. Report the **verified** repo URL, Pages URL, default branch, Pages source, workflow run outcome, commit SHA, and any limitations. If anything fails, provide specific error outputs and the next action. Do not announce 'live' before the deployment succeeds and the public site opens.

## Guardrails
- Keep the repository **public** and under `gitchrisqueen` only; no third-party or workspace org, unless the user changes that instruction.
- Do not upload secrets or original private account metadata. The package contains only public site resources.
- Do not try to replace the old ChatGPT Sites project unless separate edit authorization/access is available. The original `chatgpt.site` link cannot be redirected from GitHub Pages by itself.
- Keep the UX child-friendly and preserve the complete word data, PDFs, and progress/fallback messages.
- For any broken CDN or TTS model download, fix the code and repeat tests. Offline mocks alone do not prove real browser model downloads.
- GitHub Pages is static hosting. Do not add a paid backend or third-party TTS login.
