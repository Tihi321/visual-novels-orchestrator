/**
 * Builds the puzzle proof of concept (a 3x3 Murdle grid in one Ren'Py screen) into .claude/temp/puzzle-poc/ and lints or plays it.
 *
 *   npx tsx scripts/puzzle-poc.ts --lint --play
 *   npx tsx scripts/puzzle-poc.ts --selftest      (Ren'Py's test runner clicks through the screens; a window opens for a few seconds)
 *
 * The base game comes from the real build (template, theme, menus, options), with placeholders and a one-line story; the puzzle library
 * from templates/puzzles/game/ is copied in, and `label start` jumps to the proof of concept. Nothing in out/ or ~/VisualNovels is touched.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGame } from '../src/engine/renpy/build'
import type { BuildGameResult } from '../src/engine/renpy/build'
import { DEFAULT_SDK_PATH, lint, run, runRenpy, sdkExists } from '../src/engine/renpy/run'
import { buildEdition } from '../src/engine/vn/import'
import { buildBook, storyInputSchema } from '../src/engine/vn/story'
import { projectSettingsSchema } from '../src/shared/vn'

const ROOT = path.resolve(__dirname, '..')

/** Builds the proof of concept game into `dir` (`<dir>/game/` is the Ren'Py project). `selftest` adds the Ren'Py test case. */
export async function buildPuzzlePoc(dir: string, sdkPath: string = process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH, o: { selftest?: boolean } = {}): Promise<BuildGameResult> {
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
  const game = path.join(built.gameDir, 'game')
  fs.cpSync(path.join(ROOT, 'templates', 'puzzles', 'game'), game, { recursive: true, filter: (src) => !src.includes('__pycache__') })
  fs.copyFileSync(path.join(ROOT, 'templates', 'puzzles', 'poc', 'puzzle_poc.rpy'), path.join(game, 'puzzle_poc.rpy'))
  fs.writeFileSync(path.join(game, 'script.rpy'), 'label start:\n    jump puzzle_poc\n')
  if (o.selftest) fs.copyFileSync(path.join(ROOT, 'templates', 'puzzles', 'poc', 'puzzle_poc_test.rpy'), path.join(game, 'puzzle_poc_test.rpy'))
  return built
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const sdkPath = process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH
  if (!sdkExists(sdkPath)) {
    console.log(`SKIPPED: the Ren'Py SDK is not at ${sdkPath} (set VNO_RENPY_SDK)`)
    return
  }
  const dir = path.join(ROOT, '.claude', 'temp', 'puzzle-poc')
  const selftest = args.includes('--selftest')
  const built = await buildPuzzlePoc(dir, sdkPath, { selftest })
  console.log(`built ${built.gameDir}`)
  if (args.includes('--lint') || (!args.includes('--play') && !selftest)) {
    const l = await lint(built.gameDir, { sdkPath })
    console.log(l.ok && l.messages.length === 0 ? 'lint: clean' : `lint: ${l.messages.length} message(s)\n${l.messages.join('\n')}`)
    if (!l.ok) process.exitCode = 1
  }
  if (selftest) {
    for (const name of ['puzzle_smoke', 'puzzle_smoke_big', 'puzzle_smoke_knights', 'puzzle_smoke_testimony', 'puzzle_smoke_logic']) {
      const r = await runRenpy(sdkPath, [built.gameDir, 'test', name], { timeoutMs: 180_000 })
      const out = `${r.stdout}\n${r.stderr}`
      const passed = /Status:\s+PASSED/.test(out)
      console.log(passed ? `selftest ${name}: passed` : `selftest ${name}: FAILED\n${out.slice(-3000)}`)
      if (!passed) process.exitCode = 1
    }
  }
  if (args.includes('--play')) {
    const r = run(built.gameDir, { sdkPath })
    console.log(`playing (pid ${r.pid ?? '?'}): the window opens; close it when done`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
