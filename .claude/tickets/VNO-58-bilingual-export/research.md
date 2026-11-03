# VNO-58 bilingual export: research notes

(Paths relative to C:/projects/Personal/visual-novels-orchestrator. Read-only; only one fontkit glyph check was run.)

## Question
How does the HUB-25 book export (EPUB/PDF, `vno_export_book`, Build-tab panel) work today, and what must change to print a second language (smaller, grey, italic) under each paragraph, caption and choice of the main language, refusing when the second language has no edition?

## Answer
- Pairing is feasible: editions are keyed by stable ids (beat id, `"<chapter>:<choiceIdx>"`, chapter number), so two editions pair line by line with no new data. But `ExportBook` drops the ids (paragraphs are plain `string[]`, choices `{text,toNo}`), so the model needs parallel second-language fields filled in `buildExportBook`, pairing by beat id (not by position).
- One loader (`loadExportBook`, model.ts) feeds EPUB, PDF and the plan dry run; extending it plus `ExportOptions` / `ExportRunInput` / MCP zod / protocol command / panel covers every path.
- PDF font Lora (Regular + Bold only) covers Latin incl. hr and de, and Cyrillic; not Greek, CJK, Arabic. There is no italic file, so italic needs a new font file (Lora-Italic.ttf, OFL) bundled with `themes/parchment/fonts/`.
- There is no `de` phrase table (only en, hr): a German main edition prints English "turn to section N" plus a warning. Add `de`.
- Next free ticket: **VNO-58** (VNO-57 latest; VNO-55 reserved for fixed-layout picture books).

## Path through the code

### 1. Editions and building ExportBook
- Storage `editions/<lang>.json`: `src/engine/vn/project.ts:171` (`editionLangs`), `:184` (`loadEdition`, throws `project "<slug>" has no <lang> edition`), `:195` save. **confirmed**
- Edition shape `src/shared/vn.ts:216-233`: `title`, `chapterTitles` (chapter no), `choiceTexts` (`"<chapter>:<choiceIndex>"`), `endings` (chapter no), `characterNames`, `beats` (beat id -> text), optional `puzzles`, `sceneTitles`. **confirmed**
- Primary-language text also lives in vn.json; fallbacks apply only when `lang === book.primaryLang`: `src/engine/export/validate.ts:15-30` (`beatTextOf`, `choiceTextOf`, `endingTextOf`). **confirmed**
- `loadExportBook` (`src/engine/export/model.ts`, near the end of the file): lang = `opts.lang ?? book.primaryLang`; a failed edition load is swallowed only for the primary lang (empty edition, text from vn.json); other langs rethrow "has no X edition". **confirmed**
- `buildExportBook` (`model.ts`, ~L100-200): `paragraphsOf` flatMaps scene beats, `.filter(hasText)`, `beatTextOf`, drops beats with empty text (so positions are NOT aligned between editions if a beat is missing: pair by beat id), prefixes `Name: ` using `edition.characterNames[speakerKey] || speakerLabel`. Choices use `choiceTextOf(..., i)`. Endings `endingTextOf`. Titles `titleOf` (falls back to vn.json title with a warning for non-primary). **confirmed**
- Ids are not kept: `ExportSection.paragraphs: string[]`, `choices?: {text,toNo}[]`, `ending?: string`, `title?: string` (`model.ts:~30-52`). Beat ids exist only inside `buildExportBook`. **confirmed**
- Missing line today: `validateStory` (`validate.ts:~46-60`) throws one aggregated error for any beat or choice without text in the edition ("N beat(s) have no text in the X edition (first: id)"). Right for the main language; for the second one the policy is a decision (strict refuse listing ids, or lenient: print no translation and warn). **confirmed (code); policy open**

### 2. Types and renderers
- `ExportBook {slug,title,lang,mode,cover,sections,pages,warnings}`, `mode` = `gamebook | linear | picture-book` (`model.ts:~15-80`); picture book uses `pages`. **confirmed**
- EPUB (`epub.ts`, section loop ~L135-150): paragraphs `<p class="caption">` (picture book) or `<p>`; choices `<p>before<a href=section-NNN.xhtml#sN>label</a>after</p>` in `div.choices`; ending `<p>` then `div.the-end` (gamebook); titles `h2.chapter`, gamebook `h2.section-no`; picture `div.pic`. **confirmed**
- PDF (`pdf.ts`, section loop ~L136-170): gamebook number 46pt bold; linear title 20pt; picture-book title 14pt; paragraphs `doc.text(p, {width, align (center in picture book), lineGap 2, paragraphGap 7})` at 11.5pt (12 picture book); choices through `jump()` (`continued` fragments, `goTo` only on the label); ending text, "The End." 14pt bold, restart jump. **confirmed**
- Phrases `src/engine/export/phrases.ts:30-52`: only `en` and `hr`. en: `"{text} - turn to section N."`, `The End.`, `Turn to section N to start again.`, `section`, `Start`; hr: `"{text}, idi na odlomak N."`, `Kraj.`, `Idi na odlomak N za novi početak.`, `odlomak`, `Početak`. `phraseLang` maps regional codes, unknown -> en; `hasPhrases` drives a warning in `buildExportBook`. `navWords` (end of phrases.ts) is en/hr only (Contents/Cover, Sadržaj/Naslovnica). **confirmed**
- Design point: under a bilingual choice, print the second-language choice text only (no second link phrase) or with the second language's phrase unlinked; the link stays on the main-language label.

