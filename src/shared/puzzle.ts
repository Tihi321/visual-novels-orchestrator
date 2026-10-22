import { z } from 'zod'

/**
 * The puzzle data (format 1), shared by the engine and the renderer. It is what `templates/puzzles/game/python-packages/vno_puzzles` makes
 * and reads (see its README): plain JSON-shaped data, no classes. The puzzle core (`categories`, `solution`, `clues`, `murder`, `steps`,
 * `difficulty`) is kept apart from the flavour (`names`, `text`), which a model may rewrite without touching the logic.
 */

export const PUZZLE_FORMAT = 1
export const PUZZLE_KINDS = ['murdle'] as const
export const PUZZLE_BANDS = ['easy', 'medium', 'hard'] as const

const itemId = z.string().regex(/^[a-z][a-z0-9]*$/, 'an item id such as s1, w2, p3')

export const puzzleClueSchema = z.object({
  id: z.string().regex(/^c\d+$/, 'a clue id such as c1'),
  /** `is`: a and b go together. `not`: they do not. `either`: a goes with b[0] or b[1] (two items of one category). */
  type: z.enum(['is', 'not', 'either']),
  a: itemId,
  b: z.union([itemId, z.tuple([itemId, itemId])])
})
export type PuzzleClue = z.infer<typeof puzzleClueSchema>

export const puzzleStepSchema = z
  .object({
    rule: z.enum(['clue', 'elim', 'last', 'either', 'trans']),
    cell: z.tuple([itemId, itemId]),
    value: z.enum(['yes', 'no']),
    clue: z.string().optional(),
    from: z.array(z.tuple([itemId, itemId])).optional()
  })
  .passthrough()
export type PuzzleStep = z.infer<typeof puzzleStepSchema>

/** The core of a puzzle, as `vno_puzzle_generate` returns it (without the flavour). */
export const puzzleCoreSchema = z.object({
  format: z.literal(PUZZLE_FORMAT),
  kind: z.enum(PUZZLE_KINDS),
  size: z.number().int().min(3).max(5),
  seed: z.number().int().optional(),
  band: z.enum(PUZZLE_BANDS).optional(),
  categories: z.array(z.object({ key: z.string(), items: z.array(itemId).min(3) })).min(3),
  /** Person -> { weapon, place } (one item of every other category, each used once). */
  solution: z.record(z.string(), z.record(z.string(), itemId)),
  clues: z.array(puzzleClueSchema).min(1),
  murder: z.object({ place: itemId, answer: z.object({ suspect: itemId, weapon: itemId, place: itemId }) }),
  difficulty: z.object({ steps: z.number().int(), score: z.number(), rules: z.record(z.string(), z.number()) }),
  steps: z.array(puzzleStepSchema)
})
export type PuzzleCore = z.infer<typeof puzzleCoreSchema>

/** What the python CLI returns: the core plus the canonical English flavour. */
export const puzzleGeneratedSchema = puzzleCoreSchema.extend({
  names: z.record(z.string(), z.string()),
  /** Clue id (and `murder`) -> sentence. */
  text: z.record(z.string(), z.string())
})
export type PuzzleGenerated = z.infer<typeof puzzleGeneratedSchema>

/** What `solve` proves. */
export const puzzleProofSchema = z.object({
  unique: z.boolean(),
  solutions: z.number().int(),
  deducible: z.boolean(),
  band: z.enum(PUZZLE_BANDS).nullable(),
  score: z.number(),
  steps: z.array(puzzleStepSchema),
  rules: z.record(z.string(), z.number())
})
export type PuzzleProof = z.infer<typeof puzzleProofSchema>

/** A puzzle of a book: the core and its flavour. */
export const puzzleEntrySchema = z.object({
  /** Lowercase key (`dinner`): a puzzle beat names it. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores, starting with a letter'),
  kind: z.enum(PUZZLE_KINDS),
  data: puzzleCoreSchema,
  /** Item id -> name shown in the grid (`s1`: Colonel Ash). */
  names: z.record(z.string(), z.string()),
  /** Clue id -> the clue in prose, and `murder` -> the murder note. */
  text: z.record(z.string(), z.string()),
  /** Item id -> what it is in the story: a suspect is a character, a place a place, a weapon an image (an insert). A name then follows a renamed character. */
  links: z.record(z.string(), z.object({ type: z.enum(['character', 'place', 'image']), key: z.string() })).optional(),
  /** Clue id -> the beat that shows it (`CLUE:`): the puzzle lists only the clues found by then (clues with no entry are always listed). */
  clueAt: z.record(z.string(), z.string()).optional(),
  /** What a wrong answer does. Missing: retry as often as the player wants, a hint after 2 wrong accusations. */
  onFail: z.object({ mode: z.enum(['retry', 'continue', 'chapter']), to: z.number().int().positive().optional(), maxTries: z.number().int().positive().optional() }).optional(),
  /** False: no hint button and no offer. Missing: hints on. */
  hints: z.boolean().optional(),
  /** What the code proved when the puzzle was set. `textChecked`: the prose was read back and means the same constraints. */
  verified: z.object({ unique: z.boolean(), deducible: z.boolean(), score: z.number(), textChecked: z.boolean(), by: z.string() })
})
export type PuzzleEntry = z.infer<typeof puzzleEntrySchema>

/** The words of a puzzle in one edition: names and clue texts. */
export const editionPuzzleSchema = z.object({
  names: z.record(z.string(), z.string()),
  text: z.record(z.string(), z.string())
})
export type EditionPuzzle = z.infer<typeof editionPuzzleSchema>

/** The read-back of a clue: what a reader (who never saw the structured clue) understood from the prose. */
export const readBackClueSchema = z.object({
  id: z.string(),
  type: z.enum(['is', 'not', 'either']),
  a: z.string(),
  b: z.union([z.string(), z.array(z.string()).length(2)])
})
export type ReadBackClue = z.infer<typeof readBackClueSchema>
