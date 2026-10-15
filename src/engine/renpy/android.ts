import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SDK_PATH, runRenpy, sdkExists } from './run'

/**
 * Android builds through the Ren'Py launcher's own command (verified in `launcher/game/android.rpy` of SDK 8.5.3):
 *
 *   renpy.exe <sdk>/launcher android_build <project> [--bundle] [--install] [--launch] [--destination <dir>] [--package <name>]
 *
 * (`<project>` is the Ren'Py project folder, the one that contains `game/`; `--destination` / `--dest` is where the
 * .apk or .aab is copied to.) `androidPreflight` checks the one-time setup first and says what is missing.
 * See docs/android.md for the setup.
 */

export interface AndroidPreflight {
  ok: boolean
  /** What is missing, each with the action to take. */
  problems: string[]
  /** Things that were found (for the log). */
  found: string[]
}

export interface JavaInfo {
  found: boolean
  /** Major version (21), when it could be read. */
  major?: number
  raw?: string
}

/** The JDK on JAVA_HOME or the PATH. Ren'Py 8.5's RAPT needs JDK 21. */
export function detectJava(): JavaInfo {
  const exe = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8', windowsHide: true })
  if (r.error || r.status === null) return { found: false }
  const text = `${r.stderr}${r.stdout}`
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text)
  if (!m) return { found: true, raw: text.trim().split('\n')[0] }
  const major = m[1] === '1' && m[2] ? Number(m[2]) : Number(m[1])
  return { found: true, major, raw: text.trim().split('\n')[0] }
}

export function androidPreflight(gameDir: string, opts: { sdkPath?: string; java?: JavaInfo } = {}): AndroidPreflight {
  const sdkPath = opts.sdkPath ?? DEFAULT_SDK_PATH
  const problems: string[] = []
  const found: string[] = []

  if (!sdkExists(sdkPath)) {
    problems.push(`The Ren'Py SDK was not found at ${sdkPath}. Set sdkPath in config/renpy.md.`)
    return { ok: false, problems, found }
  }
  found.push(`Ren'Py SDK: ${sdkPath}`)

  const rapt = path.join(sdkPath, 'rapt')
  if (!fs.existsSync(rapt)) {
    problems.push(
      `RAPT (the Android packager) is not installed: ${rapt} does not exist. Open the Ren'Py launcher once (${path.join(sdkPath, 'renpy.exe')}), choose any project, Android, and follow "Install SDK"; if the launcher says RAPT is missing, download it from https://www.renpy.org/latest.html and unzip it into the SDK folder.`
    )
  } else {
    found.push(`RAPT: ${rapt}`)
    const adb = path.join(rapt, 'Sdk', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (!fs.existsSync(adb)) problems.push(`The Android SDK is not installed (no ${adb}). In the Ren'Py launcher: Android -> Install SDK (it downloads the Android SDK, about 1 GB).`)
    else found.push('Android SDK: installed')
  }

  const java = opts.java ?? detectJava()
  if (!java.found) problems.push('No JDK found. Install JDK 21 (for example Microsoft OpenJDK 21 or Temurin 21) and set JAVA_HOME or put java on the PATH.')
  else if (java.major !== undefined && java.major < 21) problems.push(`JDK ${java.major} found (${java.raw}); the Ren'Py 8.5 Android build needs JDK 21.`)
  else found.push(`JDK: ${java.raw ?? 'found'}`)

  const keys = ['android.keystore', 'bundle.keystore']
  const missingKeys = keys.filter((k) => !fs.existsSync(path.join(gameDir, k)))
  if (missingKeys.length) {
    problems.push(
      `Signing keys are missing from the project folder (${missingKeys.join(', ')} in ${gameDir}). In the Ren'Py launcher: select this project, Android -> Generate Keys (once); or copy the keystores you already use into the project folder. Keep them safe: an app cannot be updated without its key.`
    )
  } else found.push('signing keys: present')

  if (!fs.existsSync(path.join(gameDir, '.android.json')) && !fs.existsSync(path.join(gameDir, 'android.json'))) {
    problems.push(`The project has no Android configuration (.android.json). Use androidConfigure() or the launcher's Android -> Configure.`)
  } else found.push('android configuration: present')

  return { ok: problems.length === 0, problems, found }
}

/**
 * Write a minimal `.android.json` (package name, display name, version, landscape). The launcher's Configure
 * writes the full file; this is enough for the command-line build.
 */
export function androidConfigure(gameDir: string, cfg: { name: string; package: string; version?: string; numericVersion?: number; orientation?: string }): string {
  const file = path.join(gameDir, '.android.json')
  const existing = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) : {}
  const data = {
    ...existing,
    name: cfg.name,
    package: cfg.package,
    version: cfg.version ?? '1.0',
    numeric_version: cfg.numericVersion ?? 1,
    orientation: cfg.orientation ?? 'sensorLandscape',
    permissions: existing.permissions ?? ['VIBRATE', 'INTERNET']
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return file
}

export interface AndroidBuildOptions {
  sdkPath?: string
  /** Where the .apk / .aab is copied to. */
  destination: string
  /** Build an app bundle (.aab, for Google Play) instead of a universal APK. */
  bundle?: boolean
  install?: boolean
  launch?: boolean
}

export interface AndroidBuildResult {
  ok: boolean
  /** Setup problems (the build did not start) or the failure reason. */
  problems: string[]
  output: string
  /** The package files found in the destination after the build. */
  files: string[]
}

/** The command line (after the executable) of the build, for logs and tests. */
export function androidBuildArgs(sdkPath: string, gameDir: string, opts: AndroidBuildOptions): string[] {
  return [
    path.join(sdkPath, 'launcher'),
    'android_build',
    gameDir,
    ...(opts.bundle ? ['--bundle'] : []),
    ...(opts.install ? ['--install'] : []),
    ...(opts.launch ? ['--launch'] : []),
    '--destination',
    opts.destination
  ]
}

export async function androidBuild(gameDir: string, opts: AndroidBuildOptions): Promise<AndroidBuildResult> {
  const sdkPath = opts.sdkPath ?? DEFAULT_SDK_PATH
  const pre = androidPreflight(gameDir, { sdkPath })
  if (!pre.ok) return { ok: false, problems: pre.problems, output: '', files: [] }

  fs.mkdirSync(opts.destination, { recursive: true })
  const r = await runRenpy(sdkPath, androidBuildArgs(sdkPath, gameDir, opts), { timeoutMs: 60 * 60 * 1000 })
  const output = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`
  const files = fs.existsSync(opts.destination) ? fs.readdirSync(opts.destination).filter((f) => /\.(apk|aab)$/i.test(f)).map((f) => path.join(opts.destination, f)) : []
  const ok = r.code === 0 && !r.timedOut
  return { ok, problems: ok ? [] : [r.timedOut ? 'the Android build timed out' : `android_build exited with code ${r.code}`], output, files }
}
