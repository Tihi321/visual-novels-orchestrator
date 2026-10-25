import path from 'node:path'
import type { EngineEvent, PipelineStep, ProjectSettingsPatch } from '../shared/protocol'
import { ART_PROVIDERS, CHIPS, DITHERS, MUSIC_PROVIDERS, PIXEL_PROVIDERS, resolveArtProvider, resolveMusicProvider, resolvePixel, resolvePixelProvider } from '../shared/vn'
import { assertKnownLang } from '../shared/languages'
import type { Lang } from '../shared/vn'
import { Engine } from './engine'
import type { EngineOptions } from './engine'
import { initDataFolder, resolveDataDir } from './store/dataFolder'
import { acquireEngineLock, EngineLockHeldError } from './store/lock'
import { isStep, STEPS, TASKS } from './vn/pipeline'
import type { VnService } from './vn/service'

/**
 * The CLI for the VN pipeline: `yarn engine -- <command> ...`. It starts the same engine as the app (scheduler, agents,
 * handlers) headless, enqueues the jobs and waits until the project has nothing left to run.
 */

export const USAGE = `VN Studio command line

Usage: yarn engine -- <command> [options]      (global: --data <dir>, --seed <dir>, --verbose)

  books                                  list the books in the Scriptorium library
  import <folder|slug> [--lang en|hr] [--run]   make a project from a book (--run: start the pipeline)
  projects                               list the projects
  run <slug> [--from <step>] [--force]   run the pipeline; steps: ${STEPS.join(', ')}
  edition add <slug> <folder|catalog.json> [--lang hr] [--force]   add a translated edition (legacy folder, or a pack catalogue/bundle)
  edition sync <slug> [folder]           add every non-primary vn/text/*.json catalogue of a pack
  analyse <slug>                         let the script-analyst settle the items the parser could not
  plan <slug> [--refresh-prompts]        write the art and music prompts (--refresh-prompts: write the art prompts again, also for assets that have a file; locked and custom ones stay)
  assets <slug> [--kind k]               list the assets with their versions and files
  generate <slug> [--kind k] [--only id] [--force]   generate the assets that have no file (k: background, sheet, sprite, cover, music)
  asset replace <slug> <id> <file>       use your own file (custom, locked)
  asset pick <slug> <id> <version>       use another version
  asset regen <slug> <id> [--prompt text] [--engine id] [--seed n] [--sprites]   (--sprites: a sheet, also make its sprites again after it)
  asset import <slug> <id> <file> [--no-process] [--bg key|birefnet|none] [--no-trim] [--no-pixelate]   use a file you made, cut out / fitted / pixelated like a generated image
  asset lock|unlock <slug> <id>
  clear-queue [slug]                     delete the queued jobs (of a project, or all) and mark their pipeline steps skipped
  build <slug>                           build the game
  lint <slug>                            run lint on the built game
  play <slug>                            start the built game
  voice <slug> [--lang hr] [--only <beatId>] [--limit n]   generate the voice clips (only when the project's voice is on)
  voice plan <slug> [--overwrite]        assign a VibeTTS voice per character, the narrator and edition language
  voice import <slug> --lang hr (--folder <dir> | --beat <beatId> --file <clip>)   use clips you made: <beatId>.<ext> files; generation keeps them
  voice set <slug> <speaker> <lang> <voice>   pick one voice (a character key or narrator; en, hr; an id from voice status)
  voice status                           is VibeTTS reachable, and its fixed voices (Kokoro: English, Supertonic: 31 languages)
  comfy status|free                      ComfyUI lanes and engines / free its VRAM
  settings <slug> [--style pixel|illustrated] [--palette name|none] [--music-provider chiptune|comfy|auto] [--chip nes|gb|genesis|snes|pce|auto]
           [--pixel-provider pixel-studio|vno] [--art-provider comfy|pixel-studio-draw|hand|flow] [--flow-model "Nano Banana Pro"] [--pixel-size 320x180] [--dither none|ordered|floyd] [--outline[=false]] [--tracks n]
                                         show or change the look settings of a project
  studios status                         are Pixel Studio and Chiptune Studio reachable (how to start them if not)
  studio open <slug> <assetId> [--wait] [--via launch|mcp] [--timeout seconds]   open an asset in Pixel Studio / Chiptune Studio; a save there makes a new custom, locked version (--wait: until the first save)
  themes                                 list the game themes
  mcp                                    run the MCP server on stdio (relays to the running app or headless engine when there is one)
`

