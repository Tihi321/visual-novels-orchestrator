import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEJAVU_SCRIPTS, languageFonts, renpyFontSpec, resolveLanguageFont, themeTextScripts } from '../src/engine/renpy/fonts'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import { FETCH_SCRIPTS, FONT_SOURCES, fetchFont } from '../src/engine/mcp/tools-lang'
import { defaultThemesDir, loadTheme } from '../src/engine/themes/load'
import { registerLanguages, resetLanguages } from '../src/shared/languages'
import { makeVnEnv } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let root: string
let fontsDir: string
let winDir: string
const touch = (...parts: string[]): string => {
  const f = path.join(...parts)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, 'font')
  return f
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-fonts-'))
  fontsDir = path.join(root, 'data', 'fonts')
  winDir = path.join(root, 'win', 'Fonts')
})
afterEach(() => {
  resetLanguages()
  fs.rmSync(root, { recursive: true, force: true })
})

const win = (): { fontsDir: string; platform: NodeJS.Platform; windowsFontsDir: string } => ({ fontsDir, platform: 'win32', windowsFontsDir: winDir })
const ja = { code: 'ja', font: undefined, fontBold: undefined }

describe('resolveLanguageFont', () => {
  it('prefers the config font, then a data-folder font, then a system font, then DejaVu', () => {
    touch(winDir, 'YuGothM.ttc')
    touch(winDir, 'YuGothB.ttc')
    // 3. system
    expect(resolveLanguageFont(ja, 'kana', win())).toMatchObject({ source: 'system', regular: { file: path.join(winDir, 'YuGothM.ttc'), index: 0 }, bold: { file: path.join(winDir, 'YuGothB.ttc'), index: 0 } })
    // 2. data folder beats system
    const mine = touch(fontsDir, 'kana.otf')
    expect(resolveLanguageFont(ja, 'kana', win())).toMatchObject({ source: 'data', regular: { file: mine }, bold: null })
    touch(fontsDir, 'kana-bold.ttf')
    expect(resolveLanguageFont(ja, 'kana', win())?.bold).toEqual({ file: path.join(fontsDir, 'kana-bold.ttf') })
    // 1. config beats data: a file name in the fonts folder, or an absolute path
    const named = touch(fontsDir, 'MyJa.ttf')
    expect(resolveLanguageFont({ ...ja, font: 'MyJa.ttf' }, 'kana', win())).toMatchObject({ source: 'config', regular: { file: named } })
    const abs = touch(root, 'elsewhere', 'Abs.ttf')
    const absBold = touch(root, 'elsewhere', 'AbsB.ttf')
    expect(resolveLanguageFont({ ...ja, font: abs, fontBold: absBold }, 'kana', win())).toMatchObject({ source: 'config', regular: { file: abs }, bold: { file: absBold } })
    // a config font that is not there is skipped
    expect(resolveLanguageFont({ ...ja, font: 'missing.ttf' }, 'kana', win())?.source).toBe('data')
    // 4. DejaVu for the scripts it covers
    expect(resolveLanguageFont({ code: 'ru' }, 'cyrillic', { fontsDir: path.join(root, 'none'), platform: 'win32', windowsFontsDir: winDir })).toEqual({ regular: { file: 'DejaVuSans.ttf' }, bold: { file: 'DejaVuSans-Bold.ttf' }, source: 'dejavu' })
  })

  it('has no font for a script nothing covers', () => {
    expect(resolveLanguageFont(ja, 'kana', { fontsDir, platform: 'linux', exists: () => false })).toBeNull()
    expect(resolveLanguageFont({ code: 'th' }, 'thai', { fontsDir, platform: 'darwin', exists: () => false })).toBeNull()
    expect(DEJAVU_SCRIPTS).not.toContain('han')
  })

  it('knows the system fonts of each platform', () => {
    const noto = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
    const only = (f: string) => (p: string) => p === f
    expect(resolveLanguageFont({ code: 'zh' }, 'han', { platform: 'linux', exists: only(noto) })?.regular).toEqual({ file: noto, index: 2 })
    expect(resolveLanguageFont({ code: 'ko' }, 'hangul', { platform: 'linux', exists: only(noto) })?.regular).toEqual({ file: noto, index: 1 })
    expect(resolveLanguageFont({ code: 'zh' }, 'han', { platform: 'darwin', exists: only('/System/Library/Fonts/PingFang.ttc') })?.source).toBe('system')
  })

  it('writes a collection face the way Ren’Py reads it', () => {
    expect(renpyFontSpec('fonts/lang/msyh.ttc', 0)).toBe('0@fonts/lang/msyh.ttc')
    expect(renpyFontSpec('fonts/lang/x.ttf', undefined)).toBe('fonts/lang/x.ttf')
  })
})

