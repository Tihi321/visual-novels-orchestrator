import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import type { ToolResult } from '../src/engine/mcp/tools'
import { checkPuzzleText, generatePuzzle, packagesDirOf, renderPuzzleText, solvePuzzle } from '../src/engine/puzzles/python'
import type { PuzzlePython } from '../src/engine/puzzles/python'
import { DEFAULT_SDK_PATH, sdkPython } from '../src/engine/renpy/run'
import { puzzleCoreSchema, puzzleGeneratedSchema } from '../src/shared/puzzle'
import type { PuzzleGenerated, ReadBackClue } from '../src/shared/puzzle'
import { makeVnEnv } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

/**
 * The Python bridge and the `vno_puzzle_*` tools, with the SDK's real Python. Skipped when the SDK is not there.
 */

const sdkPath = process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH
const py: PuzzlePython = { sdkPath, packagesDir: packagesDirOf(path.resolve(__dirname, '..', 'templates', 'renpy')) }

const faithful = (p: PuzzleGenerated): ReadBackClue[] =>
  p.clues.map((c) => ({ id: c.id, type: c.type, a: p.names[c.a]!, b: Array.isArray(c.b) ? c.b.map((x) => p.names[x]!) : p.names[c.b]! }))

describe.skipIf(!sdkPython(sdkPath))('the Python bridge (contract)', () => {
  it('generate answers with a shape the zod schema reads, and one call takes under 2 s', async () => {
    const t0 = Date.now()
    const p = await generatePuzzle(py, { kind: 'murdle', size: 3, band: 'hard', seed: 11 })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(() => puzzleGeneratedSchema.parse(p)).not.toThrow()
    expect(p).toMatchObject({ seed: 11, band: 'hard', format: 1 })
    expect(Object.keys(p.text)).toEqual(expect.arrayContaining(['murder', ...p.clues.map((c) => c.id)]))
    const again = await generatePuzzle(py, { kind: 'murdle', size: 3, band: 'hard', seed: 11 })
    expect(again).toEqual(p)
  })

  it('solve proves a puzzle and refuses a broken one with the reason', async () => {
    const { names: _n, text: _t, ...core } = await generatePuzzle(py, { kind: 'murdle', size: 3, band: 'medium', seed: 5 })
    const proof = await solvePuzzle(py, puzzleCoreSchema.parse(core))
    expect(proof).toMatchObject({ unique: true, solutions: 1, deducible: true, band: 'medium' })
    expect(proof.steps).toHaveLength(27)
    const loose = { ...puzzleCoreSchema.parse(core), clues: core.clues.slice(0, 1) }
    expect(await solvePuzzle(py, loose)).toMatchObject({ unique: false, deducible: false, band: null })
    await expect(solvePuzzle(py, { ...puzzleCoreSchema.parse(core), clues: [{ id: 'c1', type: 'is', a: 's1', b: 'zz' }] })).rejects.toThrow(/unknown item zz/)
  })

  it('render-text writes the canonical sentences for new names', async () => {
    const { names, text, ...core } = await generatePuzzle(py, { kind: 'murdle', size: 3, band: 'easy', seed: 2 })
    const r = await renderPuzzleText(py, puzzleCoreSchema.parse(core), { ...names, s1: 'Anna' })
    expect(r.names.s1).toBe('Anna')
    expect(Object.keys(r.text)).toEqual(Object.keys(text))
    expect(Object.values(r.text).join(' ')).not.toContain(names.s1!)
  })

  it('check-text passes a faithful read-back and catches a changed clue, a swapped name and a lost either option', async () => {
    const p = await (async () => {
      for (let seed = 1; seed < 60; seed++) {
        const q = await generatePuzzle(py, { kind: 'murdle', size: 3, band: 'medium', seed })
        if (q.clues.some((c) => c.type === 'either')) return q
      }
      throw new Error('no puzzle with an either clue')
    })()
    const { text, ...rest } = p
    const rb = faithful(p)
    expect(await checkPuzzleText(py, rest, rb, text)).toEqual({ ok: true, problems: [], differing: [] })
    // a paraphrase read back the same way passes (the check is on meaning, not on words)
    expect((await checkPuzzleText(py, rest, rb, Object.fromEntries(Object.entries(text).map(([k, v]) => [k, `So they say: ${v}`])))).ok).toBe(true)
    const flip = rb.map((c, i) => (i === 0 ? { ...c, type: c.type === 'not' ? ('is' as const) : ('not' as const), b: Array.isArray(c.b) ? c.b[0]! : c.b } : c))
    const flipped = await checkPuzzleText(py, rest, flip, text)
    expect(flipped.ok).toBe(false)
    expect(flipped.differing).toEqual([p.clues[0]!.id])
    const i = p.clues.findIndex((c) => c.type === 'either')
    const lost = rb.map((c, k) => (k === i ? { ...c, b: (c.b as string[])[0]! } : c))
    expect((await checkPuzzleText(py, rest, lost, text)).problems[0]!.problem).toMatch(/either/)
    const swapped = rb.map((c, k) => (k === 0 ? { ...c, a: Object.values(p.names).find((n) => n !== c.a && !([] as string[]).concat(c.b).includes(n))! } : c))
    expect((await checkPuzzleText(py, rest, swapped, text)).ok).toBe(false)
    expect((await checkPuzzleText(py, rest, rb.slice(1), text)).problems[0]!.problem).toMatch(/gave no clue/)
  })

  it('without the SDK the bridge says what to set', async () => {
    await expect(generatePuzzle({ ...py, sdkPath: path.join(__dirname, 'no-sdk-here') }, { kind: 'murdle', size: 3, band: 'easy', seed: 1 })).rejects.toThrow(/need the Ren'Py SDK.*sdkPath in config\/renpy.md/)
  })
})

describe.skipIf(!sdkPython(sdkPath))('the vno_puzzle_* tools', () => {
  let env: VnEnv
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Data = Record<string, any>
  const tools = () => buildTools(env.engine.vn)
  const call = async (name: string, args: object): Promise<Data> => {
    const r: ToolResult = await callTool(tools(), name, args)
    if (r.isError) throw new Error(r.content[0]?.text)
    return r.structuredContent as Data
  }
  const fails = async (name: string, args: object): Promise<string> => {
    const r = await callTool(tools(), name, args)
    expect(r.isError, `${name} should fail`).toBe(true)
    return r.content[0]!.text
  }

  beforeEach(async () => {
    env = await makeVnEnv({ sdk: undefined })
  })
  afterEach(async () => {
    await env.cleanup()
  })

  const make = async (): Promise<string> => {
    const r = await call('vno_create_project', {
      book: {
        title: 'The Cold Dinner',
        characters: [{ name: 'Hartley', looks: 'a tired detective' }],
        places: [{ name: 'Manor', looks: 'a dark dining room' }],
        chapters: [
          {
            title: 'The Body',
            scenes: [
              { place: 'manor', beats: [{ cast: ['hartley'] }, { text: 'The dinner went cold.' }] },
              { place: 'manor', beats: [{ text: 'It was over.' }] }
            ]
          }
        ]
      }
    })
    return r.slug as string
  }

  it('vno_puzzle_generate returns the core and canonical text in under 2 s and saves nothing', async () => {
    const t0 = Date.now()
    const g = await call('vno_puzzle_generate', { band: 'medium', seed: 3 })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(g).toMatchObject({ seed: 3, band: 'medium' })
    expect(puzzleCoreSchema.parse(g.core)).toMatchObject({ format: 1, kind: 'murdle', size: 3, seed: 3 })
    expect(Object.keys(g.names)).toHaveLength(9)
    expect(g.text.murder).toMatch(/^The body was found in the /)
    expect((await call('vno_puzzle_generate', { band: 'medium', seed: 3 })).core).toEqual(g.core)
  })

  it('a puzzle beat between two scenes, vno_puzzle_set with generate, a check that passes, and a refused puzzle', async () => {
    const slug = await make()
    await call('vno_beat_add', { slug, sceneId: 'ch01.s01', beats: [{ puzzle: 'dinner' }], at: 2 })
    const set = await call('vno_puzzle_set', { slug, key: 'dinner', generate: { band: 'medium', seed: 21 }, clueAt: {} })
    expect(set.verified).toMatchObject({ unique: true, deducible: true, textChecked: true, by: 'vno_puzzles 1.0' })
    expect(set.next).toMatch(/vno_build/)
    const got = await call('vno_puzzle_get', { slug, key: 'dinner' })
    expect(got.verified.textChecked).toBe(true)
    expect(got.readBackTask).toContain('Read these clues of a logic puzzle')
    expect(got.readBackTask).not.toMatch(/"type": "is"\s*,\s*"a": "s1"/) // the reader never sees the structured clues
    expect(JSON.stringify(got.readBackTask)).not.toContain('"solution"')
    const book = (await env.engine.vn.store.loadBook(slug)).puzzles![0]!
    const rb = book.data.clues.map((c) => ({ id: c.id, type: c.type, a: book.names[c.a], b: Array.isArray(c.b) ? c.b.map((x) => book.names[x]) : book.names[c.b] }))
    // prose written by hand is not trusted until it is read back
    const rewritten = Object.fromEntries(book.data.clues.map((c) => [c.id, `Note ${c.id}: ${book.text[c.id]}`]))
    const set2 = await call('vno_puzzle_set', { slug, key: 'dinner', text: rewritten })
    expect(set2.verified.textChecked).toBe(false)
    const bad = rb.map((c, i) => (i === 0 ? { ...c, type: c.type === 'not' ? 'is' : 'not', b: Array.isArray(c.b) ? c.b[0] : c.b } : c))
    const failed = await call('vno_puzzle_check_text', { slug, key: 'dinner', readBack: bad })
    expect(failed.ok).toBe(false)
    expect(failed.differing).toEqual([book.data.clues[0]!.id])
    const passed = await call('vno_puzzle_check_text', { slug, key: 'dinner', readBack: rb })
    expect(passed).toMatchObject({ ok: true, textChecked: true })
    expect((await env.engine.vn.store.loadBook(slug)).puzzles![0]!.verified.textChecked).toBe(true)
    // a core that is not unique is refused
    const g = await call('vno_puzzle_generate', { band: 'easy', seed: 4 })
    const loose = { ...g.core, clues: g.core.clues.slice(0, 1) }
    expect(await fails('vno_puzzle_set', { slug, key: 'loose', data: loose, names: g.names, text: g.text })).toMatch(/solutions, not one/)
  })

  it('renaming items with canonical text gives new canonical sentences; the edition words are checked with lang', async () => {
    const slug = await make()
    await call('vno_beat_add', { slug, sceneId: 'ch01.s02', beats: [{ puzzle: 'dinner' }], at: 0 })
    await call('vno_puzzle_set', { slug, key: 'dinner', generate: { band: 'easy', seed: 8 } })
    const before = (await env.engine.vn.store.loadBook(slug)).puzzles![0]!
    const r = await call('vno_puzzle_set', { slug, key: 'dinner', names: { s1: 'Zorana' } })
    const after = (await env.engine.vn.store.loadBook(slug)).puzzles![0]!
    expect(after.names.s1).toBe('Zorana')
    expect(Object.values(after.text).join(' ')).not.toContain(before.names.s1!)
    expect(r.verified.textChecked).toBe(true)
    // an edition: words for names and clues, checked with the read-back of that language
    const hrNames = Object.fromEntries(Object.entries(after.names).map(([k, v]) => [k, `${v} HR`]))
    const hrText = Object.fromEntries(Object.entries(after.text).map(([k, v]) => [k, Object.entries(after.names).reduce((t, [item, name]) => t.split(name).join(hrNames[item]!), v) + ' (hr)']))
    await call('vno_edition_set', { slug, lang: 'hr', puzzles: { dinner: { names: hrNames, text: hrText } } })
    const rb = after.data.clues.map((c) => ({ id: c.id, type: c.type, a: hrNames[c.a], b: Array.isArray(c.b) ? c.b.map((x) => hrNames[x]) : hrNames[c.b] }))
    const ok = await call('vno_puzzle_check_text', { slug, key: 'dinner', lang: 'hr', readBack: rb })
    expect(ok).toMatchObject({ ok: true, lang: 'hr' })
    const hr = await call('vno_puzzle_get', { slug, key: 'dinner', lang: 'hr' })
    expect(hr.text.c1).toContain('(hr)')
    expect(await fails('vno_edition_set', { slug, lang: 'hr', puzzles: { nope: { names: {} } } })).toMatch(/no puzzle nope/)
    expect(await fails('vno_edition_set', { slug, lang: 'hr', puzzles: { dinner: { text: { c99: 'x' } } } })).toMatch(/no clue of puzzle dinner c99/)
  })

  it('vno_puzzle_remove is refused while a beat plays the puzzle', async () => {
    const slug = await make()
    await call('vno_beat_add', { slug, sceneId: 'ch01.s02', beats: [{ puzzle: 'dinner' }], at: 0 })
    await call('vno_puzzle_set', { slug, key: 'dinner', generate: { band: 'easy', seed: 9 } })
    expect(await fails('vno_puzzle_remove', { slug, key: 'dinner' })).toMatch(/played by beat/)
    await call('vno_puzzle_remove', { slug, key: 'dinner', force: true })
    expect((await env.engine.vn.store.loadBook(slug)).puzzles).toBeUndefined()
  })
})
