import { describe, expect, it } from 'vitest'
import { emitScripts } from '../src/engine/renpy/emit'
import { defaultCues } from '../src/engine/renpy/stage'
import { buildStringTable, fillStub, newReport, stubLineMap, uiStrings, type FillContext } from '../src/engine/renpy/tl'
import { loadBook, loadEdition } from './fixtures/vn/load'

// What `renpy translate croatian` writes for ch01.rpy of the linear fixture (real output, shortened).
const STUB = `\uFEFF# TODO: Translation updated at 2026-10-15 14:44

# game/ch01.rpy:14
translate croatian ch_01_0665218d:

    # "The sea was calm. {i}Too{/i} calm, thought Mara."
    "The sea was calm. {i}Too{/i} calm, thought Mara."

# game/ch01.rpy:16
translate croatian ch_01_a153b07d:

    # mara "Is that light [[still] on? It is {{not} 100% safe."
    mara "Is that light [[still] on? It is {{not} 100% safe."

# game/ch01.rpy:99
translate croatian ch_01_deadbeef:

    # tomo "So many of you!"
    tomo "So many of you!"

# game/ch01.rpy:98
translate croatian ch_01_unknown:

    # tomo "A line nobody emitted"
    tomo "A line nobody emitted"

translate croatian strings:

    # game/ch01.rpy:6
    old "The Harbour"
    new "The Harbour"

    # renpy/common/00gui.rpy:1
    old "Start"
    new "Start"

    # game/ch01.rpy:7
    old "Not in any table"
    new "Not in any table"
`

function ctxFor(over: Partial<FillContext> = {}): { ctx: FillContext; emitted: ReturnType<typeof emitScripts> } {
  const book = loadBook('linear')
  const hr = loadEdition('linear', 'hr')
  const emitted = emitScripts({ book, editions: [loadEdition('linear', 'en')], cues: defaultCues(book) })
  const byStatement = new Map(emitted.lineMap.map((e) => [e.source, e.beatId]))
  const ctx: FillContext = {
    language: 'croatian',
    lang: 'hr',
    lineMap: stubLineMap(emitted.lineMap),
    byStatement,
    beatText: (id) => hr.beats[id],
    strings: buildStringTable(book, {}, hr),
    ...over
  }
  return { ctx, emitted }
}

