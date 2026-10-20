---
kind: languages
languages: []
---
# Languages

The languages a book can be in. The built-in table has 37 (the Supertonic languages of VibeTTS and those of Book Translator); run `vno_languages` or look at the Editions tab to see them. Add a language here, or change a built-in one, by listing it under `languages:` in the frontmatter above.

Each entry:

- `code`: the language code, lowercase, such as `pt-br`. It is the file name of the edition (`editions/pt-br.json`).
- `name`: the English name.
- `native`: the name in the language itself, shown in the game's language picker. Default: `name`.
- `renpy`: the Ren'Py language identifier (lowercase ascii, digits, `_`), the folder `game/tl/<renpy>/`. Default: made from `name`.
- `rtl`: `true` for a right-to-left language (the build sets `config.rtl`; the layout is not mirrored).
- `script`: `latin`, `cyrillic`, `greek`, `arabic`, `hebrew`, `devanagari`, `han`, `kana`, `hangul`, `thai` or `other`. The build warns when the game font has no glyphs for it. Default: `other`.
- `supertonic`: `true` when VibeTTS Supertonic reads it.
- `ui`: the Ren'Py template's menu strings in that language (`Start: Iniciar`). Without it the menus of that language stay in English and the build says so. The strings are the ones in `templates/renpy` (see the Croatian table in `src/shared/languages.ts`).

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