### 3. PDF font, layout, overflow
- Font: `themes/parchment/fonts/Lora-Regular.ttf`, `Lora-Bold.ttf`, `OFL.txt`; found by `pdfFontDir()` (`pdf.ts:~44-50`, `VNO_THEMES` or walk up to `themes/`; throws if either TTF is missing). **confirmed**
- Glyph check (fontkit on Lora-Regular via fnm node): hr čćžšđČĆŽŠĐ ok; de äöüßÄÖÜ„“ ok; Cyrillic ok; — … ’ ok; Greek only partly (missing ειά), CJK, Arabic missing. No guard exists today for uncovered scripts in the single-language export either. **confirmed**
- No italic file; pdfkit does not synthesise italic for a custom TTF; the built-in Helvetica-Oblique lacks č ć đ. So add `Lora-Italic.ttf` (inferred; not tested) and either make it optional or extend the `pdfFontDir` check. Packaging of `themes/` into resources not checked (electron-builder.config.cjs not read).
- Layout: A5 419.53x595.28, margins 48/56/42/42 (`pdf.ts:~60`). Each section `doc.addPage()`, then number/title, picture (fit height 210; 300 in picture book), paragraphs, choices, ending. No overflow handling: pdfkit auto-adds pages past the bottom margin; the `pageAdded` listener (`pdf.ts:~85`) copies the section footer to overflow pages. The existing test makes section 1 run over several pages (`tests/export-pdf.test.ts:~31-44`). A picture-book page (300pt picture + caption + translation) can spill onto a second page, breaking "one page per scene". **confirmed (code)**
- Footers are drawn after layout on buffered pages (`pdf.ts:~178-190`).

### 4. EPUB
- CSS: inline const `EPUB_CSS` in `epub.ts:~36-52`, written to `OEBPS/style.css`. Add a class rule (e.g. `.tr { font-size: .85em; font-style: italic; color: #666 }`). **confirmed**
- Language: `xhtml()` helper sets `lang` and `xml:lang` on `<html>`; `<dc:language>` and the package `xml:lang` use `book.lang`. Proposal (inferred): `<p class="tr" lang="hr" xml:lang="hr">...</p>` inside the main document; dc:language stays the main one (optionally a second `<dc:language>`). Use `esc()`.
- `bookId` = sha1 of `vn-studio:<slug>:<lang>` (`epub.ts:~68`): a bilingual file of the same main lang would share the identifier with the single-language one; add lang2 to the hash input. **confirmed**
- Output name: `store.file(slug,'export', slug-lang.epub)` at the end of `writeEpubFile`, same in `writePdfFile`; bilingual needs a distinct name (e.g. `<slug>-de-hr.epub`) or it overwrites. `out` overrides. **confirmed**

### 5. Tool and panel
- `src/engine/mcp/tools-export.ts:~12-32`: params `slug, lang?, format ('epub'|'pdf'|'plan'), order?, seed?, renumber?, out?, grayscale?`; returns `{path?, format, mode, lang, sections, pictures, bytes?, warnings, sectionMap?}` (no bytes; `stale` stripped). Tool description and `docs/mcp-guide.md:226-235` (+ table row at :253) need the new param. **confirmed**
- `runBookExport` `src/engine/export/run.ts` (`ExportRunInput`, `ExportRunResult`): shared by MCP and the UI command. **confirmed**
- UI command `exportBook`: `src/shared/protocol.ts:642` (type), command lists at `:744` and `:802`, `ExportResultView` at `:340`; handler `src/engine/vn/service.ts:2161-2178` writes `export-last.json` (epub/pdf only) and emits `export.result`; `engine.ts:894` routes; `service.ts:575` loads `lastExport` for the project detail (`protocol.ts:304`). **confirmed**
- Panel: `src/renderer/ui/book/BuildTab.tsx:56-190` (`ExportSection`). Language select from `[primary, ...detail.summary.editions without primary]` (L61-62), `run()` calls `sendCommand` (L72); "last export" = live `exp.result` else `detail.lastExport` (L75). testids `export-lang`, `export-epub`, `export-pdf`, `export-plan`, `export-path`, `export-warnings`. A "Second language" select (None + other editions) fits next to Language (L82-92); add `lang2` to the command, `ExportResultView`, so the last export shows both. **confirmed**

