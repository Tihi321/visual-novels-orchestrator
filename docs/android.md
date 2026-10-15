# Android builds

VN Studio builds the Android package with the Ren'Py launcher's own `android_build` command (RAPT, the Ren'Py Android packager). Nothing in the engine builds an APK by itself, and the first build needs a one-time setup that only the Ren'Py launcher can do.

## The command

Verified in the SDK 8.5.3 launcher source (`launcher/game/android.rpy`, `android_build_command`):

```
renpy.exe <sdk>/launcher android_build <project> [--bundle] [--install] [--launch] [--destination <dir>] [--package <name>]
```

- `<project>`: the Ren'Py project folder, the one that contains `game/` (`projects/<slug>/game` in the data folder).
- `--destination` (or `--dest`): the folder the `.apk` / `.aab` is copied to.
- `--bundle`: an Android App Bundle (`.aab`, for Google Play). Without it you get a universal APK (for sideloading).
- `--install`, `--launch`: install on a connected device and start the app (`--launch` implies `--install`).

`androidBuild(gameDir, { sdkPath, destination })` in `src/engine/renpy/android.ts` runs it after `androidPreflight`, which checks the setup below and returns what is missing.

## One-time setup

1. **JDK 21.** Install a JDK 21 (Microsoft OpenJDK 21, Temurin 21). Set `JAVA_HOME` or put `java` on the `PATH`. (`java -version` must say 21.)
2. **RAPT.** The Ren'Py SDK ships a `rapt` folder only after the launcher installs it. Open the launcher once (`renpy.exe` in the SDK folder), choose a project, go to **Android**, and use **Install SDK**. This downloads the Android SDK (about 1 GB) into `<sdk>/rapt/Sdk`. If the launcher says RAPT is missing, download it from the Ren'Py site and unzip it into the SDK folder, then restart the launcher.
3. **Signing keys.** In the launcher, with the book's project selected, **Android -> Generate Keys**. This writes `android.keystore` and `bundle.keystore` into the project folder. Back them up: an app cannot be updated without its key. (To reuse keys, copy both files into the project folder.) A rebuild of the game keeps them, because the build only regenerates the `game/` folder inside the project, not its root.
4. **Configure.** In the launcher, **Android -> Configure** sets the package name (`com.yourname.book`), the display name, the version and the orientation, and writes `.android.json` in the project folder. `androidConfigure()` writes a minimal one from code if you only need the command line.
5. Choose the package type in the launcher once (Play Bundle or Universal APK) or pass `--bundle` on the command line.

## Build

Build the game first (`buildGame`), then run `androidBuild`. The package files land in the destination folder.

## Notes for the game

- The template adds a touch-friendly layout through the standard Ren'Py `small` / `touch` variants; the themes scale the text for phones.
- Voice and music files are plain assets, so they are in the package. Packages can hold up to 2 GB of data.
- The project's `config.save_directory` is `vno-<slug>`, so saves of the desktop and the Android builds do not clash with other games.
