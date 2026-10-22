# VNO-16 changelog (2026-10-22)

## Behaviour

A `CG:`, `SLIKA:` or `INSERT:` image from an imported script now gets `characters`: the bible characters whose name or alias appears as whole words in the cue text (case, diacritics and punctuation ignored; `Dr. Vey` matches `Dr Vey`), in text order, at most 3. No match leaves `characters` unset, as before. The first entry for a key is kept; characters set by hand later (`vno_image_set`, story edits) are never touched, since import only builds new entries. The art director therefore gets the characters' looks and sheets for these CGs.

## Files

- `src/engine/vn/script.ts`: `charactersInText`, `MAX_CUE_CHARACTERS`, used in `parseChapterScript`.
- `tests/vn-import.test.ts`: one new test (order, cap of 3, alias, insert, no match, "Marathon" does not match "Mara").
- `docs/mcp-guide.md`: note in the Pictures and sounds paragraph.
- `ROADMAP.md`: VNO-16 under Done.
- `.claude/tickets/VNO-16-cg-characters-at-import/plan.md`, this file.

## Verification

`yarn test`: 56 files, 742 tests pass (741 before). `yarn typecheck` and `yarn lint`: clean. Not run: a live import into the hub (the hub runs master).

## Follow-up (2026-10-22): the Aliases sentence stays out of the looks

The hub H1 check showed that a bible bullet `- **Kessler**: <looks>. Aliases: the bald man, Brother Kessler. Voice: <voice>` (the form Scriptorium SCP-16 writes) filled `aliases` correctly but left the `Aliases: ...` sentence inside `looks`, so sheet and sprite prompts carried it. `parseBible` now takes the explicit list sentence (`Aliases:`, `Alias:`, `Nadimci:`, `Nadimak:`) out of the looks and keeps the names as `aliases` (`stripAliasSentence` in `src/engine/vn/aliases.ts`). Quoted aliases in prose ("known as ...") and `Also:` are left where they are. Test in `tests/vn-import.test.ts`.