/** The commands the VN CLI handles (the rest of index.ts handles `probe`, `key-set` and the plain engine). */
export const CLI_COMMANDS = new Set(['books', 'import', 'projects', 'run', 'edition', 'analyse', 'plan', 'assets', 'generate', 'asset', 'clear-queue', 'build', 'lint', 'play', 'voice', 'comfy', 'settings', 'studios', 'studio', 'themes', 'help'])

const BOOL_FLAGS = new Set(['force', 'run', 'verbose', 'json', 'no-build', 'refresh-prompts', 'help', 'outline', 'wait', 'sprites', 'no-process', 'no-trim', 'no-pixelate'])

export interface ParsedCli {
  command: string
  /** The words after the command that are not options. */
  args: string[]
  flags: Record<string, string | true>
}

/** `import ./book --lang hr --run` -> `{ command: 'import', args: ['./book'], flags: { lang: 'hr', run: true } }`. */
export function parseCliArgs(argv: readonly string[]): ParsedCli {
  const words = argv[0] === '--' ? argv.slice(1) : [...argv]
  const flags: Record<string, string | true> = {}
  const rest: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (w.startsWith('--') && w.length > 2) {
      const eq = w.indexOf('=')
      if (eq > 0) flags[w.slice(2, eq)] = w.slice(eq + 1)
      else {
        const name = w.slice(2)
        const next = words[i + 1]
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) flags[name] = true
        else {
          flags[name] = next
          i++
        }
      }
    } else rest.push(w)
  }
  return { command: rest[0] ?? '', args: rest.slice(1), flags }
}

const out = (s = '') => process.stdout.write(s + '\n')

function flag(p: ParsedCli, name: string): string | undefined {
  const v = p.flags[name]
  return typeof v === 'string' ? v : undefined
}

function lang(p: ParsedCli): Lang | undefined {
  const l = flag(p, 'lang')
  if (l === undefined) return undefined
  return l
}

function need(p: ParsedCli, n: number, usage: string): string[] {
  if (p.args.length < n) throw new Error(`usage: ${usage}`)
  return p.args
}

