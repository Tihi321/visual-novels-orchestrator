# VNO-20 and VNO-21: fixes for the findings of the hub run

Source: `ROADMAP.md` "Tasks, in order" (VNO-20, VNO-21). Confirm each cause in the code before fixing.

- **Branch:** `VNO-20-21_fixes`, cut from `origin/master` 2f22db1, in the worktree `C:\projects\Personal\visual-novels-orchestrator-wt` (the main checkout stays on master for the hub's live checks; do not touch it or the running VN Studio).
- **User's instruction (2026-10-23):** both on this one branch, **one commit per ticket** (`VNO-NN: <what>`), code and test together. A last commit updates `ROADMAP.md` and the ticket docs.

## Tickets

- [x] **VNO-20 (c08ba1f): a lost ComfyUI prompt must not leave a job running.** A generate job stayed `running` after ComfyUI crashed natively and came back with an empty queue; `vno_stop_now` + `vno_resume_all` restarted it. Fix: while waiting on a ComfyUI prompt, when ComfyUI answers again and the prompt id is in neither `/queue` (running/pending) nor `/history`, treat the prompt as lost: re-submit it once, then fail the job with a clear error. Also cover ComfyUI being unreachable for longer than a bound (fail rather than hang forever). Test with a fake ComfyUI client: prompt vanishes → one retry → success; vanishes twice → job failed, not running.
- [x] **VNO-21 (d8cb752): VNO-08's hr UI strings reach older projects on rebuild.** The `the-clockless-god-3` Croatian build had 46 of 87 screen strings still in English. Find how the game's UI/menu strings are written per language (VNO-08 added Croatian ones) and why a project created before VNO-08 keeps English ones on rebuild (e.g. a cached/project-local translation file that is not refreshed, or keys missing from it). Fix so a rebuild fills missing strings from the built-in set (without overwriting strings the user or a model edited). The project lives in VN Studio's data folder (see `CLAUDE.md`/README for where; read it only, do not modify it), useful to confirm the cause. Test: an older-style project with a partial hr string set → rebuild output has every built-in hr string.

## Result (2026-10-23)

- VNO-20: cause confirmed: `waitForOutputs` treated a missing history entry as "queued" until the job timeout (30 min). Now it checks `/queue`, re-reads the history, and throws `LostPromptError`; `runGraph` re-submits once, then fails. `unreachableTimeoutMs` (default 300 s) bounds an outage. Tests in `tests/comfy-client.test.ts` (vanish once: success; twice: failed; still queued: not lost; unreachable: fails).
- VNO-21: **deviation, cause differs.** The project's `config/languages.md` is empty and the rebuild refills strings from the built-in table each time. Of the 87 strings in the project's `tl/croatian/screens.rpy`, 46 are Ren'Py's stock help and sync screen strings that the 49-string table never contained. Fix: 33 Croatian strings added to `src/shared/ui-strings.ts` (language-neutral ones left out); other languages still keep these in English (follow-up). Tests: partly translated older-style stub gets every hr string; every `_()` string of the template screens is in the hr table or a neutral list; the table tests now treat the first 49 keys as the core set.
- `yarn test` 910 passed, `yarn typecheck` and `yarn lint` exit 0. Not run: `renpy lint` (only tl string content changed), a live ComfyUI crash, a rebuild in the app.

## Verification

- `yarn test`, `yarn typecheck`, `yarn lint` in the worktree; all must pass. `renpy lint` on an integration case if the Ren'Py output changed and the SDK is available as in earlier tickets.
- Not run here: a live ComfyUI crash, a rebuild in the running app (the hub does that after merge).

## Done when

Two ticket commits plus one docs commit on `VNO-20-21_fixes`; the checklist ticked with evidence; `ROADMAP.md` moves VNO-20/21 to Done and corrects "Where it stands" (VNO-10 to VNO-19 merged, PR #11).