describe('fillStub', () => {
  it('maps a stub to its beat by file:line and writes the escaped edition text', () => {
    const { ctx, emitted } = ctxFor()
    // The first two stubs' lines in the stub text are the real ones; find the actual lines.
    const l1 = emitted.lineMap.find((e) => e.beatId === 'ch01.s01.b002')!.line
    const l2 = emitted.lineMap.find((e) => e.beatId === 'ch01.s01.b003')!.line
    const stub = STUB.replace('ch01.rpy:14', `ch01.rpy:${l1}`).replace('ch01.rpy:16', `ch01.rpy:${l2}`)
    const report = newReport()
    const out = fillStub(stub, ctx, report)
    expect(out).toContain('    # "The sea was calm. {i}Too{/i} calm, thought Mara."\n    "More je bilo mirno. {i}Previše{/i} mirno, pomisli Mara."')
    expect(out).toContain('    mara "Je li ono svjetlo [[još] upaljeno? Nije {{baš} 100% sigurno."')
    expect(report.saysFilled).toBeGreaterThanOrEqual(2)
  })

  it('falls back to the original statement when the line is not in the map', () => {
    const { ctx } = ctxFor()
    const report = newReport()
    const out = fillStub(STUB, ctx, report) // ch01.rpy:99 is not a real line, but `tomo "So many of you!"` is unique
    expect(out).toContain('    tomo "Koliko vas je!"')
  })

  it('reports a stub it cannot map and leaves it as it is', () => {
    const { ctx } = ctxFor()
    const report = newReport()
    const out = fillStub(STUB, ctx, report)
    expect(report.unmatched).toEqual(['ch01.rpy:98 ch_01_unknown'])
    expect(out).toContain('    tomo "A line nobody emitted"')
  })

  it('keeps the source text and reports a beat the edition has no text for', () => {
    const { ctx, emitted } = ctxFor({ beatText: () => undefined })
    const l = emitted.lineMap.find((e) => e.beatId === 'ch01.s01.b002')!.line
    const report = newReport()
    const out = fillStub(STUB.replace('ch01.rpy:14', `ch01.rpy:${l}`), ctx, report)
    expect(out).toContain('    "The sea was calm. {i}Too{/i} calm, thought Mara."')
    expect(report.missingBeats).toContain('ch01.s01.b002')
  })

  it('fills the strings block from the edition and the UI table, and leaves the rest', () => {
    const { ctx } = ctxFor()
    const report = newReport()
    const out = fillStub(STUB, ctx, report)
    expect(out).toContain('    old "The Harbour"\n    new "Luka"')
    expect(out).toContain('    old "Start"\n    new "Započni"')
    expect(out).toContain('    old "Not in any table"\n    new "Not in any table"')
    expect(report.stringsKept).toEqual(['Not in any table'])
  })

  it('does not write a voice statement when voice is off', () => {
    const { ctx } = ctxFor()
    expect(fillStub(STUB, ctx, newReport())).not.toMatch(/voice/)
  })

  it('voice on: the stub block starts at the voice line and holds the source clip; the edition clip replaces it', () => {
    const voice = {
      has: (lang: string, id: string): string | null => (lang === 'hr' ? (id === 'ch01.s01.b002' ? 'C:/c/hr.ogg' : null) : 'C:/c/en.ogg')
    }
    const book = loadBook('linear')
    const hr = loadEdition('linear', 'hr')
    const emitted = emitScripts({ book, editions: [], cues: defaultCues(book), voice: voice as FillContext['voice'] })
    const ctx: FillContext = {
      language: 'croatian',
      lang: 'hr',
      lineMap: stubLineMap(emitted.lineMap),
      byStatement: new Map(),
      beatText: (id) => hr.beats[id],
      voice: voice as FillContext['voice'],
      strings: new Map()
    }
    const e1 = emitted.lineMap.find((e) => e.beatId === 'ch01.s01.b002')!
    const e2 = emitted.lineMap.find((e) => e.beatId === 'ch01.s01.b003')!
    expect(e1.stubLine).toBe(e1.line - 1)
    const stub = [
      `# game/ch01.rpy:${e1.stubLine}`,
      'translate croatian ch_01_a:',
      '',
      '    # voice "voice/en/ch01.s01.b002.ogg"',
      '    # "The sea was calm. {i}Too{/i} calm, thought Mara."',
      '    voice "voice/en/ch01.s01.b002.ogg"',
      '    "The sea was calm. {i}Too{/i} calm, thought Mara."',
      '',
      `# game/ch01.rpy:${e2.stubLine}`,
      'translate croatian ch_01_b:',
      '',
      '    # voice "voice/en/ch01.s01.b003.ogg"',
      '    # mara "Is that light [[still] on? It is {{not} 100% safe."',
      '    voice "voice/en/ch01.s01.b003.ogg"',
      '    mara "Is that light [[still] on? It is {{not} 100% safe."',
      ''
    ].join('\n')
    const report = newReport()
    const out = fillStub(stub, ctx, report)
    expect(report.unmatched).toEqual([])
    expect(out).toContain('    voice "voice/hr/ch01.s01.b002.ogg"\n    "More je bilo mirno.')
    // no Croatian clip for b003: the English clip is gone with the block, nothing plays
    expect(out).toContain('    # mara "Is that light [[still] on? It is {{not} 100% safe."\n    mara "Je li ono')
    expect(out).not.toContain('voice/en/')
    expect(out).not.toContain('_voice')
  })

  it('keeps a stub file that has no BOM or CRLF problems', () => {
    const { ctx } = ctxFor()
    const out = fillStub(STUB.replace(/\n/g, '\r\n'), ctx, newReport())
    expect(out.includes('\r')).toBe(false)
    expect(out.charCodeAt(0)).not.toBe(0xfeff)
  })
})

describe('buildStringTable', () => {
  it('has the titles, choices, endings, names and the UI strings', () => {
    const book = loadBook('choice')
    const hr = loadEdition('choice', 'hr')
    const missing: string[] = []
    const t = buildStringTable(book, {}, hr, missing)
    expect(t.get('Two Streets')).toBe('Dvije ulice')
    expect(t.get('Go down River Street')).toBe('Idi Riječnom ulicom')
    expect(t.get('The Crossroads')).toBe('Raskrižje')
    expect(t.get('Petra ate warm bread, and everyone was happy.')).toContain('Petra je jela')
    expect(t.get('The End')).toBe('Kraj')
    expect(missing).toEqual([])
  })

  it('reports what the edition does not have', () => {
    const book = loadBook('choice')
    const hr = { ...loadEdition('choice', 'hr'), endings: {}, choiceTexts: {} }
    const missing: string[] = []
    buildStringTable(book, {}, hr, missing)
    expect(missing).toEqual(expect.arrayContaining(['chapter 1 choice 0', 'chapter 2 ending']))
  })

  it('the UI table covers the strings the template adds', () => {
    const hr = uiStrings('hr')!
    for (const k of ['Language', 'The End', 'Start again', 'Back to main menu']) expect(hr[k]).toBeTruthy()
  })
})
