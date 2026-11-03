# VNO-58: bilingual (parallel-text) book export

Branch `VNO-58_bilingual-export`, from master at 84b72ce (VNO-57). Research: `research.md` in this folder; where this plan differs from it, this plan wins. Builds on the HUB-25 export (VNO-52/53/54/56: `src/engine/export/`, `vno_export_book`, the Build-tab Export panel).

Rules for every worker: one commit `VNO-58: ...` at the end (only when the user asks), `yarn typecheck && yarn lint && yarn test` green (`fnm exec --using default yarn ...` if `node` is not on PATH), scratch files under `.claude/temp/`, no service started, nothing spends money. Tests follow the global `test-discipline` skill: only the tests listed below.

## Scope

VN Studio only (`vno_export_book` and the Build-tab Export panel). A new optional parameter `lang2`: under each paragraph, picture-book caption, choice text, chapter title and ending text of the main language (`lang`), the same line from the `lang2` edition is printed smaller, grey and italic. Both EPUB and PDF, all three modes (gamebook, linear, picture-book). The "turn to section N" phrase, "The End." and the restart line stay in the main language only; the translated choice text goes on its own line under the choice. The dry run reports `lang2`, the paired line count and the unpaired count. With `lang2` unset, every output is unchanged (same ExportBook, same EPUB bytes apart from `dcterms:modified`, same PDF layout).

## Out of scope

Scriptorium; automatic translation (`lang2` must already be an edition); word-by-word interlinear text; audio; RTL or CJK second language (RTL is refused; CJK has no glyphs in Lora and gets no new guard, as in the single-language export); fixed-layout picture books (VNO-55); a second `<dc:language>`; translating the cover title, the nav/contents and the PDF bookmarks (main language only).

## Decisions (director defaults; the user approves them with the plan, each can be changed)

- D1 Pairing is lenient and by id, never by position: paragraphs by beat id, choices by `"<chapter>:<choiceIdx>"`, chapter titles and endings by chapter number. A line with no text in `lang2` prints without translation; one warning lists the ids (first 10, then `+N more`). The main language keeps today's strict `validateStory`.
- D2 Refusals (thrown, nothing written): `lang2 === lang`; `lang2` is right-to-left (`isRtlLang`); `lang2` is neither the primary language nor a file in `editions/`. The "no edition" message lists the languages that exist (primary first, then `store.editionLangs`), for `lang` and `lang2` alike: `project "<slug>" has no <x> edition (editions: en, de, hr)`. The `lang2` may be the primary language (its text comes from vn.json, as for `lang`).
- D3 Speaker names in a translated line come from the `lang2` edition's `characterNames` (fallback `speakerLabel`), formatted `Name: text` like the main line. Picture-book and linear titles pair; gamebooks have no titles (spoilers), so nothing to pair there.
- D4 Filename `<slug>-<lang>-<lang2>.<ext>` (single language stays `<slug>-<lang>.<ext>`). EPUB `bookId` hashes `vn-studio:<slug>:<lang>:<lang2>` (single language unchanged), so a reader keeps both books. `dc:language` = `lang` only.
- D5 EPUB markup: an original with a translation is wrapped as `<div class="pair"><p ...original...>...</p><p class="tr" lang="de" xml:lang="de">...</p></div>` (picture book: `class="caption tr"`; title: `<p class="tr title-tr" ...>` right after the `h2.chapter`, inside the pair div). A line without a translation is printed exactly as today, no wrapper. CSS (appended to `style.css` only when `lang2` is set): `div.pair { margin: 0 0 0.9em; page-break-inside: avoid; break-inside: avoid; } div.pair p { margin: 0; } p.tr { font-size: 0.85em; font-style: italic; color: #555; margin-top: 0.2em; } p.title-tr { text-align: center; } div.choices div.pair { margin: 0.5em 0; }`. #555 is e-ink safe. Note: the picture-book caption is already italic in the EPUB (`p.caption`), so there the translation differs by size and colour only; changing it to upright is a one-line CSS change if the user prefers.
- D6 PDF: `themes/parchment/fonts/Lora-Italic.ttf` (SIL OFL, Lora 3.008 static TTF from the Lora Project, same source and version as the existing `Lora-Regular.ttf` "Version 3.008"; `OFL.txt` already covers it). Translation: italic, `#555`, 9.5 pt under 11.5 pt text (10 pt under 12 pt picture-book captions; 12 pt under the 20 pt linear title; 10.5 pt under the 14 pt picture-book title), same alignment as its original. If the file is missing or fails to load: regular Lora in grey, one warning (`Lora-Italic.ttf not found/unreadable: the translation is set upright`), no crash. `pdfFontDir()` still requires only Regular and Bold.
- D7 PDF keep-together: before an original+translation pair, measure both (`heightOfString` with each font and size); if the pair does not fit the rest of the page, fits on an empty page, and the cursor is not already at the top margin, call `doc.addPage()` first (the existing `pageAdded` listener copies the footer). A picture-book page may then spill onto a second page: accepted, no warning.
- D8 German phrases (`de`), since German is the first target: jump `"{text} – lies weiter bei "` + label `"Abschnitt N"` + `"."`; end `"Ende."`; restart `"Lies weiter bei "` + `"Abschnitt 1"` + `", um von vorn zu beginnen."`; section `"Abschnitt"`; start `"Anfang"`; `navWords('de')` = `{ contents: 'Inhalt', cover: 'Titelbild' }`. Written by a model: native review welcome.
- D9 Panel: a select "Second language (under each paragraph)", default "None", listing `[primary, ...editions]` minus the main language; changing the main language to the selected second one resets it to None. The panel's initial `lang` and `lang2` come from `detail.lastExport` when still valid (else primary / None), so `export-last.json` remembers `lang2`.