describe('the font of a theme', () => {
  it('reads the scripts from the theme files, and defaults to DejaVu’s or Latin only', () => {
    const scripts = (name: string): readonly string[] => themeTextScripts(loadTheme(path.join(defaultThemesDir(), name)).theme)
    expect(scripts('classic-dark')).toEqual(['latin', 'cyrillic', 'greek', 'arabic', 'hebrew'])
    expect(scripts('parchment')).toEqual(['latin', 'cyrillic'])
    expect(scripts('storybook')).toEqual(['latin'])
    expect(scripts('noir')).toEqual(['latin'])
    expect(scripts('pixel-retro')).toEqual(['latin', 'cyrillic', 'greek'])
    expect(themeTextScripts({ fonts: { text: 'DejaVuSans.ttf' } })).toEqual(DEJAVU_SCRIPTS)
    expect(themeTextScripts({ fonts: { text: 'Other.ttf' } })).toEqual(['latin'])
  })
})

describe('languageFonts', () => {
  const lora = { fonts: { text: 'Lora-Regular.ttf', scripts: ['latin', 'cyrillic'] as ('latin' | 'cyrillic')[] } }
  const quicksand = { fonts: { text: 'Quicksand-Medium.ttf', scripts: ['latin'] as 'latin'[] } }
  let sub: string
  beforeEach(() => {
    sub = path.join(root, 'game', 'game')
    fs.mkdirSync(sub, { recursive: true })
  })

  it('a theme font that covers the script writes no block', () => {
    const r = languageFonts({ gameSubdir: sub, langs: ['en', 'hr', 'ru'], theme: lora, probe: win() })
    expect(r.rpy).toBeNull()
    expect(r.warnings).toEqual([])
  })

  it('a theme font without the script gets DejaVu for Russian, by name and without a copy', () => {
    const r = languageFonts({ gameSubdir: sub, langs: ['en', 'ru'], theme: quicksand, probe: win() })
    expect(r.used).toEqual({ ru: 'dejavu' })
    expect(r.rpy).toContain('translate russian python:')
    expect(r.rpy).toContain('    gui.text_font = "DejaVuSans.ttf"')
    expect(r.rpy).toContain('    gui.choice_button_text_font = "DejaVuSans.ttf"')
    expect(r.rpy).toContain('config.font_replacement_map["DejaVuSans.ttf", True, False] = ("DejaVuSans-Bold.ttf", False, False)')
    expect(fs.existsSync(path.join(sub, 'fonts', 'lang'))).toBe(false)
    expect(r.warnings).toEqual([])
  })

  it('copies a system collection with the index syntax and warns about its license', () => {
    touch(winDir, 'msyh.ttc')
    touch(winDir, 'msyhbd.ttc')
    const r = languageFonts({ gameSubdir: sub, langs: ['en', 'zh'], theme: quicksand, probe: win() })
    expect(r.rpy).toContain('translate chinese python:')
    expect(r.rpy).toContain('    gui.text_font = "0@fonts/lang/msyh.ttc"')
    expect(r.rpy).toContain('config.font_replacement_map["0@fonts/lang/msyh.ttc", True, False] = ("0@fonts/lang/msyhbd.ttc", False, False)')
    expect(fs.existsSync(path.join(sub, 'fonts', 'lang', 'msyh.ttc'))).toBe(true)
    expect(fs.existsSync(path.join(sub, 'fonts', 'lang', 'msyhbd.ttc'))).toBe(true)
    expect(r.warnings).toEqual(['copied the system font msyh.ttc for Chinese: fine to play, check its license before you share the game (vno_fonts_fetch gets a free Noto font)'])
  })

  it('a font you put in the data folder is used without a license warning, and two languages share one copy', () => {
    touch(fontsDir, 'han.otf')
    const r = languageFonts({ gameSubdir: sub, langs: ['zh'], theme: quicksand, probe: win() })
    expect(r.used).toEqual({ zh: 'data' })
    expect(r.warnings).toEqual([])
    registerLanguages([{ code: 'yue', name: 'Cantonese', script: 'han' }])
    const two = languageFonts({ gameSubdir: sub, langs: ['zh', 'yue'], theme: quicksand, probe: win() })
    expect(fs.readdirSync(path.join(sub, 'fonts', 'lang'))).toEqual(['han.otf'])
    expect(two.rpy).toContain('translate cantonese python:')
  })

  it('a language with no font gets the warning that says what to do', () => {
    const r = languageFonts({ gameSubdir: sub, langs: ['en', 'ja'], theme: quicksand, probe: { fontsDir, platform: 'linux', exists: () => false } })
    expect(r.rpy).toBeNull()
    expect(r.warnings).toEqual(['no font with kana glyphs for Japanese: set font for ja in config/languages.md, put a font in <data>/fonts/, or run vno_fonts_fetch {script: kana}'])
  })

  it('a language that sets font itself uses it even when the theme font covers the script', () => {
    const mine = touch(fontsDir, 'Fancy.ttf')
    registerLanguages([{ code: 'ru', name: 'Russian', font: 'Fancy.ttf' }])
    const r = languageFonts({ gameSubdir: sub, langs: ['ru'], theme: lora, probe: win() })
    expect(r.used).toEqual({ ru: 'config' })
    expect(r.rpy).toContain('"fonts/lang/Fancy.ttf"')
    expect(fs.readFileSync(path.join(sub, 'fonts', 'lang', 'Fancy.ttf'), 'utf8')).toBe(fs.readFileSync(mine, 'utf8'))
  })
})

