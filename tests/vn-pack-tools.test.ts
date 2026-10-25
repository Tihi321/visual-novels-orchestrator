import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTools } from '../src/engine/mcp/tools'
import type { Tool } from '../src/engine/mcp/tools'
import { INSTRUCTIONS } from '../src/engine/mcp/server'
import { importPackBook } from '../src/engine/vn/pack'
import { UI_STRINGS } from '../src/shared/ui-strings'
import { BUILTIN_LANGUAGES } from '../src/shared/languages'

const tools = buildTools({} as never)
const tool = (name: string): Tool => {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`no tool ${name}`)
  return t
}
const shape = (name: string): Record<string, unknown> => (tool(name).schema as unknown as { shape: Record<string, unknown> }).shape

const canonicalMystery = path.join(__dirname, 'fixtures', 'books', 'canonical-mystery-puzzle')

describe('MCP tools for packs', () => {
  it('the server instructions describe the web engine and packs', () => {
    expect(INSTRUCTIONS).not.toMatch(/Ren'Py visual novels/)
    expect(INSTRUCTIONS).toContain('HTML5 web visual novels')
    expect(INSTRUCTIONS).toContain('vn/pack.json')
    expect(INSTRUCTIONS).toContain('vno_sync_editions')
    expect(tool('vno_import').description).toContain('vn/pack.json')
    expect(tool('vno_add_edition').description).toContain('vn-text catalogue')
    expect(tool('vno_build').description).toContain('HTML5 web game')
    expect(tool('vno_lint').description).toContain('editions/<primary>.json')
  })

  it('exposes the pack edition options and vno_sync_editions', () => {
    expect(Object.keys(shape('vno_add_edition'))).toEqual(expect.arrayContaining(['force', 'source', 'lang']))
    const sync = tool('vno_sync_editions')
    expect(Object.keys(shape('vno_sync_editions'))).toEqual(expect.arrayContaining(['slug', 'source']))
    // the puzzle prose read-back already takes an edition language
    expect(Object.keys(shape('vno_puzzle_check_text'))).toEqual(expect.arrayContaining(['lang']))
    expect(tool('vno_puzzle_check_text').description).toMatch(/edition's words/)
    expect(sync.description).toMatch(/vn\/text\/\*\.json/)
  })

  it('the docs and README describe the pack workflow', async () => {
    const docs = [path.join(__dirname, '..', 'README.md'), path.join(__dirname, '..', 'docs', 'mcp-guide.md'), path.join(__dirname, '..', 'docs', 'protocol.md')]
    for (const file of docs) {
      const text = await readFile(file, 'utf8')
      expect(text, file).toMatch(/vn\/pack\.json/)
      expect(text, file).toContain('vno_sync_editions')
    }
    const readme = await readFile(docs[0]!, 'utf8')
    expect(readme).not.toMatch(/builds a Ren'Py game/)
  })
})

describe('Croatian runtime strings and pack puzzle words', () => {
  it('has the five runtime keys in Croatian, and keeps the 49 core keys of every other language', () => {
    const hr = UI_STRINGS.hr!
    expect(hr.Clues).toBe('Tragovi')
    expect(hr.Accuse).toBe('Optuži')
    expect(hr.Submit).toBe('Pošalji')
    expect(hr.Hint).toBe('Natuknica')
    expect(hr['Give Up']).toBe('Odustani')
    const core = Object.keys(hr).slice(0, 49)
    for (const l of BUILTIN_LANGUAGES.filter((x) => x.code !== 'en' && x.code !== 'hr')) expect(Object.keys(l.ui!), l.code).toEqual(core)
  })

  it('reads a pack puzzle core into the primary edition, with its catalogue words', async () => {
    const pack = await importPackBook(canonicalMystery)
    const puzzle = pack.book.puzzles?.find((p) => p.key === 'dinner')
    expect(puzzle).toMatchObject({ key: 'dinner', kind: 'murdle', verified: { unique: true, deducible: true, textChecked: true } })
    expect(puzzle?.clueAt).toEqual({ c1: 'ch01.s01.b003', c2: 'ch01.s01.b004', c3: 'ch01.s01.b005', c4: 'ch01.s01.b006' })
    expect(pack.edition.puzzles?.dinner?.names.s1).toBe('Colonel Ash')
    expect(pack.edition.puzzles?.dinner?.text.c1).toMatch(/^The rope was in Colonel Ash's hands/)
    // the core is language-free; the words are only in the catalogue/edition
    expect(JSON.stringify(puzzle?.data)).not.toContain('rope')
    expect(JSON.stringify(puzzle?.data)).not.toContain('Colonel Ash')
  })
})