## Contract (fixed; T2, T3 and T4 start from this text with fresh context)

`src/engine/export/model.ts` (all new fields optional; absent when `lang2` is not set):

```ts
export interface ExportChoice {
  text: string
  toNo: number
  /** lang2 text of this choice; absent = no translation. */
  text2?: string
}
export interface ExportSection {
  // ...existing fields unchanged...
  /** Set only when the book has lang2: same length as `paragraphs`, index i is the lang2 text of paragraphs[i] (same "Name: text" form), null = no translation. */
  paragraphs2?: (string | null)[]
  /** lang2 chapter title; only where `title` is set and lang2 has one. */
  title2?: string
  /** lang2 ending text; only where `ending` is a non-empty string and lang2 has one. */
  ending2?: string
}
export interface ExportBook {
  // ...existing fields unchanged...
  /** The second language printed under the main one. */
  lang2?: Lang
  /** Set with lang2. paired = lines with a translation; unpaired = ids of lines without one: beat ids, "<chapter>:<choiceIdx>", "title <chapter>", "ending <chapter>". */
  pairing?: { paired: number; unpaired: string[] }
}
export interface BuildInput { /* ... */ edition2?: Edition; lang2?: Lang }
export interface ExportOptions { /* ... */ lang2?: Lang }
```

Lines counted in `pairing`: every paragraph, every set `title`, every choice, every non-empty `ending`. `run.ts`: `ExportRunInput.lang2?: Lang`; `ExportRunResult` adds `lang2?: Lang; paired?: number; unpaired?: number` (counts; set only with lang2). `protocol.ts`: `exportBook` command adds `lang2?: Lang`; `ExportResultView` adds the same three optional fields. MCP: `lang2: langSchema.optional()`; the result spreads `ExportRunResult`, so the fields pass through. Renderers read only these fields; they never load an edition.

## Files and modules to touch

| File | Change |
|---|---|
| `src/engine/export/model.ts` | contract types; `buildExportBook` pairing; refusals `lang2 === lang`, RTL `lang2`; `loadExportBook` loads `edition2`, lists editions in "no edition" errors |
| `src/engine/export/validate.ts` | `titleTextOf(book, edition, lang, chapter)` (edition title, else vn.json title for the primary language, else undefined) |
| `src/engine/export/phrases.ts` | `de` table, `phraseLang` returns `'en' \| 'hr' \| 'de'`, `navWords` de |
| `src/engine/export/epub.ts` | pairs markup, CSS addendum, `bookId`, filename |
| `src/engine/export/pdf.ts` | italic font with fallback, pair drawing, keep-together, filename |
| `themes/parchment/fonts/Lora-Italic.ttf` | new binary (OFL) |
| `src/engine/export/run.ts` | `lang2` in, counts out |
| `src/engine/mcp/tools-export.ts` | `lang2` param, one sentence in the description |
| `src/shared/protocol.ts` | `exportBook.lang2`, `ExportResultView` fields |
| `src/engine/vn/service.ts` (`exportBook` case, ~L2161) | pass `lang2: cmd.lang2` |
| `src/renderer/ui/book/BuildTab.tsx` (`ExportSection`) | second-language select, initial state from `lastExport`, result line |
| `tests/export-model.test.ts`, `export-epub.test.ts`, `export-pdf.test.ts`, `export-panel.test.ts` | one test each (below) |
| `docs/mcp-guide.md`, `ROADMAP.md` | lines below |

