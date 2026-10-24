/**
 * Builds the puzzle proof of concept into .claude/temp/puzzle-poc/ or runs the 200-seed soundness proof directly in TypeScript.
 *
 *   npx tsx scripts/puzzle-poc.ts --proof
 *   npx tsx scripts/puzzle-poc.ts --lint --play
 *   npx tsx scripts/puzzle-poc.ts --selftest
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGame } from '../src/engine/game/build'
import type { BuildGameResult } from '../src/engine/game/build'
import { DEFAULT_SDK_PATH, lint, run } from '../src/engine/game/run'
import { buildEdition } from '../src/engine/vn/import'
import { buildBook, storyInputSchema } from '../src/engine/vn/story'
import { projectSettingsSchema } from '../src/shared/vn'
import { generate, solve } from '../src/shared/puzzles'

const ROOT = path.resolve(__dirname, '..')

/** Runs the 200-seed soundness proof across all puzzle kinds in pure TypeScript. */
export async function runSoundnessProof(seedsCount = 200): Promise<boolean> {
  console.log(`Running ${seedsCount}-seed soundness proof across all puzzle kinds...`)
  const kinds = ['murdle', 'knights', 'testimony', 'logic', 'quiz'] as const
  const bands = ['easy', 'medium', 'hard'] as const
  const t0 = Date.now()

  for (const kind of kinds) {
    const k0 = Date.now()
    for (let seed = 1; seed <= seedsCount; seed++) {
      const band = bands[(seed - 1) % bands.length]!
      const puzzle = generate({ kind, seed, band })
      const proof = solve(puzzle)
      if (!proof.unique || !proof.deducible || proof.solutions !== 1) {
        throw new Error(`Soundness proof failed for kind=${kind}, seed=${seed}, band=${band}: unique=${proof.unique}, deducible=${proof.deducible}`)
      }
    }
    console.log(`  ✓ ${kind}: ${seedsCount} seeds verified in ${Date.now() - k0}ms`)
  }
  console.log(`All ${seedsCount * kinds.length} puzzles (${seedsCount} seeds x ${kinds.length} kinds) proved sound in ${Date.now() - t0}ms!`)
  return true
}

/** Builds the proof of concept game into `dir`. Zero external SDK required. */
export async function buildPuzzlePoc(dir: string, sdkPath: string = process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH, _o: { selftest?: boolean } = {}): Promise<BuildGameResult> {
  const book = buildBook(
    storyInputSchema.parse({
      title: 'The Cold Dinner',
      characters: [{ name: 'Hartley', looks: 'a tired detective in a grey coat' }],
      places: [{ name: 'Manor', looks: 'a dark dining room' }],
      chapters: [{ title: 'The Body', scenes: [{ place: 'manor', time: 'night', beats: [{ cast: ['hartley'] }, { text: 'The dinner had gone cold.' }] }] }]
    }),
    { slug: 'puzzle-poc', lang: 'en' }
  ).book
  const settings = projectSettingsSchema.parse({ slug: 'puzzle-poc', source: 'x', primaryLang: 'en' })
  const built = await buildGame({ projectDir: dir, book, editions: [buildEdition('en', book.title, book.chapters, book.characters)], settings, resolveAsset: () => null, sdkPath })
  return built
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--proof')) {
    await runSoundnessProof(200)
    return
  }

  const dir = path.join(ROOT, '.claude', 'temp', 'puzzle-poc')
  const built = await buildPuzzlePoc(dir)
  console.log(`built ${built.gameDir}`)
  if (args.includes('--lint') || (!args.includes('--play') && !args.includes('--selftest'))) {
    const l = await lint(built.gameDir)
    console.log(l.ok && l.messages.length === 0 ? 'lint: clean' : `lint: ${l.messages.length} message(s)\n${l.messages.join('\n')}`)
    if (!l.ok) process.exitCode = 1
  }
  if (args.includes('--play')) {
    const r = run(built.gameDir)
    console.log(`playing (url ${r.url})`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