/** The settings patch of `settings <slug>` flags. */
export function settingsPatchFromFlags(p: ParsedCli): ProjectSettingsPatch {
  const art: NonNullable<ProjectSettingsPatch['art']> = {}
  const music: NonNullable<ProjectSettingsPatch['music']> = {}
  const pick = <T extends string>(name: string, allowed: readonly T[], auto: readonly string[] = ['auto', 'none', 'default']): T | null | undefined => {
    const v = flag(p, name)
    if (v === undefined) return undefined
    if (auto.includes(v)) return null
    if (!(allowed as readonly string[]).includes(v)) throw new Error(`--${name} must be one of ${[...allowed, 'auto'].join(', ')}, not "${v}"`)
    return v as T
  }
  const style = flag(p, 'style')
  if (style !== undefined) {
    if (style !== 'illustrated' && style !== 'pixel') throw new Error('--style must be illustrated or pixel')
    art.style = style
  }
  const palette = flag(p, 'palette')
  if (palette !== undefined) art.palette = palette === 'none' ? null : palette
  const pp = pick('pixel-provider', PIXEL_PROVIDERS)
  if (pp !== undefined) art.pixelProvider = pp
  const ap = pick('art-provider', ART_PROVIDERS)
  if (ap !== undefined) art.provider = ap
  const flowModel = flag(p, 'flow-model')
  if (flowModel !== undefined) art.flowModel = flowModel === 'auto' ? null : flowModel
  const pixel: NonNullable<ProjectSettingsPatch['art']>['pixel'] = {}
  const size = flag(p, 'pixel-size')
  if (size !== undefined) {
    const m = /^(\d{2,3})x(\d{2,3})$/.exec(size)
    if (!m) throw new Error('--pixel-size must be WIDTHxHEIGHT, for example 320x180')
    pixel.width = Number(m[1])
    pixel.height = Number(m[2])
  }
  const dither = pick('dither', DITHERS, ['default'])
  if (dither !== undefined && dither !== null) pixel.dither = dither
  if (p.flags.outline !== undefined) pixel.outline = p.flags.outline !== 'false'
  if (Object.keys(pixel).length) art.pixel = pixel
  const mp = pick('music-provider', MUSIC_PROVIDERS)
  if (mp !== undefined) music.provider = mp
  const chip = pick('chip', CHIPS)
  if (chip !== undefined) music.chip = chip
  const tracks = flag(p, 'tracks')
  if (tracks !== undefined) {
    const n = Number(tracks)
    if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error('--tracks must be a whole number from 0 to 20')
    music.tracks = n
  }
  return { ...(Object.keys(art).length ? { art } : {}), ...(Object.keys(music).length ? { music } : {}) }
}

/**
 * A headless engine for a CLI run: the data folder is created from the seed, events are printed. It takes the data-folder lock
 * (released by `engine.stop()`): with the app or another engine running on the folder it throws `EngineLockHeldError`.
 */
export async function startHeadless(argv: readonly string[], o: Partial<EngineOptions> & { print?: boolean } = {}): Promise<Engine> {
  const dataDir = resolveDataDir({ argv })
  const lock = await acquireEngineLock(dataDir)
  const seedIdx = argv.indexOf('--seed')
  const verbose = argv.includes('--verbose')
  const engine = new Engine({
    dataDir,
    lock,
    emit: (e) => {
      if (o.print !== false) printEvent(e)
      o.emit?.(e)
    },
    log: (m) => {
      if (verbose) process.stderr.write(`[engine] ${m}\n`)
    },
    ...o
  })
  try {
    await initDataFolder(dataDir, seedIdx >= 0 && argv[seedIdx + 1] ? path.resolve(argv[seedIdx + 1]!) : undefined)
    await engine.start()
  } catch (e) {
    await lock.release()
    throw e
  }
  return engine
}

/** One line per event that matters to someone watching a run. */
export function printEvent(e: EngineEvent): void {
  switch (e.type) {
    case 'pipeline.progress': {
      const s = e.status
      if (s.status === 'queued') return
      out(`[${e.slug}] ${e.step}: ${s.status}${s.total ? ` ${s.done ?? 0}/${s.total}` : ''}${s.message ? ` - ${s.message}` : ''}`)
      return
    }
    case 'job.done':
      if (!e.ok && e.error && !/^stopped/.test(e.error)) out(`  job ${e.jobId} failed: ${e.error}`)
      return
    case 'command.error':
      out(`error (${e.command}): ${e.message}`)
      return
    case 'engine.warning':
      out(`warning: ${e.message}`)
      return
    case 'build.result':
      out(`[${e.result.slug}] ${e.result.action}: ${e.result.skipped ? 'skipped' : e.result.ok ? 'ok' : 'problems'}`)
      return
    default:
  }
}