No change: `sections.ts`, `images.ts`, `export.json` (numbering is language-independent), `scripts/export-probe.ts`, `electron-builder.config.cjs` (verified: `extraResources` ships the whole `themes` folder, so the new TTF is packaged), the game build (`themes/emit.ts` copies theme fonts by name, so the italic file does not enter games), `tests/themes-load.test.ts` (needs only `OFL.txt` next to theme fonts, already there).

## Tasks for workers

Order: T1 first (the contract's producer). T2, T3 and the UI half of T4 can start in parallel from the contract (their tests build `ExportBook` literals); T4's panel test needs T1 merged. T5 last. T6 is in the hub repo, after merge.

### T1 Model, pairing, phrases (`model.ts`, `validate.ts`, `phrases.ts`)
- Inputs: the contract; `model.ts` `paragraphsOf` (L127), `titleOf` (L120), choices (L160), ending (L162), `loadExportBook` (L244).
- Steps:
  1. Add the contract fields. `validate.ts`: `titleTextOf`.
  2. `buildExportBook`: after the main RTL check, if `input.lang2`: throw when `lang2 === lang` (`cannot export "<slug>": the second language must differ from the main one (<lang>)`) or `isRtlLang(lang2)` (same wording as the main RTL error, naming lang2). Refactor `paragraphsOf` to return `{ id, text }[]` internally (same filter and `Name: text` formatting) and a second mapper for `edition2`/`lang2` keyed by beat id (names from `edition2.characterNames`). Fill `paragraphs2`, `title2` (`titleTextOf` with edition2; no fallback warning), `choices[i].text2` (`choiceTextOf` with edition2), `ending2` (`endingTextOf` with edition2, only when the main ending is non-empty). Count into `pairing`; push one warning when `unpaired.length`: `<k> line(s) have no <lang2> text and print without translation: id1, id2, ... (+N more)` (cap 10). Set `book.lang2` and `book.pairing`. `validateStory` is not run on `edition2`.
  3. `loadExportBook`: a helper `noEdition(slug, lang, existing)` builds `project "<slug>" has no <lang> edition (editions: <primary>, <others>)` with `existing = [book.primaryLang, ...await store.editionLangs(slug) without primary]`; use it where the main edition load rethrows today and for `opts.lang2` (load it with the same primary-language fallback to an empty edition). Check `lang2 !== lang` before loading (cheap error first). Pass `edition2`, `lang2`.
  4. `phrases.ts`: D8.
- Output: the contract filled; single-language `ExportBook` deep-equal to today's (existing model tests prove it).
- Test: model test below.

**T1 status: DONE (2026-11-03).** `model.ts`, `validate.ts` (`titleTextOf`), `phrases.ts` (`de`, `phraseLang` -> `'en' | 'hr' | 'de'`, `navWords` de) and the two T1 tests in `tests/export-model.test.ts` (A1 `it`, A2 `it.each` of 2 rows). Verified: `tsc --noEmit` for tsconfig.node.json and tsconfig.web.json clean; eslint on `src/engine/export` + the test file clean; `tests/export-model.test.ts` 9 passed; model+epub+pdf+panel tests 13 passed, unmodified. Deviations: `yarn` is not installed here (not on PATH, not under fnm), so tsc, eslint and vitest were run via `fnm exec --using default node node_modules/...`; the full `yarn test` was not run. `loadExportBook` converts only the `has no <x> edition` error of `store.loadEdition` into the listing message (other read/parse errors still rethrow as before).

### T2 EPUB (`epub.ts`)
- Inputs: the contract only; `buildEpub` section loop (L138-173), `EPUB_CSS` (L40), `bookId` (L67), `writeEpubFile` (L237-241).
- Steps: a helper `pair(originalHtml, tr: string | null | undefined, cls)` that returns the original unchanged when `tr` is empty, else D5's wrapper with `<p class="${cls}" lang="${lang2}" xml:lang="${lang2}">${esc(tr)}</p>`. Apply to paragraphs (`paragraphs2[i]`; `caption tr` in picture books), the title (`title2`, `tr title-tr`), each choice line inside `div.choices` (`text2`; the translation has no link and no phrase), and the ending text (`ending2`). "The End." and restart unchanged. Write `EPUB_CSS + EPUB_TR_CSS` only when `book.lang2`. `bookId` per D4. `writeEpubFile`: pass `lang2` to `loadExportBook`; default name per D4.
- Output: EPUB as D5; unchanged without lang2.
- Test: EPUB test below.

**T2 status: DONE (2026-11-03).** `epub.ts` (`EPUB_TR_CSS`, `pair()` helper, D4 `bookId`/filename) and one A4 `it` in `tests/export-epub.test.ts`. No deviations.

### T3 PDF and font (`pdf.ts`, `themes/parchment/fonts/Lora-Italic.ttf`)
- Inputs: the contract; `buildPdf` (L67-195), `jump()` (L109), `writePdfFile` (L213-217).
- Steps:
  1. Font: download the static `Lora-Italic.ttf` of Lora 3.008 from the Lora Project's GitHub release (the `cyrealtype/Lora-Cyrillic` repo named in `OFL.txt`). Downloading is a user-approved action: ask in chat with the URL and size first. Check with fontkit (`fnm exec --using default node`) that `postscriptName` is `Lora-Italic`, it has no `variationAxes`, and it covers `čćžšđČĆŽŠĐäöüßÄÖÜ„“–`. If only a variable font is available, stop and report (do not ship a variable font).
  2. `buildPdf`: when `book.lang2`, resolve `italic = <dir>/Lora-Italic.ttf`; try `doc.font(italic)` once (then back to regular); on a missing file or a throw use `regular` and push D6's warning. A helper `tr(text, size, align, gapAfter)` sets `doc.font(italic).fontSize(size).fillColor('#555')`, writes with `{ width: WIDTH, align, lineGap: 1.5, paragraphGap: gapAfter }`, then restores regular/`#000`. A helper `keep(hMain, hTr)` implements D7.
  3. Apply: each paragraph with `paragraphs2[i]` (original `paragraphGap: 1`, translation `paragraphGap: 7`); title with `title2`; each choice: `jump()` with `paragraphGap: 1`, then `tr(text2, ..., 8)` (no link, so link counts stay one per choice); ending text with `ending2`. Without a translation every call is today's call with today's options.
  4. `writePdfFile`: pass `lang2`; default name per D4.
- Output: PDF as D6/D7; unchanged without lang2.
- Test: PDF test below.

**T3 status: DONE (2026-11-03).** Font: `Lora-Italic.ttf` from `https://raw.githubusercontent.com/cyrealtype/Lora-Cyrillic/47e378095fb7acd528544983e15e62d0fd58640c/fonts/ttf/Lora-Italic.ttf` (the commit "v 3.008 fixes #64"; no GitHub release ships 3.008, releases are 3.006, 3.011, 3.021), 135500 bytes, sha256 b35d873a...712d; fontkit: postscriptName `Lora-Italic`, "Version 3.008", 0 variation axes, all of `čćžšđČĆŽŠĐäöüßÄÖÜ„“–` present. `pdf.ts` (italic with fallback warning, `tr()`, `keep()`, sizes per step 3, D4 filename) and one A5 `it` in `tests/export-pdf.test.ts`. No deviations.

### T4 Run, MCP, protocol, service, panel
- Inputs: the contract; `run.ts`; `tools-export.ts`; `protocol.ts` L340-355 and L642; `service.ts` L2161-2178; `BuildTab.tsx` `ExportSection` (L56-200).
- Steps: `run.ts` passes `lang2` to the writers and to the dry run, and sets `lang2`, `paired`, `unpaired` from `book.pairing` on both paths. `tools-export.ts`: `lang2: langSchema.optional().describe('A second edition printed under each line, smaller, grey and italic (parallel text). Must differ from lang')` and in the description: `lang2 prints a parallel-text book: each paragraph, caption, choice, title and ending is followed by the lang2 line (smaller, grey, italic); the file is <slug>-<lang>-<lang2>.<ext>; lines missing in lang2 print without translation (one warning)`. Protocol fields per contract. Service passes `lang2: cmd.lang2`; `export-last.json` then keeps it (no other change). Panel per D9: select `data-testid="export-lang2"`, sent as `...(lang2 ? { lang2 } : {})`; the result row shows `langName(r.lang) + ' + ' + langName(r.lang2)` and, when set, `paired N, without translation M` (`data-testid="export-pairing"`).
- Output: the param reaches every path; the panel remembers it.
- Test: panel test below.

**T4 status: DONE (2026-11-03).** `run.ts`, `tools-export.ts`, `protocol.ts`, `service.ts`, `BuildTab.tsx` (D9), A3 lines in `tests/export-panel.test.ts`. Deviation: the test's `de` edition also carries chapter titles, choice texts and endings so that `unpaired` is exactly 1. Panel select not rendered in a test or the app (UNTESTED).

### T5 Docs and roadmap (VN Studio repo)
- `docs/mcp-guide.md`: L228 signature adds `lang2?`; a new bullet after the PDF font bullet (L236): "Bilingual (parallel text). `lang2` prints a second edition under the main one: every paragraph, caption, choice, title and ending is followed by its `lang2` line, smaller, grey and italic (EPUB `p.tr` with its own `lang`; PDF Lora Italic). "Turn to section N", "The End." and the restart line stay in the main language. Lines pair by id; a line missing in `lang2` prints alone and one warning lists the ids. Refused: `lang2` equal to `lang`, right-to-left, or not an edition (the error lists the editions). File `<slug>-<lang>-<lang2>.<ext>`; the dry run reports `lang2`, `paired` and `unpaired`."; the font bullet adds `Lora-Italic.ttf`; the table row L253 becomes `(EPUB, PDF, dry run \`plan\`, parallel text \`lang2\`)`; the gamebook phrase sentence (L230) adds the `de` wording.
- `ROADMAP.md`, under "Done" above VNO-56, when done: `- **VNO-58** (<date>, plan \`.claude/tickets/VNO-58-bilingual-export/plan.md\`, branch \`VNO-58_bilingual-export\`): parallel-text book export: \`vno_export_book {lang2}\` and a "Second language" select in the Export panel print a second edition under each paragraph, caption, choice, title and ending (smaller, grey, italic), EPUB and PDF, all modes; pairs by beat/choice/chapter id, a missing line prints alone with one warning; refuses lang2 = lang, RTL, or a missing edition (listing the editions); file \`<slug>-<lang>-<lang2>.<ext>\`; German gamebook phrases; \`Lora-Italic.ttf\` (OFL) added. Not run: a Kindle. Tests in \`tests/export-*.test.ts\`.`

**T5 status: DONE (2026-11-03).** `docs/mcp-guide.md` (signature, de phrases, Lora-Italic in the font bullet, bilingual bullet, table row) and the `ROADMAP.md` Done line. T6 is not part of this run.

### T6 Hub skill (repo `C:\projects\Personal\creative-hub`, its own `HUB-NN` task, after merge)
- `.claude/skills/make-visual-novel/SKILL.md` step 8 (L146), append: "For a parallel-text book (a language learner's edition), add `lang2` (another existing edition, e.g. `lang: 'de', lang2: 'hr'`): each line is followed by its `lang2` line, smaller, grey and italic; check `unpaired` in the `plan` dry run first."

## Acceptance criteria and the test that proves each

| # | Criterion | Proof |
|---|---|---|
| A1 | Pairing by id, never by position; missing line prints alone; one capped warning; lang2 speaker names | `tests/export-model.test.ts`, new `it`: `makeBook` + a `de` edition2 that lacks `ch2.s1.b1` and has `characterNames: { mara: 'Mara-DE' }`: chapter 2 `paragraphs2` = `[null, 'Mara-DE: Zeile 2.']`, chapter 1 choices have `text2`, `pairing.unpaired` = `['ch2.s1.b1']`, exactly one warning naming it; building without lang2 gives no `paragraphs2`/`pairing` keys |
| A2 | Refuse lang2 = lang and RTL lang2 | same file, one `it.each` table of two rows: `lang2: 'en'` -> /must differ/, `lang2: 'ar'` (edition2 any) -> /right-to-left/ |
| A3 | Refuse a lang2 with no edition, listing the editions; dry run reports lang2/paired/unpaired; last export keeps lang2 and the file name | `tests/export-panel.test.ts`, extend the existing `it`: `store.saveEdition` a `de` edition (one beat left out), `exportBook {format:'plan', lang2:'de'}` -> `result` has `lang2: 'de'`, `paired > 0`, `unpaired: 1`; `exportBook {format:'epub', lang2:'de'}` -> path ends `-en-de.epub`, `detail().lastExport.lang2 === 'de'`; `lang2: 'fr'` -> error matches `/no fr edition \(editions: en, de\)/` (the existing `/no ar edition/` assertion stays) |
| A4 | EPUB: translation markup with its own lang, links unchanged, distinct identifier | `tests/export-epub.test.ts`, new `it`: a `de` main gamebook with `lang2: 'hr'` (one `paragraphs2` entry null, choices with `text2`, an ending with `ending2`) through `open()` (links still resolve): `<p class="tr" lang="hr" xml:lang="hr">` follows its original inside `div.pair`; the null paragraph has no `div.pair`; the "Abschnitt N" link count equals the choice count + restart (translations add none); `style.css` contains `p.tr`; `dc:identifier` differs from the same book without `lang2`; `dc:language` is `de` |
| A5 | PDF: italic font embedded, de and hr glyphs, links unchanged; missing italic falls back without a crash | `tests/export-pdf.test.ts`, new `it`: a bilingual book (`lang: 'de'`, `lang2: 'hr'`, translated paragraphs and choices), `compress: false`: raw bytes match `/\/BaseFont \/[A-Z]{6}\+Lora-Italic/`, link count = choices + restarts, a cmap holds `ß` and `č`; then `buildPdf` with `fontDir` = a temp dir holding only Regular+Bold copies resolves and its `warnings` mention `Lora-Italic.ttf` |
| A6 | Single-language output unchanged | the existing tests in the four files stay green unmodified (except the panel test's added lines) |
| A7 | Picture book and linear pair too; keep-together; looks right on e-ink | live check only (layout is not asserted in CI) |

No other tests: no phrase-table test (A4/A5 use `de` as the main language, which exercises the table), no UI render test, no near-duplicate per mode.

**Verification run (2026-11-03, via `fnm exec --using default node node_modules/...`, yarn is not installed):** typecheck (node + web) clean; `eslint .` clean; four export test files 15/15 passed; full `vitest run` 1147 passed, 1 failed (`tests/vn-pipeline.test.ts` "generate jobs" timed out at 15 s under full-suite load; the file passes alone, 14/14, unrelated to this ticket). Not run: the real dry run on a picture book with de and hr editions (no service started), the live check.

## Verification commands

```
fnm exec --using default yarn typecheck
fnm exec --using default yarn lint
fnm exec --using default yarn vitest run tests/export-model.test.ts tests/export-epub.test.ts tests/export-pdf.test.ts tests/export-panel.test.ts
fnm exec --using default yarn test
```
(Plain `yarn ...` when `node` is on PATH.) Plus the font check of T3 step 1 and a real dry run: `vno_export_book {slug: <a picture book with de and hr editions>, lang: 'de', lang2: 'hr', format: 'plan'}` reports `unpaired` (record it).

## Live check (the user; $0)

1. In the Build tab of a picture book with `de` and `hr` editions: Language German, Second language Croatian, EPUB. The file is `<slug>-de-hr.epub`.
2. Send it to the Kindle (Send to Kindle) and read 3 pages: the Croatian line sits under each German caption, smaller, grey, italic, on the same page; the picture still shows.
3. Optional: the PDF of the same book on any reader (a page may spill onto a second page: accepted).
Record the verdict in the hub run log. UNTESTED until the user has read it.

## Risks

- Kindle may drop the colour or italic of `p.tr` in some modes (size difference remains). Live check.
- Picture-book pages in the PDF can spill onto two pages (D7 accepts it).
- The Lora-Italic static file may not be obtainable at 3.008; T3 stops rather than ship a mismatched or variable font.
- Rollback: one commit; without `lang2` nothing changes.
