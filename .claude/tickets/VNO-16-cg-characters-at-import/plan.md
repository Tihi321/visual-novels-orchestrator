# VNO-16: CG characters at import

Part of hub ticket HUB-06 (plan: creative-hub `.claude/tickets/HUB-06-scriptorium-vn-media-lines/plan.md`, "Does VN Studio need a change?"). Branch `VNO-10-19_hub-roadmap`.

## Problem

`parseChapterScript` creates a `CG:` / `INSERT:` image as `{ key, description, display }`. With no `characters`, the art director gets no character looks and the CG is drawn without the sheets as references, so faces may not match the sprites. The fix today is a hand edit per CG (`vno_image_set`).

## Plan

- [x] In `src/engine/vn/script.ts`, add `charactersInText(text, chars)`: bible characters whose name or alias appears as whole words (case, diacritics, punctuation ignored), in text order, at most 3. Use it when a new image is created in `parseChapterScript`; set `characters` only when non-empty.
- [x] A reused cue (same key) keeps the first entry. Nothing is overridden: import only builds the entries, and `characters` set later by hand (`vno_image_set`, story edits) are never touched.
- [x] Test in `tests/vn-import.test.ts`: order, cap of 3, alias match (also `Dr. Vey` matches `Dr Vey`), insert, no match leaves `characters` unset (and "Marathon" does not match "Mara").
- [x] `docs/mcp-guide.md` note; `ROADMAP.md` row moved to Done.

## Out of scope

First-name-only or fuzzy matching (the strict name/alias rule avoids drawing the wrong person).