async function waitAndReport(svc: VnService, slug: string, o: { timeoutMs?: number } = {}): Promise<number> {
  const r = await svc.waitIdle(slug, { timeoutMs: o.timeoutMs })
  const st = await svc.status(slug)
  if (r.clientTasks > 0) {
    out(`${r.clientTasks} model call(s) wait for an MCP client (a role is set to a client/... model); nothing here answers them. Connect an MCP client (vno_get_task) or change the role's model.`)
    return 1
  }
  if (r.timedOut) out(`stopped waiting: ${st.jobs.queued} queued, ${st.jobs.running} running`)
  if (r.failed.length) {
    out(`failed job(s): ${r.failed.join(', ')}`)
    for (const f of st.failed.filter((x) => r.failed.includes(x.id))) out(`  ${f.id}: ${f.failure.slice(0, 300)}`)
    return 1
  }
  return r.timedOut ? 1 : 0
}

function printAssets(assets: { id: string; kind: string; selected: number | null; versions: unknown[]; source: string; locked: boolean; fileRel: string | null; orphaned: boolean }[]): void {
  for (const a of assets) {
    out(`${a.id.padEnd(34)} ${a.kind.padEnd(10)} ${a.fileRel ? `v${a.selected ?? '?'}/${a.versions.length}${a.source === 'custom' ? ' custom' : ''}` : 'no file'}${a.locked ? ' locked' : ''}${a.orphaned ? ' (unused)' : ''}`)
  }
}

