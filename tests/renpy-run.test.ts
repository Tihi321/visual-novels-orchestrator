import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { androidBuildArgs, androidConfigure, androidPreflight } from '../src/engine/renpy/android'
import { parseLint, renpyExe } from '../src/engine/renpy/run'

const REPORT_OK = `\uFEFFRen'Py 8.5.3.26051504 lint report, generated at: Thu Oct 15 14:44:47 2026


Statistics:

The game contains 9 dialogue blocks, containing 46 words and 236 characters,
for an average of 5.1 words and 26 characters per block.

Lint is not a substitute for thorough testing.
`

const REPORT_BAD = `\uFEFFRen'Py 8.5.3.26051504 lint report, generated at: Thu Oct 15 14:44:06 2026

game/ch01.rpy:12 The image 'bg nowhere' is not known.

game/theme.rpy:6 define gui.accent_color already defined at game/gui.rpy:28


Statistics:

The game contains 1 dialogue blocks.
`

describe('parseLint', () => {
  it('a clean report has no messages and keeps the statistics', () => {
    const r = parseLint(REPORT_OK)
    expect(r.messages).toEqual([])
    expect(r.statistics).toContain('9 dialogue blocks')
  })

  it('problems are the lines between the header and the statistics', () => {
    const r = parseLint(REPORT_BAD)
    expect(r.messages).toEqual(["game/ch01.rpy:12 The image 'bg nowhere' is not known.", 'game/theme.rpy:6 define gui.accent_color already defined at game/gui.rpy:28'])
  })
})

describe('android', () => {
  it('the build command line (verified against launcher/game/android.rpy of SDK 8.5.3)', () => {
    const args = androidBuildArgs('C:/sdk', 'C:/p/game', { destination: 'C:/out', bundle: true })
    expect(args).toEqual([path.join('C:/sdk', 'launcher'), 'android_build', 'C:/p/game', '--bundle', '--destination', 'C:/out'])
    expect(androidBuildArgs('C:/sdk', 'C:/p/game', { destination: 'C:/out' })).not.toContain('--bundle')
    expect(renpyExe('C:/sdk')).toMatch(/renpy\.(exe|sh)$/)
  })

  it('the preflight tells what is missing, with the action to take', () => {
    const sdk = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-sdk-'))
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-proj-'))
    try {
      fs.writeFileSync(path.join(sdk, process.platform === 'win32' ? 'renpy.exe' : 'renpy.sh'), '')
      const r = androidPreflight(proj, { sdkPath: sdk, java: { found: false } })
      expect(r.ok).toBe(false)
      const text = r.problems.join('\n')
      expect(text).toContain('RAPT')
      expect(text).toContain('JDK 21')
      expect(text).toContain('Generate Keys')
      expect(text).toContain('.android.json')

      fs.mkdirSync(path.join(sdk, 'rapt', 'Sdk', 'platform-tools'), { recursive: true })
      fs.writeFileSync(path.join(sdk, 'rapt', 'Sdk', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'), '')
      fs.writeFileSync(path.join(proj, 'android.keystore'), '')
      fs.writeFileSync(path.join(proj, 'bundle.keystore'), '')
      androidConfigure(proj, { name: 'Book', package: 'com.example.book' })
      const ok = androidPreflight(proj, { sdkPath: sdk, java: { found: true, major: 21, raw: 'openjdk version "21.0.1"' } })
      expect(ok.problems).toEqual([])
      expect(ok.ok).toBe(true)

      const old = androidPreflight(proj, { sdkPath: sdk, java: { found: true, major: 17, raw: 'openjdk version "17"' } })
      expect(old.problems.join('\n')).toContain('needs JDK 21')
    } finally {
      fs.rmSync(sdk, { recursive: true, force: true })
      fs.rmSync(proj, { recursive: true, force: true })
    }
  })

  it('a missing SDK is reported first', () => {
    const r = androidPreflight('C:/nowhere', { sdkPath: 'C:/definitely/not/here' })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toContain('sdkPath')
  })
})
