# VNO-20 and VNO-21: fixes for the findings of the hub run

Source: `ROADMAP.md` "Tasks, in order" (VNO-20, VNO-21). Confirm each cause in the code before fixing.

- **Branch:** `VNO-20-21_fixes`, cut from `origin/master` 2f22db1, in the worktree `C:\projects\Personal\visual-novels-orchestrator-wt` (the main checkout stays on master for the hub's live checks; do not touch it or the running VN Studio).
- **User's instruction (2026-10-23):** both on this one branch, **one commit per ticket** (`VNO-NN: <what>`), code and test together. A last commit updates `ROADMAP.md` and the ticket docs.

## Tickets

- [x] **VNO-20 (c08ba1f): a lost ComfyUI prompt must not leave a job running.** A generate job stayed `running` after ComfyUI crashed natively and came back with an empty queue; `vno_stop_now` + `vno_resume_all` restarted it. Fix: while waiting on a ComfyUI prompt, when ComfyUI answers again and the prompt id is in neither `/queue` (running/pending) nor `/history`, treat the prompt as lost: re-submit it once, then fail the job with a clear error. Also cover ComfyUI being unreachable for longer than a bound (fail rather than hang forever). Test with a fake ComfyUI client: prompt vanishes → one retry → success; vanishes twice → job failed, not running.
- [x] **VNO-21 (d8cb752): VNO-08's hr UI strings reach older projects on rebuild.** The `the-clockless-god-3` Croatian build had 46 of 87 screen strings still in English. Find how the game's UI/menu strings are written per language (VNO-08 added Croatian ones) and why a project created before VNO-08 keeps English ones on rebuild (e.g. a cached/project-local translation file that is not refreshed, or keys missing from it). Fix so a rebuild fills missing strings from the built-in set (without overwriting strings the user or a model edited). The project lives in VN Studio's data folder (see `CLAUDE.md`/README for where; read it only, do not modify it), useful to confirm the cause. Test: an older-style project with a partial hr string set → rebuild output has every built-in hr string.

## Added 2026-10-23 (found by the hub's HUB-07 live run, same branch, one commit each)

- [x] **VNO-22 (7189617): a Flow book must not fail because flow-music-mcp's Chrome is not open yet.** `studios/flow.ts` `status()` sets `signedIn = false` and the hint "the Chrome window of flow-music-mcp is not running: run yarn login" when `flow_status` says `chrome_running: false`. But flow-music-mcp opens Chrome itself on the first real call (`getBrowser` launches it); only `flow_status` does not. So the generate step's pre-check failed a book (`hub07-flow-test`, 3 attempts) although the profile is signed in. Fix: Chrome not running means "unknown" (`signedIn: null`, no blocking hint), so the generate step goes on and the first Flow call opens Chrome; a real sign-out still fails fast through the `signedOut` mapping of the first call's error. Test with a fake client: `chrome_running: false` does not block the pre-check; `signed_in: false` with Chrome up still does.
- [x] **VNO-23 (f0e0006): the seeded `flowRepo` path has a form feed.** `seed/config/studios.md` line 20 is `flowRepo: C:\projects\Personal<FF>low-music-mcp` (byte 0x0C where the backslash and `f` should be), probably written through an escaped string. Fix the seed to `C:\projects\Personal\flow-music-mcp`; check every seed file (and the source strings that wrote them) for other control characters from `\f`, `\v`, `\b`, `\t`, `\r`, `\n` damage in Windows paths, and fix them. Seed refresh: an unchanged seeded file is updated at the next start (check `seed:hashes` or whatever the repo uses so users' unedited copies get the fix). A test that no seed file contains control characters other than newline, carriage return and tab.


## Added 2026-10-23, second round (hub HUB-07 run, same branch)

- [x] **VNO-24 (ed752bb): stop the voice step on a daily Gemini quota.** In `hub07-flow-test` the Croatian voice job got HTTP 429 from Gemini TTS (through flow-music-mcp `flow_narrate`) with Google's text "Please retry in 21h21m47.5s" (the free tier's daily quota). VN Studio still ran its 10/30/90 s retries (`flowVoiceRetries`) on each of the 6 remaining clips, then failed each. Fix: parse the retry time from the error text (`retry in 21h21m47.5s`, `retry in 45s`, and Google's `retryDelay` if present); when it is longer than the remaining retry schedule, stop at once: fail that clip and the remaining clips of the job without calling Flow again, with one message that says the daily quota is used up and when it resets (now + retry time, local time). Short retry times keep today's behaviour. Clips already made are kept (the index is saved after every clip, as now). Tests with a fake Flow client: a short retry time still retries; a long one stops after the first clip and calls nothing more.

## Result (2026-10-23)

- VNO-20: cause confirmed: `waitForOutputs` treated a missing history entry as "queued" until the job timeout (30 min). Now it checks `/queue`, re-reads the history, and throws `LostPromptError`; `runGraph` re-submits once, then fails. `unreachableTimeoutMs` (default 300 s) bounds an outage. Tests in `tests/comfy-client.test.ts` (vanish once: success; twice: failed; still queued: not lost; unreachable: fails).
- VNO-21: **deviation, cause differs.** The project's `config/languages.md` is empty and the rebuild refills strings from the built-in table each time. Of the 87 strings in the project's `tl/croatian/screens.rpy`, 46 are Ren'Py's stock help and sync screen strings that the 49-string table never contained. Fix: 33 Croatian strings added to `src/shared/ui-strings.ts` (language-neutral ones left out); other languages still keep these in English (follow-up). Tests: partly translated older-style stub gets every hr string; every `_()` string of the template screens is in the hr table or a neutral list; the table tests now treat the first 49 keys as the core set.
- `yarn test` 910 passed, `yarn typecheck` and `yarn lint` exit 0. Not run: `renpy lint` (only tl string content changed), a live ComfyUI crash, a rebuild in the app.

- VNO-22 done as planned: `status()` gives `signedIn: null` for `chrome_running: false`; tests in `studios-flow-client.test.ts` and `flow-generate.test.ts` (unknown state does not block; `signed_in: false` still does).
- VNO-23 done as planned: only `seed/config/studios.md` had control characters (the pycache files under `templates/` are binary and not seeds). Seed hashes refresh unedited copies, no migration needed; `tests/seed-files.test.ts` checks the seed for control characters and the refresh of a damaged unedited copy.
- After VNO-22/23: `yarn test` 913 passed, `yarn typecheck` and `yarn lint` exit 0.

- VNO-24 done as planned: `parseRetryDelayMs` and the quota stop in `src/engine/voice/flow.ts`; "longer" means more than the whole retry schedule and at least 5 minutes (`QUOTA_MIN_MS`). Tests in `tests/voice-flow-jobs.test.ts` (parsing, short time still retries, long time stops after one call, clips made before are kept).

## Verification

- `yarn test`, `yarn typecheck`, `yarn lint` in the worktree; all must pass. `renpy lint` on an integration case if the Ren'Py output changed and the SDK is available as in earlier tickets.
- Not run here: a live ComfyUI crash, a rebuild in the running app (the hub does that after merge).

## Done when

Two ticket commits plus one docs commit on `VNO-20-21_fixes`; the checklist ticked with evidence; `ROADMAP.md` moves VNO-20/21 to Done and corrects "Where it stands" (VNO-10 to VNO-19 merged, PR #11).
