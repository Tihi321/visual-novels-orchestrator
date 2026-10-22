import { z } from 'zod'

/**
 * The puzzle data (format 1), shared by the engine and the renderer. It is what `templates/puzzles/game/python-packages/vno_puzzles` makes
 * and reads (see its README): plain JSON-shaped data, no classes. The puzzle core is kept apart from the flavour (`names`, `text`), which a
 * model may rewrite without touching the logic. A core has a `kind`: `murdle` (a grid of who, with what, where and why), `knights`
 * (Knights and Knaves), and the kinds the later commits of VNO-14 add.
 */

export const PUZZLE_FORMAT = 1
export const PUZZLE_KINDS = ['murdle', 'knights'] as const
export type PuzzleKind = (typeof PUZZLE_KINDS)[number]
export const PUZZLE_BANDS = ['easy', 'medium', 'hard'] as const

const itemId = z.string().regex(/^[a-z][a-z0-9]*$/, 'an item id such as s1, w2, p3')

export const puzzleClueSchema = z.object({
  id: z.string().regex(/^c\d+$/, 'a clue id such as c1'),
  /** `is`: a and b go together. `not`: they do not. `either`: a goes with b[0] or b[1] (two items of one category). */
  type: z.enum(['is', 'not', 'either']),
  a: itemId,
  b: z.union([itemId, z.tuple([itemId, itemId])]),
  /** Items the prose points at by a trait (`descr`) instead of by name: "the heavy weapon". */
  descr: z.array(itemId).optional()
})
export type PuzzleClue = z.infer<typeof puzzleClueSchema>

/** One step of a deduction (a hint is made from it). Grid steps have a `cell`, Knights and Knaves steps a `who`. */
export const puzzleStepSchema = z
  .object({
    rule: z.string(),
    cell: z.tuple([itemId, itemId]).optional(),
    value: z.string(),
    clue: z.string().optional(),
    from: z.array(z.tuple([itemId, itemId])).optional(),
    who: z.string().optional(),
    statement: z.string().optional()
  })
  .passthrough()
export type PuzzleStep = z.infer<typeof puzzleStepSchema>

const difficulty = z.object({ steps: z.number().int(), score: z.number(), rules: z.record(z.string(), z.number()) })
const common = { format: z.literal(PUZZLE_FORMAT), seed: z.number().int().optional(), band: z.enum(PUZZLE_BANDS).optional(), difficulty, steps: z.array(puzzleStepSchema) }

/** Murdle: a grid of categories (suspect, weapon, place, and perhaps motive); the player accuses. */
export const murdleCoreSchema = z.object({
  ...common,
  kind: z.literal('murdle'),
  size: z.number().int().min(3).max(5),
  categories: z.array(z.object({ key: z.string(), items: z.array(itemId).min(3) })).min(3).max(4),
  /** Item id -> how to point at it by a trait (suspects, weapons and places): the attribute clues use these. */
  descr: z.record(z.string(), z.string()).optional(),
  /** Person -> { weapon, place } (one item of every other category, each used once). */
  solution: z.record(z.string(), z.record(z.string(), itemId)),
  clues: z.array(puzzleClueSchema).min(1),
  murder: z.object({ place: itemId, answer: z.object({ suspect: itemId, weapon: itemId, place: itemId, motive: itemId.optional() }) })
})

/** A claim of a Knights and Knaves statement (the speakers it names are ids `k1`..). */
export type KnightsClaim =
  | { type: 'knight' | 'knave'; who: string }
  | { type: 'same' | 'diff'; a: string; b: string }
  | { type: 'some_knave' | 'all_knight'; of: string[] }
  | { type: 'exactly'; k: number; of: string[] }
  | { type: 'not'; c: KnightsClaim }
  | { type: 'and' | 'or'; a: KnightsClaim; b: KnightsClaim }
const speakerId = z.string().regex(/^k\d+$/, 'a speaker id such as k1')
export const knightsClaimSchema: z.ZodType<KnightsClaim> = z.lazy(() =>
  z.union([
    z.object({ type: z.enum(['knight', 'knave']), who: speakerId }),
    z.object({ type: z.enum(['same', 'diff']), a: speakerId, b: speakerId }),
    z.object({ type: z.enum(['some_knave', 'all_knight']), of: z.array(speakerId).min(1) }),
    z.object({ type: z.literal('exactly'), k: z.number().int().min(0), of: z.array(speakerId).min(1) }),
    z.object({ type: z.literal('not'), c: knightsClaimSchema }),
    z.object({ type: z.enum(['and', 'or']), a: knightsClaimSchema, b: knightsClaimSchema })
  ])
)

/** Knights and Knaves: knights always tell the truth, knaves always lie; each statement is a claim about the speakers. */
export const knightsCoreSchema = z.object({
  ...common,
  kind: z.literal('knights'),
  size: z.number().int().min(2).max(5),
  speakers: z.array(speakerId).min(2).max(5),
  statements: z.array(z.object({ id: z.string().regex(/^t\d+$/, 'a statement id such as t1'), speaker: speakerId, claim: knightsClaimSchema })).min(1),
  solution: z.record(z.string(), z.enum(['knight', 'knave']))
})

export const puzzleCoreSchema = z.discriminatedUnion('kind', [murdleCoreSchema, knightsCoreSchema])
export type PuzzleCore = z.infer<typeof puzzleCoreSchema>
export type MurdleCore = z.infer<typeof murdleCoreSchema>
export type KnightsCore = z.infer<typeof knightsCoreSchema>

/** Every id of a core that needs a name: the items of a grid, the speakers of Knights and Knaves. */
export const puzzleEntityIds = (core: PuzzleCore): string[] => (core.kind === 'knights' ? core.speakers : core.categories.flatMap((c) => c.items))

/** Every id of a core that needs prose: the clues and the murder note, or the statements and the intro. */
export const puzzleTextIds = (core: PuzzleCore): string[] => (core.kind === 'knights' ? [...core.statements.map((s) => s.id), 'intro'] : [...core.clues.map((c) => c.id), 'murder'])

/** The ids of the things the player finds in the story (`clueAt`): a grid puzzle's clues (the statements of Knights and Knaves are all there from the start). */
export const puzzleFindableIds = (core: PuzzleCore): string[] => (core.kind === 'murdle' ? core.clues.map((c) => c.id) : [])

/** What the python CLI returns: the core plus the canonical English flavour. */
export const puzzleGeneratedSchema = z.intersection(
  puzzleCoreSchema,
  z.object({
    names: z.record(z.string(), z.string()),
    /** Clue (or statement) id, and `murder` or `intro` -> sentence. */
    text: z.record(z.string(), z.string())
  })
)
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
  /** Item (or speaker) id -> name shown in the puzzle (`s1`: Colonel Ash). */
  names: z.record(z.string(), z.string()),
  /** Clue (or statement) id -> the prose, and `murder` -> the murder note or `intro` -> the introduction. */
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

/**
 * The read-back of a puzzle's prose: what a reader (who never saw the structured data) understood from the words alone. A grid clue is
 * `{id, type, a, b}`; a Knights and Knaves statement is `{id, speaker, claim}`; both use the names of the puzzle.
 */
export const readBackClueSchema = z.union([
  z.object({
    id: z.string(),
    type: z.enum(['is', 'not', 'either']),
    a: z.string(),
    b: z.union([z.string(), z.array(z.string()).length(2)])
  }),
  z.object({ id: z.string(), speaker: z.string(), claim: z.record(z.string(), z.unknown()) })
])
export type ReadBackClue = z.infer<typeof readBackClueSchema>
