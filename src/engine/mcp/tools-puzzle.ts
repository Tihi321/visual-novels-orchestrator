import { z } from 'zod'
import { PUZZLE_BANDS, PUZZLE_KINDS, readBackClueSchema } from '../../shared/puzzle'
import type { PuzzleCore, PuzzleEntry } from '../../shared/puzzle'
import { langSchema } from '../../shared/vn'
import { readBackTask as readBackTaskOf } from '../puzzles/readback'
import { PUZZLES_VERSION, checkPuzzleText, generatePuzzle, renderPuzzleText, solvePuzzle } from '../puzzles/python'
import type { StoryOp } from '../vn/story'
import type { VnService } from '../vn/service'
import type { Tool, ToolDef } from './tools'

/**
 * The puzzle tools. Code makes the puzzle (the library in `templates/puzzles/`, run with the Ren'Py SDK's own Python) and proves it has
 * exactly one solution that deduction alone finds; a model only writes the flavour (names and clues in prose); a separate read-back
 * checks that the prose still means the same clues. The puzzle beat itself goes through `vno_beat_add {puzzle: key}`.
 */

const slug = z.string().describe('The project slug (see vno_list_projects)')
const BUILD_HINT = 'Run vno_build to see the change in the game.'

const link = z.object({ type: z.enum(['character', 'place', 'image']), key: z.string() })
const onFail = z.object({
  mode: z.enum(['retry', 'continue', 'chapter']).describe('retry: as often as the player wants (a hint after 2 wrong accusations). continue: after maxTries wrong accusations the story goes on. chapter: after maxTries it jumps to chapter `to` (a bad ending)'),
  to: z.number().int().positive().optional(),
  maxTries: z.number().int().positive().optional().describe('Wrong accusations before the puzzle ends (continue and chapter; default 3)')
})
const generateSpec = z.object({
  kind: z.enum(PUZZLE_KINDS).default('murdle'),
  size: z.number().int().min(3).max(4).optional().describe('Items per category: 3 (default) or 4'),
  motive: z.boolean().optional().describe('Murdle: a fourth category, the motive (jealousy, greed ...)'),
  attrs: z.boolean().optional().describe('Murdle: some clues point at an item by a trait ("the heavy weapon") instead of its name'),
  band: z.enum(PUZZLE_BANDS).default('medium').describe('easy: needs no either or transitive step. medium: needs one. hard: at least 3 transitive steps and no direct clue'),
  seed: z.number().int().min(0).optional().describe('The same seed gives the same puzzle. Left out: a random one')
})

const sameKeys = (a: Record<string, string>, b: Record<string, string>): boolean => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)

