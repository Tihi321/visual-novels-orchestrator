import path from 'node:path'
import { z } from 'zod'
import { puzzleGeneratedSchema, puzzleProofSchema } from '../../shared/puzzle'
import type { PuzzleCore, PuzzleGenerated, PuzzleProof, ReadBackClue } from '../../shared/puzzle'
import { runSdkPython, sdkPython } from '../renpy/run'

/**
 * The puzzle library runs in Python (the same files the game uses): the engine starts the SDK's own Python for a short call with JSON in and
 * JSON out, like it runs `renpy lint`. Nothing is installed: the SDK ships Python 3.12.
 */

export const PUZZLES_VERSION = 'vno_puzzles 1.0'

export interface PuzzlePython {
  /** The Ren'Py SDK folder (`config/renpy.md`). */
  sdkPath: string
  /** `templates/puzzles/game/python-packages`. */
  packagesDir: string
  timeoutMs?: number
}

/** `templates/puzzles/game/python-packages` next to the Ren'Py template folder. */
export const packagesDirOf = (templatesDir: string): string => path.join(path.dirname(templatesDir), 'puzzles', 'game', 'python-packages')

const textCheckSchema = z.object({
  ok: z.boolean(),
  problems: z.array(z.object({ clue: z.string(), problem: z.string() })),
  differing: z.array(z.string())
})
export type PuzzleTextCheck = z.infer<typeof textCheckSchema>

const renderedSchema = z.object({ names: z.record(z.string(), z.string()), text: z.record(z.string(), z.string()) })

export class PuzzleToolError extends Error {}

async function call<T>(py: PuzzlePython, args: string[], schema: z.ZodType<T>, input?: unknown): Promise<T> {
  if (!sdkPython(py.sdkPath)) throw new PuzzleToolError(`the puzzle tools need the Ren'Py SDK (its Python runs the puzzle library): set sdkPath in config/renpy.md (now ${py.sdkPath})`)
  const cli = path.join(py.packagesDir, 'vno_puzzles', 'cli.py')
  const r = await runSdkPython(py.sdkPath, ['-I', cli, ...args], { input: input === undefined ? '' : JSON.stringify(input), timeoutMs: py.timeoutMs ?? 30_000 })
  if (r.timedOut) throw new PuzzleToolError('the puzzle library did not answer within 30 s')
  let json: unknown
  try {
    json = JSON.parse(r.stdout)
  } catch {
    throw new PuzzleToolError(`the puzzle library failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(-600)}`)
  }
  const err = (json as { error?: string } | null)?.error
  if (err) throw new PuzzleToolError(err)
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new PuzzleToolError(`the puzzle library answered with an unexpected shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  return parsed.data
}

/** A new puzzle: the core and the canonical English names and sentences. Nothing is saved. */
export const generatePuzzle = (py: PuzzlePython, o: { kind: string; size?: number; band: string; seed: number; motive?: boolean; attrs?: boolean }): Promise<PuzzleGenerated> =>
  call(py, ['generate', '--kind', o.kind, ...(o.size ? ['--size', String(o.size)] : []), '--band', o.band, '--seed', String(o.seed), ...(o.motive ? ['--motive'] : []), ...(o.attrs ? ['--attrs'] : [])], puzzleGeneratedSchema)

/** The proof of a core: exactly one solution, solvable by deduction alone, its band, its steps. */
export const solvePuzzle = (py: PuzzlePython, core: PuzzleCore): Promise<PuzzleProof> => call(py, ['solve'], puzzleProofSchema, core)

/** The canonical English sentences of a core with these names. */
export const renderPuzzleText = (py: PuzzlePython, core: PuzzleCore, names?: Record<string, string>) => call(py, ['render-text'], renderedSchema, { puzzle: core, names })

/** The flavour check: the reader's clues (written from the prose alone) must mean the same as the originals. */
export const checkPuzzleText = (py: PuzzlePython, puzzle: PuzzleCore & { names: Record<string, string> }, readBack: ReadBackClue[], text?: Record<string, string>): Promise<PuzzleTextCheck> =>
  call(py, ['check-text'], textCheckSchema, { puzzle, readBack, text })
