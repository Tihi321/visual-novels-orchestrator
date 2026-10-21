---
kind: languages
languages: []
---
# Languages

The languages a book can be in. The built-in table has 37 (the Supertonic languages of VibeTTS and those of Book Translator), with menu strings for all but English; run `vno_languages` or look at the Editions tab to see them. Add a language here, or change a built-in one, by listing it under `languages:` in the frontmatter above. An entry for a built-in code is merged into the built-in one (only the fields you give change).

Each entry:

- `code`: the language code, lowercase, such as `pt-br`. It is the file name of the edition (`editions/pt-br.json`).
- `name`: the English name.
- `native`: the name in the language itself, shown in the game's language picker. Default: `name`.
- `renpy`: the Ren'Py language identifier (lowercase ascii, digits, `_`), the folder `game/tl/<renpy>/`. Default: made from `name`.
- `rtl`: `true` for a right-to-left language (the build sets `config.rtl` and mirrors the menu layout for it).
- `script`: `latin`, `cyrillic`, `greek`, `arabic`, `hebrew`, `devanagari`, `han`, `kana`, `hangul`, `thai` or `other`. The build checks that the theme's text font has glyphs for it and picks a font when it has not (see `font`). Default: `other`.
- `supertonic`: `true` when VibeTTS Supertonic reads it.
- `ui`: the Ren'Py template's menu strings in that language (`Start: Iniciar`). Every built-in language has a table already (`src/shared/ui-strings.ts`, 49 strings), so `ui` here only overrides single strings: it is merged key by key into the built-in table. A language you add that has no `ui` keeps English menus and the build says so. The built-in tables were written by a language model, not by native speakers: fix a string here when you see a bad one, and send a fix back if you like.
- `font`, `fontBold`: a font file with the glyphs of the language, used for its text when the theme font lacks them. An absolute path, or a file name in the `fonts` folder of the data folder (`<data>/fonts/`). A `.ttc` collection works. Without `font` the build looks for `<data>/fonts/<script>.ttf` (or `.otf`, `.ttc`), then an installed system font of that script, then DejaVuSans for Cyrillic, Greek, Arabic and Hebrew. `vno_fonts_fetch {script}` downloads a free Noto font for Chinese (`han`), Japanese (`kana`), Korean (`hangul`), `devanagari` and `thai` into that folder.

An added language is not detected automatically: give its code when you import a book or add an edition.

Example, Brazilian Portuguese with a few menu strings:

```yaml
languages:
  - code: pt-br
    name: Brazilian Portuguese
    native: Português (Brasil)
    renpy: brazilian_portuguese
    script: latin
    supertonic: true
    ui:
      Start: Iniciar
      Load: Carregar
      Save: Salvar
      Preferences: Preferências
      Quit: Sair
```

Changes are read when the engine starts and when a language is checked (import, add edition, new project).