### 6. Tests and commands
- `tests/export-model.test.ts` (golden numbering vector, section map, broken story, warnings), `export-epub.test.ts` (zip structure, links/images resolve, picture book), `export-pdf.test.ts` (raw bytes with `compress:false`, regex for `/Subtype /Link`, named destinations, hr glyphs via embedded font cmap), `export-panel.test.ts` (`exportBook` command: dry run, writes EPUB, error). No golden files: structural assertions on `ExportBook` literals and temp dirs with a sharp-made PNG. **confirmed**
- Commands (`package.json:15-17`): `yarn test` (vitest run; one file: `yarn vitest run tests/export-epub.test.ts`), `yarn typecheck` (tsc node + web), `yarn lint` (eslint .). `node` was not on PATH in this Bash; use `fnm exec --using default yarn ...`. Not run. **confirmed (scripts)**
- Probe: `scripts/export-probe.ts` (per docs).

### 7. Ticket conventions
- Tickets in `.claude/tickets/VNO-NN-<kebab-name>/plan.md`; branches `VNO-NN_<kebab_name>` (e.g. `VNO-56_export-panel`); commits `VNO-NN: ...`; ROADMAP.md bullet per ticket under "Where it stands" (VNO-56 at ROADMAP.md:26). **confirmed**
- Latest: VNO-57 (master HEAD 84b72ce). VNO-55 has no folder or branch: "reserved for fixed-layout picture books" (`.claude/tickets/VNO-56-export-panel/plan.md:3`; HUB-25 plan: "VNO-55 only if triggered"). No VNO-58 anywhere (grep). **Next free: VNO-58.** Suggested branch `VNO-58_bilingual-export`.

### 8. Guards to extend
- RTL: `buildExportBook` throws when `isRtlLang(lang)` (`model.ts:~101`; `src/engine/game/rtl.ts:45`). Apply to the second language too (refuse; or support `dir="rtl"` later).
- Missing second edition: today a non-primary lang throws "has no X edition". Requirement: refuse AND list existing languages, using `store.editionLangs(slug)` (project.ts:171) plus the primary lang (it has text in vn.json even without a file). Do it in `loadExportBook` before building. Also refuse `lang2 === lang`. (new code, inferred)
- `hasPhrases` warning: main lang only.
- `validateStory` strictness for the second edition; `titleOf` fallback for the second-language title.
- Cover title is main language only. Section map `export.json` is language-independent: no change.

## Reproduction
Not a bug; nothing to reproduce.

## What the plan needs
Files: `src/engine/export/model.ts` (types, build, loader, options), `validate.ts`, `phrases.ts` (add `de`, `navWords`), `epub.ts` (markup, CSS, bookId, filename), `pdf.ts` (italic font, layout, filename, font check), `run.ts`, `src/engine/mcp/tools-export.ts` + `docs/mcp-guide.md`, `src/shared/protocol.ts`, `src/engine/vn/service.ts`, `src/renderer/ui/book/BuildTab.tsx`, `themes/parchment/fonts/Lora-Italic.ttf`, `ROADMAP.md`. Tests: model (pairing by id, missing second edition refusal lists langs, missing line policy, RTL second), EPUB (`lang="hr"` + class, distinct id), PDF (italic font embedded, hr glyphs), panel command with `lang2`. Suggested model shape: optional parallel fields (`paragraphsAlt?: (string|undefined)[]` same length as `paragraphs`, `choices[].alt?`, `endingAlt?`, `titleAlt?`, `ExportBook.lang2?`); output must stay identical when `lang2` is unset.

## Risks
- PDF overflow (no keep-together; picture-book page may spill); consider smaller image height in bilingual mode.
- Italic font not bundled; packaging must ship it; `pdfFontDir` throws if a file is missing.
- Kindle may ignore colour/italic in some modes; use CSS classes. Not verified on a device (like the rest of the export).
- EPUB identifier and filename collisions with the single-language export.
- Partial second edition policy; speaker names must come from the second edition's `characterNames`.
- Shared code used by MCP, UI, probe script and four test files: keep new options optional.
- VNO-57 recently touched the renderer; check BuildTab merges cleanly.

## Open questions
1. Second edition with missing lines: refuse (list ids) or print without translation and warn?
2. Add `de` phrases (user supplied only the hr wording)? Bilingual filename pattern?
3. Main language free choice among editions (code supports it)?
4. May the second language be the primary (text only in vn.json)? Code allows it; the refusal list should then include it.
5. Refuse RTL second languages for now (recommended)?
6. Does `themes/parchment/fonts` ship in the packaged app (electron-builder.config.cjs not read)?