export function puzzleTools(svc: VnService, def: ToolDef): Tool[] {
  const edit = async (slugName: string, ops: StoryOp[]) => {
    const r = await svc.editStory(slugName, ops)
    return { warnings: r.warnings, created: r.created }
  }
  const entryOf = async (slugName: string, key: string): Promise<PuzzleEntry> => {
    const book = await svc.store.loadBook(slugName)
    const p = book.puzzles?.find((x) => x.key === key)
    if (!p) throw new Error(`${slugName} has no puzzle "${key}"${book.puzzles?.length ? ` (puzzles: ${book.puzzles.map((x) => x.key).join(', ')})` : ' (vno_puzzle_set makes one)'}`)
    return p
  }

  return [
    def(
      'vno_puzzle_generate',
      'Make a logic puzzle with code and prove it: exactly one solution, solvable by deduction alone with no guessing, minimal, in the asked band. A 3x3 Murdle (who, with what, where). Nothing is saved: the answer is the puzzle core (categories of item ids s1.., w1.., p1.., the solution, the clues as structured data, the murder place and answer, the deduction steps, the difficulty) plus canonical English names and clue sentences. Give it to vno_puzzle_set (generate or data), or to Scriptorium in the story brief. The same seed gives the same puzzle.',
      generateSpec,
      async (a) => {
        const py = await svc.puzzlePython()
        const seed = a.seed ?? Math.floor(Math.random() * 1_000_000_000)
        const t0 = Date.now()
        const p = await generatePuzzle(py, { kind: a.kind, size: a.size, band: a.band, seed, motive: a.motive, attrs: a.attrs })
        const { names, text, ...core } = p
        return { seed, band: a.band, core, names, text, difficulty: p.difficulty, ms: Date.now() - t0, next: 'vno_puzzle_set {slug, key, data: core, names, text} puts it in a project, or vno_puzzle_set {slug, key, generate: {...}} makes and sets it in one call.' }
      }
    ),
    def(
      'vno_puzzle_set',
      'Add a puzzle to a project or change one. A new puzzle: give generate {kind, size, band, seed?} (made here) or data (a core from vno_puzzle_generate), plus names (item id -> name; default the canonical English names) and text (clue id -> the clue in prose, and murder -> the murder note; default the canonical sentences). The core is proved first (unique, deducible) and refused if it is not. Prose you write is not trusted until vno_puzzle_check_text passes: verified.textChecked stays false. links says which story characters, places and images the items are; clueAt (clue id -> beat id) makes the puzzle list a clue only after the story has shown it; onFail says what a wrong answer does; hints false removes hints. The puzzle is played by a beat: vno_beat_add {sceneId, beats: [{puzzle: key}]}.',
      z.object({
        slug,
        key: z.string().describe('A short id such as dinner'),
        generate: generateSpec.optional().describe('Make the puzzle core here (a new puzzle, or a new core for an existing one)'),
        data: z.record(z.string(), z.unknown()).optional().describe('A puzzle core from vno_puzzle_generate (its core field)'),
        names: z.record(z.string(), z.string()).optional(),
        text: z.record(z.string(), z.string()).optional(),
        links: z.record(z.string(), link).nullable().optional(),
        clueAt: z.record(z.string(), z.string()).nullable().optional(),
        onFail: onFail.nullable().optional(),
        hints: z.boolean().nullable().optional()
      }),
      async (a) => {
        const py = await svc.puzzlePython()
        const book = await svc.store.loadBook(a.slug)
        const old = book.puzzles?.find((p) => p.key === a.key)
        let core: PuzzleCore | undefined
        let canon: { names: Record<string, string>; text: Record<string, string> } | undefined
        if (a.generate) {
          const g = await generatePuzzle(py, { ...a.generate, seed: a.generate.seed ?? Math.floor(Math.random() * 1_000_000_000) })
          const { names, text, ...rest } = g
          core = rest
          canon = { names, text }
        } else if (a.data) {
          const { puzzleCoreSchema } = await import('../../shared/puzzle')
          core = puzzleCoreSchema.parse(a.data)
        }
        if (!core && !old) throw new Error('a new puzzle needs generate or data')
        const use = core ?? old!.data
        let proof
        if (core) {
          proof = await solvePuzzle(py, core)
          if (!proof.unique) throw new Error(`this puzzle has ${proof.solutions} solutions, not one: it is refused (vno_puzzle_generate makes sound ones)`)
          if (!proof.deducible) throw new Error('this puzzle cannot be solved by deduction alone (it needs a guess): it is refused')
        }
        // names and text: what was given, else the canonical ones for the names (or the old words when the puzzle stays)
        const names = a.names ? { ...(old?.names ?? canon?.names ?? {}), ...a.names } : (core ? (canon?.names ?? old?.names) : old?.names)
        let rendered: { names: Record<string, string>; text: Record<string, string> } | undefined
        const needCanon = core ? true : !!a.names
        if (needCanon && names) rendered = await renderPuzzleText(py, use, names)
        else if (!names) rendered = await renderPuzzleText(py, use)
        const finalNames = names ?? rendered!.names
        const oldCanonical = old ? (await renderPuzzleText(py, old.data, old.names)).text : undefined
        let text = a.text
        if (!text) {
          // new core, or renamed items with canonical text: the canonical sentences follow; hand-written prose is kept (and flagged)
          if (core || !old || (oldCanonical && sameKeys(oldCanonical, old.text))) text = rendered?.text
        }
        const canonicalNow = rendered?.text
        const finalText = text ?? old?.text ?? {}
        const textChecked = !!canonicalNow && sameKeys(finalText, canonicalNow) && (!a.text || sameKeys(a.text, canonicalNow))
        const keptProse = !text && a.names && old ? 'the clue prose was kept: it may still use the old names (vno_puzzle_check_text, or give text)' : undefined
        const verified = { unique: proof?.unique ?? old!.verified.unique, deducible: proof?.deducible ?? old!.verified.deducible, score: proof?.score ?? old!.verified.score, textChecked: core || a.text || a.names ? textChecked : old!.verified.textChecked, by: PUZZLES_VERSION }
        const op: StoryOp = {
          op: 'puzzle.set',
          key: a.key,
          ...(core ? { data: core } : {}),
          names: finalNames,
          text: finalText,
          ...(a.links !== undefined ? { links: a.links } : {}),
          ...(a.clueAt !== undefined ? { clueAt: a.clueAt } : {}),
          ...(a.onFail !== undefined ? { onFail: a.onFail } : {}),
          ...(a.hints !== undefined ? { hints: a.hints } : {}),
          verified
        }
        const r = await edit(a.slug, [op])
        const played = (await svc.store.loadBook(a.slug)).chapters.some((c) => c.scenes.some((s) => s.beats.some((b) => b.type === 'puzzle' && b.puzzle === a.key)))
        return {
          key: a.key,
          verified,
          difficulty: use.difficulty,
          band: proof?.band ?? undefined,
          ...(keptProse ? { note: keptProse } : {}),
          warnings: r.warnings,
          next: `${played ? '' : `Play it with vno_beat_add {sceneId, beats: [{puzzle: "${a.key}"}]}. `}${textChecked ? '' : 'Prose that is not canonical needs vno_puzzle_check_text before the book is final. '}${BUILD_HINT}`
        }
      }
    ),
    def(
      'vno_puzzle_get',
      'Read a puzzle of a project: the core (clues as structured data, solution, deduction steps, difficulty), the names, the clue prose next to the canonical sentence, what the code verified, and readBackTask: the text to hand to a SEPARATE reader (a model that has not seen the clues) for vno_puzzle_check_text. lang gives the words of an edition.',
      z.object({ slug, key: z.string(), lang: langSchema.optional().describe('An edition language: its names and clue prose') }),
      async (a) => {
        const p = await entryOf(a.slug, a.key)
        const primary = (await svc.store.loadSettings(a.slug)).settings.primaryLang
        const words = a.lang && a.lang !== primary ? ((await svc.store.loadEdition(a.slug, a.lang).catch(() => null))?.puzzles?.[a.key] ?? null) : { names: p.names, text: p.text }
        if (!words) throw new Error(`the ${a.lang} edition of ${a.slug} has no words for puzzle ${a.key} (vno_edition_set {puzzles})`)
        const py = await svc.puzzlePython()
        const canonical = await renderPuzzleText(py, p.data, p.names)
        const readBackTask = readBackTaskOf(p, words)
        return { key: p.key, kind: p.kind, core: p.data, names: words.names, text: words.text, canonicalText: canonical.text, verified: p.verified, links: p.links, clueAt: p.clueAt, onFail: p.onFail, hints: p.hints, readBackTask }
      }
    ),
    def(
      'vno_puzzle_check_text',
      'The flavour check: does the prose of the clues still mean the same constraints? A separate reader (who has seen only readBackTask from vno_puzzle_get, never the structured clues) writes each clue back as structured data; this tool compares it with the original clue by truth table (the two must be true in exactly the same assignments), then checks that the read-back clues still give one solution that deduction finds. A pass sets verified.textChecked (primary language). The result lists the clues that differ: rewrite those and check again. With lang it checks that edition\'s words (translated clues) and sets nothing.',
      z.object({ slug, key: z.string(), readBack: z.array(readBackClueSchema).min(1).describe('The reader\'s clues: {id, type, a, b} with names (or item ids)'), lang: langSchema.optional() }),
      async (a) => {
        const p = await entryOf(a.slug, a.key)
        const primary = (await svc.store.loadSettings(a.slug)).settings.primaryLang
        const edition = a.lang && a.lang !== primary
        const words = edition ? (await svc.store.loadEdition(a.slug, a.lang!).catch(() => null))?.puzzles?.[a.key] : { names: p.names, text: p.text }
        if (!words) throw new Error(`the ${a.lang} edition of ${a.slug} has no words for puzzle ${a.key}`)
        const py = await svc.puzzlePython()
        const result = await checkPuzzleText(py, { ...p.data, names: words.names }, a.readBack, words.text)
        if (!edition && result.ok) {
          await edit(a.slug, [{ op: 'puzzle.set', key: a.key, verified: { ...p.verified, textChecked: true, by: PUZZLES_VERSION } }])
        } else if (!edition && p.verified.textChecked) {
          await edit(a.slug, [{ op: 'puzzle.set', key: a.key, verified: { ...p.verified, textChecked: false } }])
        }
        return { ...result, key: a.key, ...(edition ? { lang: a.lang } : { textChecked: result.ok }), next: result.ok ? BUILD_HINT : 'Rewrite the clues in "differing" (vno_puzzle_set {text}), then read them back again with a fresh reader.' }
      }
    ),
    def(
      'vno_puzzle_remove',
      'Remove a puzzle. Refused while a beat plays it, unless force: then that beat is removed too.',
      z.object({ slug, key: z.string(), force: z.boolean().optional() }),
      async (a) => ({ ...(await edit(a.slug, [{ op: 'puzzle.remove', key: a.key, force: a.force }])), next: BUILD_HINT })
    )
  ]
}
