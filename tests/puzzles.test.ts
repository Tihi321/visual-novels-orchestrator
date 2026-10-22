import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SDK_PATH, runSdkPython, sdkExists, sdkPython } from '../src/engine/renpy/run'

/**
 * The puzzle library (templates/puzzles): its Python tests under the SDK's own Python, the CLI contract, and the proof of concept game
 * checked. The proof of concept game is linted in renpy-integration.test.ts. Skipped when the SDK is not there.
 */

const sdkPath = process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH
const root = path.resolve(__dirname, '..')
const pkg = path.join(root, 'templates', 'puzzles', 'game', 'python-packages', 'vno_puzzles', 'cli.py')

describe('sdkPython', () => {
  it('is null for a folder with no SDK', () => {
    expect(sdkPython(path.join(root, '.claude', 'temp', 'no-such-sdk'))).toBeNull()
  })

  it('refuses to run without a Python', async () => {
    await expect(runSdkPython(path.join(root, '.claude', 'temp', 'no-such-sdk'), ['-V'])).rejects.toThrow(/no Python/)
  })
})

describe.skipIf(!sdkPython(sdkPath))('the puzzle library under the SDK Python', () => {
  it('passes its Python tests (every puzzle of every kind: unique, deducible, minimal, in its band)', { timeout: 600_000 }, async () => {
    const dir = path.join(root, 'tests', 'puzzles')
    const files = fs.readdirSync(dir).filter((f) => /^test_.*\.py$/.test(f)).sort()
    expect(files).toContain('test_vno_puzzles.py')
    for (const f of files) {
      const r = await runSdkPython(sdkPath, [path.join(dir, f)], { cwd: root, timeoutMs: 600_000 })
      expect(r.code, `${f}\n${r.stdout}\n${r.stderr}`).toBe(0)
      expect(r.stdout).toMatch(/\d+ test\(s\), 0 failed/)
    }
  })

  it('the CLI makes a puzzle as JSON, solves it and checks an accusation (the shape the engine will read)', { timeout: 60_000 }, async () => {
    const made = await runSdkPython(sdkPath, [pkg, 'generate', '--seed', '7', '--band', 'hard'], { cwd: root, timeoutMs: 30_000 })
    expect(made.code, made.stderr).toBe(0)
    const p = JSON.parse(made.stdout) as Record<string, unknown> & { categories: { key: string; items: string[] }[]; clues: { id: string; type: string }[]; murder: { answer: Record<string, string> } }
    expect(p).toMatchObject({ format: 1, kind: 'murdle', size: 3, seed: 7, band: 'hard' })
    expect(p.categories.map((c) => c.key)).toEqual(['suspect', 'weapon', 'place'])
    expect(p.clues.length).toBeGreaterThan(3)
    for (const key of ['solution', 'murder', 'difficulty', 'steps', 'names', 'text']) expect(p, key).toHaveProperty(key)
    const solved = await runSdkPython(sdkPath, [pkg, 'solve'], { cwd: root, input: made.stdout, timeoutMs: 30_000 })
    expect(JSON.parse(solved.stdout)).toMatchObject({ unique: true, deducible: true, band: 'hard' })
    const checked = await runSdkPython(sdkPath, [pkg, 'check'], { cwd: root, input: JSON.stringify({ puzzle: p, accusation: p.murder.answer }), timeoutMs: 30_000 })
    expect(JSON.parse(checked.stdout).accusation).toEqual({ correct: true, wrong: [] })
  })
})

describe.skipIf(!sdkExists(sdkPath))('the game base', () => {
  it('a normal build has no puzzle files (the game base is unchanged)', () => {
    const base = path.join(root, 'templates', 'renpy', 'game')
    expect(fs.existsSync(path.join(base, 'python-packages'))).toBe(false)
    expect(fs.readdirSync(base).some((f) => /puzzle/i.test(f))).toBe(false)
  })
})