describe('vno_fonts_fetch', () => {
  it('has a source for each script, and the ones that were checked by hand', () => {
    expect(Object.keys(FONT_SOURCES).sort()).toEqual([...FETCH_SCRIPTS].sort())
    for (const s of Object.values(FONT_SOURCES)) {
      expect(s.font).toMatch(/^https:\/\/github\.com\/notofonts\//)
      expect(s.license).toMatch(/^https:\/\/github\.com\/notofonts\//)
    }
  })

  const fakeFetch = (seen: string[]): typeof fetch =>
    (async (url: string) => {
      seen.push(String(url))
      return new Response(Buffer.from(String(url).endsWith('.txt') || String(url).endsWith('LICENSE') ? 'license text' : 'FONTBYTES'), { status: 200 })
    }) as unknown as typeof fetch

  it('writes the font and its license into the fonts folder, keeps an existing file, and force downloads again', async () => {
    const seen: string[] = []
    const r = await fetchFont(fontsDir, 'thai', { fetchImpl: fakeFetch(seen) })
    expect(r).toMatchObject({ script: 'thai', family: 'Noto Sans Thai', skipped: false, bytes: 9 })
    expect(fs.readFileSync(path.join(fontsDir, 'thai.ttf'), 'utf8')).toBe('FONTBYTES')
    expect(fs.readFileSync(path.join(fontsDir, 'thai-OFL.txt'), 'utf8')).toBe('license text')
    expect(seen).toHaveLength(2)
    const again = await fetchFont(fontsDir, 'thai', { fetchImpl: fakeFetch(seen) })
    expect(again.skipped).toBe(true)
    expect(seen).toHaveLength(2)
    expect((await fetchFont(fontsDir, 'thai', { fetchImpl: fakeFetch(seen), force: true })).skipped).toBe(false)
    expect(seen).toHaveLength(4)
    expect(fs.readdirSync(fontsDir).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('fails with the URL on a bad answer and leaves nothing behind', async () => {
    const bad = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(fetchFont(fontsDir, 'hangul', { fetchImpl: bad })).rejects.toThrow(/NotoSansCJKkr-Regular\.otf: HTTP 404/)
    expect(fs.existsSync(path.join(fontsDir, 'hangul.otf'))).toBe(false)
  })

  describe('as an MCP tool', () => {
    let env: VnEnv
    beforeEach(async () => {
      env = await makeVnEnv({ sdk: false })
    })
    afterEach(async () => {
      await env.cleanup()
    })
    it('downloads into <data>/fonts with the injected fetch, and refuses an unknown script', async () => {
      const seen: string[] = []
      const tools = buildTools(env.engine.vn, { fetchImpl: fakeFetch(seen) })
      const ok = await callTool(tools, 'vno_fonts_fetch', { script: 'devanagari' })
      expect(ok.isError).toBeFalsy()
      expect(ok.structuredContent).toMatchObject({ script: 'devanagari', skipped: false, font: path.join(env.dir, 'fonts', 'devanagari.ttf') })
      expect(fs.readFileSync(path.join(env.dir, 'fonts', 'devanagari.ttf'), 'utf8')).toBe('FONTBYTES')
      const bad = await callTool(tools, 'vno_fonts_fetch', { script: 'latin' })
      expect(bad.isError).toBe(true)
    })
  })
})
