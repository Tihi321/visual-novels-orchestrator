# VNO-47 — Picture-book presentation in VN Studio (HUB-17, VN Studio half)

Branch `VNO-47_picture-books` (from master; not committed, not pushed). This note is the durable plan/checklist for the ticket; the
authoritative cross-repo plan is `C:\projects\Personal\creative-hub\.claude\tickets\HUB-17-picture-books\plan.md` (D1–D8, D11).

## Scope

A children's-picture-book presentation mode, decided by `VnBook.presentation` (D1): one page (scene) = one illustration with the
characters drawn into it + a caption from the scene's narration/line beats, page turns, no sprites/CGs, read aloud from the page's
existing voice clips. VN projects must behave exactly as before. No Scriptorium, no hub changes.

## Checklist

- [x] D1/D3: `src/shared/vn.ts` — `PRESENTATIONS`, `PICTURE_BOOK_FORMATS = ['kids-picture-book']`, `presentationForFormat`,
      `presentationOf`, `isPictureBook`, optional `presentation` on `vnBookSchema` (old `vn.json` still parses).
- [x] D3: `src/engine/vn/ids.ts` — `pictureBookBackgroundId` (`bg_ch01_s01`) and `backgroundIdFor`; call sites routed through it in
      `script.ts` (parse options gain `presentation`), `pack.ts`, `import.ts`, `story.ts`, `fixes.ts` (in a picture book `keepArt` is skipped).
- [x] D1: imports store the presentation (legacy folder + pack); `storyInputSchema.presentation`; `book.update { presentation }`
      recomputes every scene's background id; `storySummary` reports `presentation`.
- [x] D4: `src/engine/assets/derive.ts` — `charactersOnPage`, page asset plan (one `background` per scene, `sheet_<char>` internal
      references, no `sprite_*`, no `cg_*`), page refs = sheets of at most 3 people, pages with cast use `art.editor`.
- [x] D5: page `fallbackPrompt('background')` keeps people (place looks + description) and names the cast (`peopleClause`/`personLine`)
      with `PAGE_FRAMING`; `fallbackNegative('background', { pictureBook: true })` drops the people/animal bans. VN prompts/negatives
      unchanged (byte-identical default path).
- [x] `src/engine/assets/generate.ts` — a page background with refs generates with the edit engine + sheet references (ComfyUI and
      Flow); page negatives use the picture-book negative.
- [x] `src/engine/vn/agents/art-director.ts` — `describeAsset` page branch (people kept, page framing), `pagePrompt`/`ensureFraming`
      remove the empty-background wording and cannot reintroduce it, `mergeNegative` opts, `planArt` picture-book note and style words.
- [x] D6/D7/D8: `src/engine/game/emit.ts` — `GameData.presentation`; `buildGameData` has no sprites/CGs for a picture book;
      `emitProject` returns no sprite/CG images; `build.ts`/`images.ts` copy page images whole (`contain`, no crop).
- [x] `src/engine/game/player-runtime.ts` — page layer DOM, `.vno-picturebook` CSS (image band 0–800 contained, caption 800–1080,
      footer), page mode JS (`pictureBookPages`, `startPictureBook`, `showPage`, `renderPage`, `renderPageCaption`, `pageCaption`,
      `nextPage`, `prevPage`, `playPageVoice`, replay, end card), language re-render, quick save per turn + menu Load resumes the page,
      click/caption/keys/swipe, VN paths guarded by `presentation === 'picture-book'`.
- [x] `src/engine/game/lint.ts` — page without illustration = error, page without text = warning, sprite/CG/image-cue leftovers =
      warnings, statistics say pages; handler shows warnings without failing the lint.
- [x] `src/shared/ui-strings.ts` — Croatian `Next`, `Previous`, `Page {} of {}`, `Read aloud` (appended after the 49 core keys).
- [x] Renderer: `BookPage.tsx` picture-book pill + "Pages" tab label; `ScenesTab.tsx` page preview (illustration + caption + page
      counter + prev/next), sprite/slot/expression/CG-cue controls hidden, place/time/music/ambience/cast editing kept;
      `LookTab.tsx` hides sprite-only settings and shows a one-line note.
- [x] Docs: `docs/protocol.md` (picture books section, asset ids, lint), `docs/mcp-guide.md` (Picture books + story operations),
      `README.md`; MCP instructions and `vno_create_project` description mention picture books.
- [x] Tests: `tests/picture-book.test.ts` (helpers/ids, fixture import, asset plan, prompts/negatives, art-director, buildGameData,
      story ops, lint), `tests/vn-ids.test.ts`, `tests/assets-generate.test.ts` (page from sheets, page from generator),
      `tests/renpy-template.test.ts` (runtime strings + fake-DOM flow: start → page 1 → next → page 2 → Load resumes → page 3 → end
      card; language switch; no sprite `<img>`; VN unchanged), `tests/fixtures/books/picture-book/` (3-page v2 pack, valid pack hash).

## Verification (run from the repo, `fnm exec --using=24 cmd /c ...`)

- `yarn test` — 79 files, **1087 tests passed** (was 78 files / 1071 tests before this ticket; 16 new tests). One earlier full run
  had a single failure in the unrelated `tests/scheduler.test.ts` timing test ("3 books x parallel reviews ..."); that file passed
  alone (35/35) and the repeated full run passed 1087/1087.
- `yarn typecheck` — clean (node + web).
- `yarn lint` — clean.
- `yarn build:engine` — exit 0 (only the pre-existing dynamic-import warning for `src/shared/puzzle.ts`).

## Deviations / notes

- The player's main-menu **Load** in picture-book mode resumes the quick save directly (there is no save screen); a VN keeps its
  save/load screens. The quick save is written on every page turn.
- A picture-book page with characters generates with the edit engine **and** its sheets as references both on ComfyUI and Flow
  (`generate.ts`); without this the refs would have been planned but unused (VN backgrounds never have refs, so nothing changes for VN).
- `buildGameData`/`emitProject` omit sprites and CGs for picture books (planned none), so a picture-book build copies only page images
  and the cover; the legacy `.rpy` files are still written (web player is the output).
- Lint warnings are surfaced with a `warning: ` prefix in the lint messages but do not fail the run (only errors do).
- The end card shows the localized "The End" (as the plan says); a chapter ending text is used by the ending card code for VN books and
  is not shown on the picture-book end card (Scriptorium picture books are one ending chapter). If the last chapter has choices they are
  still offered (D7).
- Package `presentation` is deliberately not in the v2 pack schema: the pack's `book.format` is the source of truth and the importer
  derives the presentation from it (no Scriptorium or pack-contract change).

## Not done

- Nothing from the assigned VN Studio work list is left. The live Croatian production and the user's verdict are hub work (HUB-17).
