---
kind: renpy
sdkPath: C:/projects/Local/renpy/renpy-8.5.3-sdk
resolution: 1920x1080
imageFormat: webp
---
# Ren'Py

How the game is built.

- `sdkPath`: the Ren'Py SDK folder (the one with `renpy.exe`). The build uses it to generate the menu images, to create the translation stubs, to run lint, to run the game and to build the Android package. Without it the game scripts are still written, but nothing is translated, linted or run.
- `resolution`: the game's screen size, `<width>x<height>`. The Ren'Py template is made for `1920x1080`; other sizes scale the screen but not the layout.
- `imageFormat`: `webp` or `png`, the format of the backgrounds and sprites copied into the game.

The game theme is chosen per book (Book page, Theme), or picked automatically from the book's format, genre and art style. The Android setup is described in `docs/android.md`.
