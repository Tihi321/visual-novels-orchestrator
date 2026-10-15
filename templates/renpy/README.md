# Ren'Py project template

The base of every generated game: a Ren'Py 8.5 project at 1920x1080, theme-neutral. `buildGame` (`src/engine/renpy/build.ts`) copies `game/` into the book's project folder on every build and then adds the theme, the images, the audio and the scripts.

How it was made: `renpy.exe <sdk>/launcher generate_gui <target> --width 1920 --height 1080 --start --template <sdk>/gui`, then `renpy.exe <target> gui_images` twice (once with `RENPY_VARIANT="small phone"`) to make the button, bar and slider images; `script.rpy` was removed (the build writes it). At build time the same two steps are run again with the theme's accent and background colours, so the menu images match the theme (the images here are the fallback when no SDK is installed).

Changes to the generated files:

- `gui.rpy`: `init offset = -3` (was -2). The theme (`theme.rpy`, written by the build) runs at -2, after `gui.rpy` and before `screens.rpy` (-1), and assigns the `gui.*` values in a python block (a second `define` of the same name is a lint error). Its styles run at +1.
- `options.rpy`: tokens filled in by the build (`{{TITLE}}`, `{{VERSION}}`, `{{BUILD_NAME}}`, `{{SAVE_DIR}}`, `{{HAS_VOICE}}`, `{{LANGUAGES}}`, `{{DEFAULT_LANGUAGE}}`); `config.old_substitutions = False` (so `%` in book text is literal); `vn_voice` (True only when the book has voice clips), `vn_languages` (the languages of the book, the primary one first) and `config.default_language`.
- `screens.rpy`:
  - Preferences: a **Language** section (`Language(code)` buttons), shown only when the book has more than one language; the **Voice Volume** slider only when `vn_voice` is True.
  - A `the_end(message)` screen with "Start again" and "Back to main menu".
  - A `chapter_card(title)` screen shown at the start of each chapter.

Languages: Ren'Py's source language (`None`) holds the primary text. For an English primary book `None` is English and `tl/croatian/` holds the Croatian edition. For a Croatian primary book the template UI is translated by `tl/croatian/ui.rpy` and `config.default_language` is `"croatian"`; an English edition is `tl/english/`.