/** Runs one CLI command against a started engine. Returns the exit code. */
export async function runCliWith(engine: Engine, p: ParsedCli): Promise<number> {
  const svc = engine.vn
  switch (p.command) {
    case 'books': {
      const books = await svc.listSourceBooks()
      if (!books.length) out(`no books in ${svc.scriptoriumDir()}/books`)
      for (const b of books) out(`${b.slug.padEnd(48)} ${b.format.padEnd(24)} ${b.stage.padEnd(12)} ${b.path}`)
      return 0
    }
    case 'import': {
      const [source] = need(p, 1, 'import <folder|slug> [--lang en|hr] [--run]')
      const r = await svc.importProject(source!, { lang: lang(p) })
      const pv = r.preview
      out(`project ${r.slug}: "${pv.title}" (${pv.format}, ${pv.kind}), language ${pv.detected.lang} (confidence ${pv.detected.confidence})`)
      out(`${pv.chapters} chapter(s), ${pv.characters} character(s), ${pv.places} place(s), ${pv.uncertain} item(s) for the script-analyst`)
      for (const w of pv.warnings) out(`  warning: ${w}`)
      if (p.flags.run) {
        const run = await svc.runPipeline(r.slug, 'analyse')
        out(`pipeline run ${run.run} started`)
        return waitAndReport(svc, r.slug)
      }
      return 0
    }
    case 'projects': {
      const list = await svc.listProjects()
      if (!list.length) out('no projects yet')
      for (const s of list) out(`${s.slug.padEnd(40)} ${s.primaryLang} ${s.kind.padEnd(7)} ${s.chapters} ch  assets ${s.assets.ready}/${s.assets.total}  editions ${s.editions.join(',')}${s.voice ? '  voice' : ''}`)
      return 0
    }
    case 'run': {
      const [slug] = need(p, 1, 'run <slug> [--from <step>] [--force]')
      const from = flag(p, 'from')
      if (from && !isStep(from)) throw new Error(`--from must be one of ${STEPS.join(', ')}`)
      const r = await svc.runPipeline(slug!, from as PipelineStep | undefined, { force: !!p.flags.force })
      out(`pipeline run ${r.run} from ${r.from}`)
      return waitAndReport(svc, slug!)
    }
    case 'edition': {
      if (p.args[0] === 'sync') {
        const [, slug, folder] = need(p, 2, 'edition sync <slug> [folder]')
        const r = await svc.syncEditions(slug!, folder)
        for (const a of r.added) out(`${a.lang}: ${a.keyCount} key(s), ${a.missing.length} missing`)
        for (const f of r.failed) out(`${f.lang}: failed: ${f.error}`)
        if (r.skipped.length) out(`skipped the primary language ${r.skipped.join(', ')}`)
        return r.failed.length ? 1 : 0
      }
      if (p.args[0] !== 'add') throw new Error('usage: edition add <slug> <folder|catalog.json> [--lang hr] | edition sync <slug> [folder]')
      const [, slug, folder] = need(p, 3, 'edition add <slug> <folder|catalog.json> [--lang hr]')
      const l = lang(p)
      const r = await svc.addEdition(slug!, folder!, l, { force: !!p.flags.force })
      const code = await waitAndReport(svc, slug!)
      const rep = await svc.alignReport(slug!, r.lang)
      if (rep) out(`${r.lang}: ${rep.matched} beat(s) matched, ${rep.missing.length} missing, ${rep.extra.length} extra${rep.keyCount !== undefined ? `, ${rep.keyCount} key(s)` : ''}${rep.warnings.length ? `, ${rep.warnings.length} warning(s)` : ''}`)
      return code
    }
    case 'analyse': {
      const [slug] = need(p, 1, 'analyse <slug>')
      await svc.enqueue(slug!, TASKS.analyse, 'all', await svc.nextRun(slug!))
      return waitAndReport(svc, slug!)
    }
    case 'assets': {
      const [slug] = need(p, 1, 'assets <slug> [--kind k]')
      const kind = flag(p, 'kind')
      printAssets((await svc.listAssets(slug!)).filter((a) => !kind || a.kind === kind))
      return 0
    }
    case 'plan': {
      const [slug] = need(p, 1, 'plan <slug> [--refresh-prompts]')
      const refresh = !!(p.flags.force || p.flags['refresh-prompts'])
      const run = await svc.nextRun(slug!)
      const art = await svc.enqueue(slug!, TASKS.artPlan, 'all', run, { body: { force: refresh, explicit: true }, priority: 1 })
      await svc.enqueue(slug!, TASKS.musicPlan, 'all', run, { depends_on: [art], body: { force: refresh }, priority: 1 })
      return waitAndReport(svc, slug!)
    }
    case 'generate': {
      const [slug] = need(p, 1, 'generate <slug> [--kind k] [--only id] [--force]')
      await svc.reconcileAssets(slug!)
      let ids: string[] | undefined
      const only = flag(p, 'only')
      const kind = flag(p, 'kind')
      if (only || kind) {
        const assets = await svc.listAssets(slug!)
        ids = assets.filter((a) => (!only || only.split(',').includes(a.id)) && (!kind || a.kind === kind) && !a.orphaned).map((a) => a.id)
        if (!ids.length) throw new Error(`no asset matches ${only ? `--only ${only}` : ''} ${kind ? `--kind ${kind}` : ''}`.trim())
      }
      const run = await svc.nextRun(slug!)
      await svc.enqueue(slug!, TASKS.generate, 'all', run, { body: { dispatch: true, force: !!p.flags.force, ids, tail: false }, priority: 1 })
      const code = await waitAndReport(svc, slug!)
      printAssets((await svc.listAssets(slug!)).filter((a) => !ids || ids.includes(a.id)))
      return code
    }
    case 'asset': {
      const sub = p.args[0]
      const [, slug, id, extra] = p.args
      if (!sub || !slug || !id) throw new Error('usage: asset replace|pick|regen|lock|unlock <slug> <id> ...')
      const rebuild = p.flags['no-build'] !== true
      switch (sub) {
        case 'replace': {
          if (!extra) throw new Error('usage: asset replace <slug> <id> <file>')
          await svc.replaceAsset(slug, id, path.resolve(extra), { rebuild })
          out(`${id}: ${path.resolve(extra)} is now the asset (custom, locked)`)
          return rebuild ? waitAndReport(svc, slug) : 0
        }
        case 'pick': {
          const n = Number(extra)
          if (!Number.isInteger(n) || n < 1) throw new Error('usage: asset pick <slug> <id> <version>')
          await svc.pickAssetVersion(slug, id, n, { rebuild })
          out(`${id}: version ${n} selected`)
          return rebuild ? waitAndReport(svc, slug) : 0
        }
        case 'import': {
          if (!extra) throw new Error('usage: asset import <slug> <id> <file> [--no-process] [--bg key|birefnet|none]')
          const bg = flag(p, 'bg')
          if (bg !== undefined && !['key', 'birefnet', 'none'].includes(bg)) throw new Error('--bg must be key, birefnet or none')
          const r = await svc.importAsset(slug, id, extra, { process: p.flags['no-process'] ? 'none' : 'auto', removeBackground: bg as 'key' | 'birefnet' | 'none' | undefined, trim: p.flags['no-trim'] ? false : undefined, pixelate: p.flags['no-pixelate'] ? false : undefined, rebuild })
          out(`${id}: version ${r.version.n} imported from ${path.resolve(extra)} (custom:import, locked)${r.version.warnings?.length ? `; ${r.version.warnings.join('; ')}` : ''}`)
          return rebuild ? waitAndReport(svc, slug) : 0
        }
        case 'regen': {
          const seed = flag(p, 'seed')
          const r = await svc.regenerateAsset(slug, id, { prompt: flag(p, 'prompt'), engine: flag(p, 'engine'), seed: seed === undefined ? undefined : Number(seed), rebuild, sprites: !!p.flags.sprites })
          if (r.staleSprites.length) out(`these sprites were made from the old sheet: ${r.staleSprites.join(', ')} (asset regen ${id} --sprites makes them again)`)
          const code = await waitAndReport(svc, slug)
          printAssets((await svc.listAssets(slug)).filter((a) => a.id === id))
          return code
        }
        case 'lock':
        case 'unlock':
          await svc.lockAsset(slug, id, sub === 'lock')
          out(`${id}: ${sub}ed`)
          return 0
        default:
          throw new Error('usage: asset replace|pick|regen|lock|unlock <slug> <id> ...')
      }
    }
    case 'clear-queue': {
      const r = await svc.clearQueue(p.args[0] ?? null)
      out(`${r.dropped} queued job(s) dropped${r.projects.length ? `; steps skipped in ${r.projects.join(', ')}` : ''}`)
      return 0
    }
    case 'build': {
      const [slug] = need(p, 1, 'build <slug>')
      await svc.enqueueBuild(slug!)
      const code = await waitAndReport(svc, slug!)
      const b = (await svc.detail(slug!)).build
      if (b) {
        out(`game: ${b.gameDir} (theme ${b.theme}, ${b.placeholders?.length ?? 0} placeholder image(s))`)
        for (const m of b.messages) out(`  ${m}`)
      }
      return code
    }
    case 'lint': {
      const [slug] = need(p, 1, 'lint <slug>')
      await svc.enqueueLint(slug!)
      const code = await waitAndReport(svc, slug!)
      const l = (await svc.detail(slug!)).lint
      if (l) {
        out(l.skipped ? l.messages.join('\n') : l.ok ? 'lint: clean' : `lint: ${l.messages.length} problem(s)`)
        if (!l.ok && !l.skipped) for (const m of l.messages) out(`  ${m}`)
        if (l.statistics) out(l.statistics)
        return code || (l.skipped ? 3 : l.ok ? 0 : 1) // 3: lint could not run (no SDK, not built)
      }
      return code
    }
    case 'play': {
      const [slug] = need(p, 1, 'play <slug>')
      const r = await svc.runGame(slug!)
      out(`started the game (pid ${r.pid ?? '?'})`)
      return 0
    }
    case 'voice': {
      if (p.args[0] === 'status') {
        const st = await svc.voiceStatus()
        if (!st.ok) {
          out(`VibeTTS (${st.url}) is not reachable: ${st.error}`)
          return 1
        }
        out(`VibeTTS (${st.url}) is reachable, ${st.voices.length} voice(s); Supertonic is ${st.supertonicInstalled ? 'installed' : 'NOT installed (download it in VibeTTS Settings > Supertonic: it reads Croatian and the other languages)'}:`)
        for (const v of st.voices) out(`  ${v.id.padEnd(16)} ${v.engine.padEnd(11)} ${(v.languages.length > 4 ? `${v.languages.length} languages` : v.languages.join(',')).padEnd(14)} ${v.label}`)
        return 0
      }
      if (p.args[0] === 'set') {
        const [, setSlug, speaker, setLang, voice] = need(p, 5, 'voice set <slug> <speaker> <lang> <voice>')
        const setCode = assertKnownLang(setLang!)
        const r = await svc.setVoice(setSlug!, speaker!, setCode, voice!)
        out(`${speaker} (${setCode}): ${r.voice}, preview ${r.file}`)
        return 0
      }
      if (p.args[0] === 'import') {
        const [, impSlug] = need(p, 2, 'voice import <slug> --lang hr (--folder <dir> | --beat <beatId> --file <clip>)')
        const impLang = lang(p)
        if (!impLang) throw new Error('usage: voice import <slug> --lang hr (--folder <dir> | --beat <beatId> --file <clip>)')
        const folder = flag(p, 'folder')
        const file = flag(p, 'file')
        const beat = flag(p, 'beat')
        if (!folder && !(file && beat)) throw new Error('give --folder <dir>, or --beat <beatId> with --file <clip>')
        const r = await svc.importVoice(impSlug!, impLang, folder ? { folder: path.resolve(folder) } : { beatId: beat!, file: path.resolve(file!) })
        out(`${r.imported.length} clip(s) imported for ${impLang}${r.unknown.length ? `; no text beat for: ${r.unknown.join(', ')}` : ''}`)
        return r.imported.length && p.flags['no-build'] !== true ? waitAndReport(svc, impSlug!) : 0
      }
      if (p.args[0] === 'plan') {
        const [, planSlug] = need(p, 2, 'voice plan <slug> [--overwrite]')
        const planIds = await svc.planVoices(planSlug!, { overwrite: !!p.flags.overwrite })
        if (!planIds.length) {
          out('voice is off for this project: set voice.enabled in its project.md (or updateProjectSettings); nothing was planned')
          return 0
        }
        return waitAndReport(svc, planSlug!)
      }
      const [slug] = need(p, 1, 'voice <slug> [--lang hr] [--only <beatId>] [--limit n]')
      const limitFlag = flag(p, 'limit')
      const limit = limitFlag === undefined ? undefined : Number(limitFlag)
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error(`--limit must be a positive whole number, not "${limitFlag}"`)
      const ids = await svc.generateVoice(slug!, { lang: lang(p), beatId: flag(p, 'only'), limit })
      if (!ids.length) {
        out('voice is off for this project: set voice.enabled in its project.md (or updateProjectSettings); nothing was generated')
        return 0
      }
      return waitAndReport(svc, slug!)
    }
    case 'comfy': {
      const sub = p.args[0]
      if (sub === 'free') {
        for (const r of await svc.comfyFree()) out(`${r.lane}: ${r.ok ? 'freed' : `failed (${r.error})`}`)
        return 0
      }
      if (sub !== 'status') throw new Error('usage: comfy status|free')
      const s = await svc.comfyStatus()
      for (const l of s.lanes) out(`${l.url}: ${l.reachable ? `up (running ${l.running}, pending ${l.pending})` : `down (${l.error})`}`)
      if (s.ok) {
        out(`engines ready: ${s.engines.filter((e) => e.ready).map((e) => e.id).join(', ') || 'none'}`)
        for (const e of s.engines.filter((x) => !x.ready)) out(`  not ready: ${e.id} (missing ${e.missing.join(', ')})`)
        out(`custom workflows: ${s.customWorkflows.join(', ') || 'none'}; background removal: ${s.backgroundRemoval.available ? s.backgroundRemoval.models.join(', ') : 'not available'}`)
      }
      return s.ok ? 0 : 1
    }
    case 'settings': {
      const [slug] = need(p, 1, 'settings <slug> [--music-provider ...] [--pixel-provider ...] ...')
      const patch = settingsPatchFromFlags(p)
      const changed = Object.keys(patch).length ? await svc.updateSettings(slug!, patch) : undefined
      const next = changed ? changed.settings : (await svc.store.loadSettings(slug!)).settings
      for (const w of changed?.warnings ?? []) out(`warning: ${w}`)
      const px = resolvePixel(next.art)
      out(`${slug}: art ${next.art.style}${next.art.palette ? ` (palette ${next.art.palette})` : ''}, sprites by ${resolveArtProvider(next.art)}, pixel art by ${resolvePixelProvider(next.art)} at ${px.width}x${px.height}, dither ${px.dither}, outline ${px.outline ? 'on' : 'off'}`)
      out(`${slug}: music by ${resolveMusicProvider(next)}${next.music.provider ? '' : ' (auto)'}, chip ${next.music.chip ?? 'auto'}, ${next.music.tracks} track(s)`)
      return 0
    }
    case 'studios': {
      if (p.args[0] && p.args[0] !== 'status') throw new Error('usage: studios status')
      let code = 0
      for (const s of await svc.studiosStatus()) {
        if (s.ok) out(`${s.name} (${s.url}) is reachable, ${s.tools} tool(s)`)
        else {
          out(`${s.name} (${s.url}) is not reachable: ${s.error}`)
          code = 1
        }
      }
      return code
    }
    case 'studio': {
      if (p.args[0] !== 'open') throw new Error('usage: studio open <slug> <assetId> [--wait] [--via launch|mcp] [--timeout seconds]')
      const [, slug, id] = need(p, 3, 'studio open <slug> <assetId> [--wait] [--via launch|mcp] [--timeout seconds]')
      const via = flag(p, 'via')
      if (via !== undefined && via !== 'launch' && via !== 'mcp') throw new Error('--via must be launch or mcp')
      let saved: (() => void) | undefined
      const first = new Promise<void>((resolve) => (saved = resolve))
      const r = await svc.openInStudio(slug!, id!, { via: via as 'launch' | 'mcp' | undefined, rebuild: p.flags['no-build'] !== true, onVersion: (_e, v) => {
        out(`${id}: version ${v.n} saved (${v.file}), custom and locked`)
        saved?.()
      } })
      out(r.message)
      out(`editing a copy: ${r.source}`)
      if (!p.flags.wait) return 0
      const secs = Number(flag(p, 'timeout') ?? 600)
      const got = await Promise.race([first.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), secs * 1000))])
      if (!got) {
        out(`no save within ${secs} s`)
        return 1
      }
      return p.flags['no-build'] === true ? 0 : waitAndReport(svc, slug!)
    }
    case 'themes': {
      for (const t of svc.listThemes()) out(`${t.name.padEnd(14)} ${t.label.padEnd(16)} ${t.description}`)
      return 0
    }
    default:
      out(USAGE)
      return p.command ? 2 : 0
  }
}

/** The entry point of the VN CLI: starts a headless engine, runs the command, stops the engine. */
export async function runCli(argv: readonly string[]): Promise<number> {
  const p = parseCliArgs(argv)
  if (p.flags.help || p.command === 'help' || !p.command) {
    out(USAGE)
    return 0
  }
  let engine: Engine
  try {
    engine = await startHeadless(argv)
  } catch (e) {
    if (!(e instanceof EngineLockHeldError)) throw e
    out(e.message)
    return 1
  }
  try {
    return await runCliWith(engine, p)
  } catch (e) {
    out(`error: ${(e as Error).message}`)
    return 1
  } finally {
    await engine.stop()
  }
}
