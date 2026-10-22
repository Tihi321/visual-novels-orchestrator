import { existsSync, promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import type {
  AlignReportView,
  AssetCounts,
  AssetView,
  BuildResult,
  CustomWorkflowInfo,
  EngineEvent,
  EngineInfo,
  ImportPreview,
  StudioStatusView,
  PipelineStatus,
  PipelineStep,
  ProjectDetail,
  ProjectSettingsPatch,
  ProjectSummary,
  RenpyConfigView,
  StepStatus,
  ThemeInfo,
  VnCommand
} from '../../shared/protocol'
import { assertKnownLang } from '../../shared/languages'
import { CHIPTUNE_ENGINE, FLOW_ENGINE, FLOW_MUSIC_ENGINE, IMAGE_KINDS, hasText, isHandArt, projectSettingsSchema, resolveArtProvider, resolveMusicProvider } from '../../shared/vn'
import type { AssetEntry, AssetVersion, Edition, Lang, ProjectSettings, VnBook } from '../../shared/vn'
import { deriveAssets, LANDSCAPE, PORTRAIT, resolveStylePrompt, styleForKind } from '../assets/derive'
import { importAssetFile } from '../assets/import'
import type { ImportOptions } from '../assets/import'
import { lock, mergeDerived, pickVersion, resolveFile, setCustom, unlock } from '../assets/manifest'
import { listPalettes } from '../assets/palettes'
import { createComfyClient } from '../comfy/client'
import type { ComfyClient } from '../comfy/client'
import { listCustomWorkflows, loadCustomWorkflow, workflowKind } from '../comfy/custom-workflow'
import { ENGINES } from '../comfy/graphs'
import { buildInventory, freeAllLanes } from '../comfy/inventory'
import type { ModelRegistry } from '../models/registry'
import type { ModelRouter } from '../models/router'
import type { JobFile, JobState, JobStore } from '../queue/jobs'
import { JOB_STATES } from '../queue/jobs'
import { androidPreflight as runAndroidPreflight } from '../renpy/android'
import { run as runRenpyGame, sdkExists, sdkPython } from '../renpy/run'
import { findTheme, listThemes } from '../themes/load'
import { pickTheme } from '../themes/pick'
import { themeFontFaces, themePreviewCss } from '../themes/emit'
import { ROLES } from '../../shared/schemas'
import type { SettingsConfig } from '../../shared/schemas'
import { findAppDirs } from './appdirs'
import type { AppDirs } from './appdirs'
import type { AlignReport } from './align'
import { defaultCues } from '../renpy/stage'
import type { SceneTransition, Slot, StageCues } from '../renpy/stage'
import { MAX_SECONDS, MIN_SECONDS } from './agents/composer'
import type { MusicPlan } from './agents/composer'
import { buildEdition, importBook, textSample } from './import'
import { expressionsOf } from './expressions'
import { detectLanguage } from './lang'
import { loadLanguageConfig } from './languages-config'
import { applyStoryOps, buildBook, storySummary, syncEdition, validateBook } from './story'
import type { StoryInput, StoryOp } from './story'
import { listBooks } from './reader'
import type { BookSummary } from './reader'
import { ProjectStore, assertSlug, dataFolders, loadComfyConfigFor, loadRenpyConfig, projectSlug, renpyConfigSchema } from './project'
import { readMd, writeMd } from '../store/atomic'
import { jobId, ROLE_OF, runOf, STEP_OF_TASK, stepIndex, TASKS } from './pipeline'
import type { VnTask } from './pipeline'
import { coverId, sheetId, spriteId, voiceRefId } from './ids'
import { clientFor, loadVoiceConfig } from '../voice/config'
import type { VoiceConfig } from '../voice/config'
import { importVoiceClips, previewVoice, setVoice } from '../voice/jobs'
import { previewFlowVoice, setFlowVoice } from '../voice/flow'
import type { VoiceImportResult, VoicePreview } from '../voice/jobs'
import type { VibeTtsClient } from '../voice/vibetts'
import { chiptuneClientFor, flowClientFor, flowStartHint, loadStudiosConfig, pixelClientFor, startHint, studioRepo, studioUrl, STUDIO_NAMES } from '../studios/config'
import type { StudioId, StudiosConfig } from '../studios/config'
import type { ChiptuneClient } from '../studios/chiptune'
import type { FlowClient } from '../studios/flow'
import { packagesDirOf, solvePuzzle } from '../puzzles/python'
import type { PuzzleEntry, PuzzleProof } from '../../shared/puzzle'
import type { PuzzlePython } from '../puzzles/python'
import type { ServiceStarter } from '../studios/autostart'
import type { PixelClient } from '../studios/pixel'
import type { Watch } from '../studios/launch'
import { openAssetInStudio } from './roundtrip'
import type { OpenOptions, OpenResult } from './roundtrip'

/** What `restylePrompts` did, by asset id. */
export interface RestyleResult {
  /** Prompts that got the new style words. */
  restyled: string[]
  /** Prompts that do not start with the old style words (written with other words): plan them again. */
  kept: string[]
  /** Assets that have a version already: still in the old style until they are generated again. */
  generated: string[]
}

/** What the VN pipeline gets from the engine. */
export interface VnDeps {
  dataDir: string
  log: (message: string) => void
  emit: (e: EngineEvent) => void
  registry: ModelRegistry
  router: ModelRouter
  jobs: JobStore
  getSettings: () => SettingsConfig
  /** Where the Scriptorium books are (`~` resolved). Default: `~/Scriptorium`. */
  getScriptoriumDir?: () => string
  /** Wakes the scheduler after jobs were enqueued. */
  kick?: () => void
  /** A ComfyUI client (tests pass a fake). Default: one made from `config/comfy.md`. */
  comfy?: ComfyClient | (() => ComfyClient | Promise<ComfyClient>)
  /** A VibeTTS client (tests pass a fake). Default: one made from `config/voice.md`. */
  vibetts?: VibeTtsClient
  /** A Pixel Studio client (tests pass a fake). Default: one made from `config/studios.md`. */
  pixel?: PixelClient
  /** A Chiptune Studio client (tests pass a fake). Default: one made from `config/studios.md`. */
  chiptune?: ChiptuneClient
  /** A flow-music-mcp client (tests pass a fake). Default: one made from `config/studios.md`. */
  flow?: FlowClient
  /** Starts Pixel Studio, Chiptune Studio and ComfyUI when a job finds them down (tests pass a fake, or none). */
  starter?: ServiceStarter
  /** The folders that ship with the app. Default: found relative to this code. */
  dirs?: Partial<AppDirs>
}

const nowIso = () => new Date().toISOString()
const SCENE_TRANSITIONS: SceneTransition[] = ['dissolve', 'fade', 'none']
const SLOTS: Slot[] = ['left', 'center', 'right']

/** The engine id a kind of asset is generated with, from the project settings. */
export function engineFor(kind: AssetEntry['kind'], settings: ProjectSettings, refs?: string[]): string | null {
  switch (kind) {
    case 'cg':
      if (settings.art.provider === 'flow') return FLOW_ENGINE
      // a picture with characters is made from their sheets by the edit engine, one without by the generator
      return refs?.length ? settings.art.editor : settings.art.generator
    case 'ambience':
      return settings.sound.ambienceEngine
    case 'sfx':
      return settings.sound.sfxEngine ?? null
    case 'background':
    case 'sheet':
    case 'cover':
      return settings.art.provider === 'flow' ? FLOW_ENGINE : settings.art.generator
    case 'sprite':
      return settings.art.provider === 'flow' ? FLOW_ENGINE : settings.art.editor
    case 'music':
      return resolveMusicProvider(settings) === 'flow' ? FLOW_MUSIC_ENGINE : resolveMusicProvider(settings) === 'chiptune' ? CHIPTUNE_ENGINE : settings.music.engine
    default:
      return null
  }
}

export interface JobCounts {
  queued: number
  running: number
  done: number
  failed: number
}

/**
 * Everything the app does with VN projects: queries, edits, and enqueueing the pipeline. The job handlers (`handlers.ts`) call
 * it for the shared parts. The UI commands, the CLI and the MCP server all go through it.
 */
export class VnService {
  readonly store: ProjectStore
  readonly dirs: AppDirs
  private readonly updateTimers = new Map<string, NodeJS.Timeout>()
  private comfyOverride: VnDeps['comfy']
  private readonly watches = new Map<string, Watch>()

  constructor(readonly deps: VnDeps) {
    this.store = new ProjectStore(deps.dataDir)
    this.dirs = { ...findAppDirs(), ...(deps.dirs ?? {}) }
    this.comfyOverride = deps.comfy
  }

  get dataDir(): string {
    return this.deps.dataDir
  }

  log(message: string): void {
    this.deps.log(`vn: ${message}`)
  }

  emit(e: EngineEvent): void {
    this.deps.emit(e)
  }

  /** The Scriptorium data folder with `~` resolved. */
  scriptoriumDir(): string {
    return this.deps.getScriptoriumDir?.() ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Scriptorium')
  }

  /**
   * The ComfyUI client. With `autoStart` (job paths only, never a status check) a lane that does not answer at all is started first, when
   * `config/autostart.md` allows it. A client given to the engine (tests) is used as it is.
   */
  async comfy(o: { autoStart?: boolean; log?: (m: string) => void } = {}): Promise<ComfyClient> {
    const override = this.comfyOverride
    if (override) return typeof override === 'function' ? override() : override
    const starter = o.autoStart ? this.deps.starter : undefined
    return createComfyClient({
      config: await loadComfyConfigFor(this.dataDir),
      dataDir: this.dataDir,
      ...(starter
        ? {
            ensureLane: async (lane: string, signal?: AbortSignal) => {
              const id = await starter.idForUrl(lane)
              return id ? starter.ensure(id, lane, { signal, log: o.log }) : 'not a service VN Studio starts'
            }
          }
        : {})
    })
  }

  /** Stops the file watchers of the studio round trips (the engine is stopping). */
  dispose(): void {
    for (const w of this.watches.values()) w.stop()
    this.watches.clear()
  }

  /** Remembers a round-trip watcher under a key (one per asset: a new one replaces the old). */
  keepWatch(key: string, watch: Watch): void {
    this.watches.get(key)?.stop()
    this.watches.set(key, watch)
  }

  async renpyResolution(): Promise<{ w: number; h: number }> {
    return (await loadRenpyConfig(this.dataDir)).resolution
  }

  // ---- sources and import ----

  async listSourceBooks(): Promise<BookSummary[]> {
    return listBooks(this.scriptoriumDir())
  }

  /** A folder, or the slug (or folder name) of a book in the Scriptorium library, to the book folder. */
  async resolveSource(source: string): Promise<string> {
    const direct = path.resolve(source)
    try {
      if (statSync(direct).isDirectory()) return direct
    } catch {
      /* not a folder: maybe a library slug */
    }
    const books = await this.listSourceBooks()
    const hit = books.find((b) => b.slug === source || path.basename(b.path) === source)
    if (hit) return hit.path
    throw new Error(`"${source}" is not a book folder and not a book in the Scriptorium library (${this.scriptoriumDir()})`)
  }

  async previewImport(source: string): Promise<ImportPreview> {
    const folder = await this.resolveSource(source)
    const r = await importBook(folder, { prove: await this.importProver() })
    return {
      source,
      path: folder,
      slug: projectSlug(r.book.slug),
      title: r.book.title,
      format: r.book.format,
      kind: r.book.kind,
      detected: { lang: r.detected.lang, confidence: r.detected.confidence },
      chapters: r.book.chapters.length,
      characters: r.book.characters.length,
      places: r.book.places.length,
      uncertain: r.uncertain.length,
      warnings: r.book.warnings
    }
  }

  /**
   * Imports a book into a project (new, or the same book again: the settings, other editions and assets are kept).
   * `lang` is the language you confirmed; without it the detected one is used.
   */
  async importProject(source: string, opts: { lang?: Lang } = {}): Promise<{ slug: string; preview: ImportPreview }> {
    if (opts.lang !== undefined) await this.knownLang(opts.lang)
    else await loadLanguageConfig(this.dataDir, (m) => this.log(m))
    const folder = await this.resolveSource(source)
    const r = await importBook(folder, { lang: opts.lang, prove: await this.importProver() })
    let slug = projectSlug(r.book.slug)
    let existing: ProjectSettings | undefined
    // the same slug from another folder is another book: it gets a number
    for (let i = 2; ; i++) {
      if (!(await this.store.exists(slug))) break
      const cur = (await this.store.loadSettings(slug)).settings
      if (path.resolve(cur.source) === folder) {
        existing = cur
        break
      }
      slug = `${projectSlug(r.book.slug)}-${i}`
    }
    const book: VnBook = { ...r.book, slug }
    const editions = new Set<Lang>([...(existing?.editions ?? []), book.primaryLang])
    const settings: ProjectSettings = projectSettingsSchema.parse({
      ...(existing ?? {}),
      slug,
      source: folder,
      primaryLang: book.primaryLang,
      editions: [...editions].sort()
    })
    await this.store.withLock(slug, async () => {
      await this.store.saveSettings(settings)
      await this.store.saveBook(slug, book)
      await this.store.saveEdition(slug, { ...r.edition, lang: book.primaryLang })
      await this.store.saveUncertain(slug, r.uncertain)
      await this.store.writeJson(slug, 'import.json', { at: nowIso(), source: folder, detected: r.detected, uncertain: r.uncertain.length, ...(r.aliases.length ? { aliases: r.aliases } : {}) })
    })
    const preview: ImportPreview = {
      source,
      path: folder,
      slug,
      title: book.title,
      format: book.format,
      kind: book.kind,
      detected: { lang: r.detected.lang, confidence: r.detected.confidence },
      chapters: book.chapters.length,
      characters: book.characters.length,
      places: book.places.length,
      uncertain: r.uncertain.length,
      warnings: book.warnings
    }
    this.log(`imported ${slug} from ${folder}: ${book.primaryLang} (detected ${r.detected.lang}, confidence ${r.detected.confidence}), ${book.chapters.length} chapter(s), ${r.uncertain.length} item(s) for the script-analyst`)
    this.emit({ type: 'import.done', slug, preview })
    await this.emitProject(slug)
    return { slug, preview }
  }

  // ---- story: make and edit a book without a book folder ----

  /**
   * Makes a project from a story written as JSON (no book folder: `source` is empty). The language is `opts.lang`, else the story's
   * `lang`, else detected from the text. The asset list is derived at once; the art step plans the prompts later.
   */
  async createProject(input: StoryInput, opts: { lang?: Lang; settings?: ProjectSettingsPatch } = {}): Promise<{ slug: string; lang: Lang; warnings: string[]; assets: { added: string[]; orphaned: string[] } }> {
    const base = projectSlug(input.slug ?? input.title)
    let slug = base
    for (let i = 2; await this.store.exists(slug); i++) slug = `${base}-${i}`
    const draft = buildBook(input, { slug, lang: 'en' }).book
    const detected = opts.lang || input.lang ? null : detectLanguage(textSample(draft.chapters))
    const lang = await this.knownLang(opts.lang ?? input.lang ?? detected!.lang)
    const book: VnBook = { ...draft, primaryLang: lang }
    const settings: ProjectSettings = projectSettingsSchema.parse({ slug, source: '', primaryLang: lang, editions: [lang] })
    await this.store.withLock(slug, async () => {
      await this.store.saveSettings(settings)
      await this.store.saveBook(slug, book)
      await this.store.saveEdition(slug, buildEdition(lang, book.title, book.chapters, book.characters))
      await this.store.saveUncertain(slug, [])
      await this.store.writeJson(slug, 'import.json', { at: nowIso(), source: 'mcp', created: true, ...(detected ? { detected } : {}) })
    })
    const assets = await this.reconcileAssets(slug)
    if (opts.settings) await this.updateSettings(slug, opts.settings)
    this.log(`created ${slug} over MCP: ${lang}${detected ? ` (detected, confidence ${detected.confidence})` : ''}, ${book.chapters.length} chapter(s), ${book.characters.length} character(s)`)
    this.emit({
      type: 'import.done',
      slug,
      preview: {
        source: '',
        path: '',
        slug,
        title: book.title,
        format: book.format,
        kind: book.kind,
        detected: { lang, confidence: detected?.confidence ?? 1 },
        chapters: book.chapters.length,
        characters: book.characters.length,
        places: book.places.length,
        uncertain: 0,
        warnings: book.warnings
      }
    })
    await this.emitProject(slug)
    return { slug, lang, warnings: book.warnings, assets }
  }

  /** The book of a project, or one chapter of it (by number) with the numbers of the book. */
  async getStory(slug: string, chapter?: number): Promise<{ book: VnBook } | { summary: ReturnType<typeof storySummary>; chapter: VnBook['chapters'][number] }> {
    const book = await this.store.loadBook(slug)
    if (chapter === undefined) return { book }
    const ch = book.chapters.find((c) => c.n === chapter)
    if (!ch) throw new Error(`${slug} has no chapter ${chapter} (chapters: ${book.chapters.map((c) => c.n).join(', ')})`)
    return { summary: storySummary(book), chapter: ch }
  }

  /**
   * Edits the story with a list of operations, all or nothing: the book is checked after them and an error saves nothing. The primary
   * edition is rebuilt from the book, the other editions lose the text of what was removed, and the asset list follows. Unlocked
   * assets whose subject changed lose their prompt when they have no image yet (`cleared`) or are listed as `stale` when they have
   * one; locked and custom ones are left alone (`keptLocked`). The game needs a new build to show the change.
   */
  async editStory(
    slug: string,
    ops: StoryOp[]
  ): Promise<{ book: ReturnType<typeof storySummary>; warnings: string[]; created: string[]; assets: { added: string[]; orphaned: string[]; cleared: string[]; stale: string[]; keptLocked: string[]; keptByHand: string[] } }> {
    if (!ops.length) throw new Error('give at least one operation')
    const r = await this.store.withLock(slug, async () => {
      const { settings } = await this.store.loadSettings(slug)
      const result = applyStoryOps(await this.store.loadBook(slug), ops)
      const v = validateBook(result.book)
      if (v.errors.length) throw new Error(`the edit leaves the story with problems, so nothing was saved:\n${v.errors.map((e) => `- ${e}`).join('\n')}`)
      result.book.warnings = v.warnings
      await this.store.saveBook(slug, result.book)
      await this.store.saveEdition(slug, buildEdition(settings.primaryLang, result.book.title, result.book.chapters, result.book.characters))
      for (const lang of await this.store.editionLangs(slug)) {
        if (lang !== settings.primaryLang) await this.store.saveEdition(slug, syncEdition(await this.store.loadEdition(slug, lang), result.book))
      }
      // cues.json and music.json: drop what points at a scene, beat or chapter that is gone (the stage and music steps add defaults for new ones)
      const book = result.book
      const sceneIds = new Set(book.chapters.flatMap((c) => c.scenes.map((s) => s.id)))
      const castIds = new Set(book.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats.filter((b) => b.type === 'cast').map((b) => b.id))))
      const beatIds = new Set(book.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats.map((b) => b.id))))
      const chapterNs = new Set(book.chapters.map((c) => c.n))
      const keep = <T>(rec: Record<string, T>, ok: (k: string) => boolean): Record<string, T> => Object.fromEntries(Object.entries(rec).filter(([k]) => ok(k)))
      const cues = await this.store.readJson<StageCues>(slug, 'cues.json')
      if (cues) {
        await this.store.writeJson(slug, 'cues.json', {
          ...cues,
          chapters: keep(cues.chapters ?? {}, (k) => chapterNs.has(Number(k))),
          scenes: keep(cues.scenes ?? {}, (k) => sceneIds.has(k)),
          casts: keep(cues.casts ?? {}, (k) => castIds.has(k)),
          ...(cues.beats ? { beats: keep(cues.beats, (k) => beatIds.has(k)) } : {})
        })
      }
      const music = await this.store.readJson<MusicPlan>(slug, 'music.json')
      if (music) await this.store.writeJson(slug, 'music.json', { ...music, chapters: keep(music.chapters ?? {}, (k) => chapterNs.has(Number(k))), ...(music.scenes ? { scenes: keep(music.scenes, (k) => sceneIds.has(k)) } : {}) })
      return result
    })
    const { added, orphaned } = await this.reconcileAssets(slug)
    const subject = new Set([
      ...r.affected.chars.flatMap((k) => [sheetId(k), ...expressionsOf(r.book, r.book.characters.find((c) => c.key === k)).map((e) => spriteId(k, e))]),
      ...r.affected.backgrounds,
      ...(r.affected.cover ? [coverId] : [])
    ])
    const cleared: string[] = []
    const stale: string[] = []
    const keptLocked: string[] = []
    const keptByHand: string[] = []
    await this.store.withLock(slug, async () => {
      const manifest = await this.store.loadAssets(slug)
      const assets = manifest.assets.map((a) => {
        if (!subject.has(a.id)) return a
        if (a.locked || a.source === 'custom') keptLocked.push(a.id)
        else if (a.versions.length) stale.push(a.id)
        else if (a.promptByHand) keptByHand.push(a.id)
        else if (a.prompt) {
          cleared.push(a.id)
          return { ...a, prompt: '' }
        }
        return a
      })
      if (cleared.length) await this.store.saveAssets(slug, { assets })
    })
    this.log(`edited the story of ${slug}: ${ops.length} operation(s), ${cleared.length} prompt(s) cleared, ${stale.length} asset(s) stale`)
    await this.emitProject(slug)
    return { book: storySummary(r.book), warnings: r.book.warnings, created: r.created, assets: { added, orphaned, cleared, stale, keptLocked, keptByHand } }
  }

  // ---- projects ----

  async listProjects(): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = []
    for (const slug of await this.store.slugs()) {
      try {
        out.push(await this.summary(slug))
      } catch (e) {
        this.log(`project ${slug} could not be read: ${(e as Error).message}`)
      }
    }
    return out
  }

  async pipelineStatus(slug: string): Promise<PipelineStatus | null> {
    return this.store.readJson<PipelineStatus>(slug, 'pipeline.json')
  }

  /** The book without a vn.json yet (a project whose import failed halfway) gives a bare summary. */
  async summary(slug: string): Promise<ProjectSummary> {
    const { settings } = await this.store.loadSettings(slug)
    const book: VnBook | null = await this.store.loadBook(slug).catch(() => null)
    const manifest = await this.store.loadAssets(slug).catch(() => ({ assets: [] as AssetEntry[] }))
    const orphans = book ? this.orphanIds(book, settings, manifest.assets) : new Set<string>()
    const counts: AssetCounts = { total: 0, ready: 0, missing: 0, locked: 0, custom: 0 }
    for (const a of manifest.assets) {
      if (orphans.has(a.id)) continue
      const file = this.store.resolveAsset(slug, a)
      if (isHandArt(settings.art) && a.kind === 'sheet' && !file) continue // a sheet is only a reference for the person drawing
      counts.total++
      if (file) counts.ready++
      else counts.missing++
      if (a.locked) counts.locked++
      if (a.source === 'custom') counts.custom++
    }
    let updatedAt = nowIso()
    try {
      updatedAt = new Date(Math.max(...['project.md', 'assets.json', 'pipeline.json', 'vn.json'].map((f) => (existsSync(this.store.file(slug, f)) ? statSync(this.store.file(slug, f)).mtimeMs : 0)))).toISOString()
    } catch {
      /* now */
    }
    return {
      slug,
      title: book?.title ?? slug,
      format: book?.format ?? '',
      kind: book?.kind ?? 'linear',
      ...(book?.genre ? { genre: book.genre } : {}),
      primaryLang: settings.primaryLang,
      editions: settings.editions,
      theme: settings.theme,
      chapters: book?.chapters.length ?? 0,
      characters: book?.characters.length ?? 0,
      places: book?.places.length ?? 0,
      voice: settings.voice.enabled,
      assets: counts,
      warnings: book?.warnings.length ?? 0,
      pipeline: await this.pipelineStatus(slug),
      updatedAt
    }
  }

  async detail(slug: string): Promise<ProjectDetail> {
    const { settings } = await this.store.loadSettings(slug)
    const book = await this.store.loadBook(slug)
    const themes = listThemes(this.dirs.themes).themes.map((t) => t.theme.name)
    return {
      summary: await this.summary(slug),
      settings,
      book,
      build: await this.store.readJson<BuildResult>(slug, 'build.json'),
      lint: await this.store.readJson<BuildResult>(slug, 'lint.json'),
      resolvedTheme: pickTheme(book, settings, themes),
      jobs: await this.jobCounts(slug)
    }
  }

  async jobCounts(slug: string): Promise<JobCounts> {
    const counts: JobCounts = { queued: 0, running: 0, done: 0, failed: 0 }
    for (const state of JOB_STATES) counts[state] = (await this.deps.jobs.ids(state)).filter((id) => id.startsWith(`${slug}--`)).length
    return counts
  }

  /** Tells the UI the summary changed. Calls within 250 ms of each other send one event. */
  scheduleProjectUpdate(slug: string): void {
    if (this.updateTimers.has(slug)) return
    const t = setTimeout(() => {
      this.updateTimers.delete(slug)
      void this.emitProject(slug)
    }, 250)
    t.unref?.()
    this.updateTimers.set(slug, t)
  }

  async emitProject(slug: string): Promise<void> {
    try {
      this.emit({ type: 'project.updated', slug, project: await this.summary(slug) })
    } catch {
      /* the project is gone */
    }
  }

  /** The project's own models per role, and whether jobs can use each now (`router.whyUnusable`). A model that is not usable is skipped: the role's list answers instead. */
  async projectModels(slug: string): Promise<Record<string, { ref: string; usable: boolean; reason?: string }>> {
    const { settings } = await this.store.loadSettings(slug)
    return Object.fromEntries(
      Object.entries(settings.models).map(([role, ref]) => {
        const reason = this.deps.router.whyUnusable(ref, { visionOnly: role === 'art-critic' })
        return [role, reason ? { ref, usable: false, reason } : { ref, usable: true }]
      })
    )
  }

  /**
   * Merges a settings patch (theme, art, music, voice) into project.md and brings the asset list in line with it. `warnings`: a model that was
   * saved but is not usable now (no key, server down ...), so its jobs use the role's list.
   */
  async updateSettings(slug: string, patch: ProjectSettingsPatch): Promise<{ settings: ProjectSettings; warnings: string[]; restyle?: RestyleResult }> {
    const warnings: string[] = []
    const { settings: cur } = await this.store.loadSettings(slug)
    const art: Record<string, unknown> = clearNulls({ ...cur.art, ...(patch.art ?? {}) })
    // the pixel settings are merged field by field (a patch with only the dither keeps the size)
    if (patch.art?.pixel) art.pixel = clearNulls({ ...(cur.art.pixel ?? {}), ...patch.art.pixel })
    const models: Record<string, string> = { ...cur.models }
    for (const [role, ref] of Object.entries(patch.models ?? {})) {
      if (!(ROLES as readonly string[]).includes(role)) throw new Error(`"${role}" is not a role (roles: ${ROLES.join(', ')})`)
      if (ref === null || ref === '') delete models[role]
      else {
        const full = this.deps.registry.resolve(ref)
        const m = this.deps.registry.getModel(full)
        if (!m) throw new Error(`no model "${ref}" (see config/providers.md; a client model is client/claude-code, with the client provider enabled)`)
        if (m.embedding) throw new Error(`"${ref}" is an embedding model`)
        models[role] = full
        const why = this.deps.router.whyUnusable(full, { visionOnly: role === 'art-critic' })
        if (why) warnings.push(`${full}: ${why}; jobs of ${role} will use the role's list`)
      }
    }
    const next = projectSettingsSchema.parse({
      ...cur,
      models,
      theme: patch.theme !== undefined ? patch.theme : cur.theme,
      art,
      music: clearNulls({ ...cur.music, ...(patch.music ?? {}) }),
      voice: { ...cur.voice, ...(patch.voice ?? {}) },
      sound: clearNulls({ ...cur.sound, ...(patch.sound ?? {}) })
    })
    await this.store.saveSettings(next)
    // the style words are baked into each stored prompt: a new style prefix is swapped into the prompts that have not been generated yet
    let restyle: RestyleResult | undefined
    if (patch.art) {
      const book = await this.store.loadBook(slug).catch(() => undefined)
      if (book) {
        const was = resolveStylePrompt(book, cur)
        const now = resolveStylePrompt(book, next)
        if (was !== now) restyle = await this.restylePrompts(slug, was, now)
      }
    }
    if (patch.art || patch.music || patch.voice || patch.sound) await this.reconcileAssets(slug)
    if (patch.models) this.deps.kick?.()
    await this.emitProject(slug)
    return { settings: next, warnings, ...(restyle ? { restyle } : {}) }
  }

  /**
   * A new style prefix: in every image prompt that has no version yet (not locked, generated, set by hand or planned) that starts with the old
   * prefix, the old words become the new ones. Sprites have no style prefix. `kept`: prompts that do not start with the old prefix (the art-director
   * wrote them with other words: `vno_plan {refreshPrompts: true}` writes them again). `generated`: assets that have a version already, still in
   * the old style (`vno_asset_regen` makes them again). Queued generate jobs read the prompt when they run, so they use the new one.
   */
  async restylePrompts(slug: string, oldPrefix: string, newPrefix: string): Promise<RestyleResult> {
    const result: RestyleResult = { restyled: [], kept: [], generated: [] }
    const kinds = new Set(['background', 'sheet', 'cover'])
    await this.store.withLock(slug, async () => {
      const cur = await this.store.loadAssets(slug)
      const assets = cur.assets.map((a) => {
        if (!kinds.has(a.kind) || a.locked || a.source !== 'generated') return a
        if (a.versions.length > 0) {
          result.generated.push(a.id)
          return a
        }
        if (!a.prompt) return a
        const from = styleForKind(oldPrefix, a.kind)
        if (!a.prompt.startsWith(from)) {
          result.kept.push(a.id)
          return a
        }
        result.restyled.push(a.id)
        return { ...a, prompt: styleForKind(newPrefix, a.kind) + a.prompt.slice(from.length) }
      })
      if (result.restyled.length) await this.store.saveAssets(slug, { assets })
    })
    if (result.restyled.length) await this.emitProject(slug)
    return result
  }

  /**
   * Drops the queue: deletes the queued jobs of a project (or of every project) and marks the pipeline steps that were queued or running as
   * skipped, so a later resume has nothing old to start again. Running jobs are not touched (stop them first: `vno_stop_now`).
   */
  async clearQueue(slug: string | null): Promise<{ dropped: number; projects: string[] }> {
    if (slug) assertSlug(slug)
    const ids = (await this.deps.jobs.ids('queued')).filter((id) => !slug || id.startsWith(`${slug}--`))
    for (const id of ids) await fs.rm(this.deps.jobs.file('queued', id), { force: true })
    const projects = slug ? [slug] : await this.store.slugs()
    const touched: string[] = []
    for (const s of projects) {
      const st = await this.store.readJson<PipelineStatus>(s, 'pipeline.json').catch(() => null)
      if (!st) continue
      let changed = false
      for (const [step, v] of Object.entries(st.steps) as [PipelineStep, StepStatus][]) {
        if (v.status !== 'queued' && v.status !== 'running') continue
        await this.setStep(s, step, 'skipped', 'dropped (vno_stop_now)')
        changed = true
      }
      if (changed) touched.push(s)
    }
    return { dropped: ids.length, projects: touched }
  }

  /** Book ids of the assets the book no longer needs (kept in the manifest, never deleted). */
  orphanIds(book: VnBook, settings: ProjectSettings, existing: AssetEntry[]): Set<string> {
    const wanted = new Set(deriveAssets(book, settings).map((a) => a.id))
    return new Set(existing.filter((a) => !wanted.has(a.id)).map((a) => a.id))
  }

  /**
   * Derives the asset list from the book and settings and merges it into assets.json: new assets appear, existing ones keep their
   * versions, and an asset that has no file yet follows the engines now set in the project. Returns the ids that were added.
   */
  async reconcileAssets(slug: string): Promise<{ added: string[]; orphaned: string[] }> {
    return this.store.withLock(slug, async () => {
      const { settings } = await this.store.loadSettings(slug)
      const book = await this.store.loadBook(slug)
      const merged = mergeDerived(await this.store.loadAssets(slug), deriveAssets(book, settings))
      const assets = merged.manifest.assets.map((a) => {
        // a cover that is not made yet and has a portrait plan (an older project) is planned landscape now: the menu picture is 16:9
        if (a.kind === 'cover' && a.versions.length === 0 && !a.locked && !a.promptByHand && a.source === 'generated' && ((a.size?.w === PORTRAIT.w && a.size.h === PORTRAIT.h) || /portrait composition/i.test(a.prompt))) {
          a = { ...a, size: { ...LANDSCAPE }, prompt: a.prompt.replace(/portrait composition/gi, 'landscape composition') }
        }
        const engine = engineFor(a.kind, settings, a.refs)
        if (!engine || a.locked || a.source !== 'generated' || a.engine === engine) return a
        // an asset with versions keeps its engine, except music: that follows the project's music provider (chiptune or the configured ComfyUI engine)
        return a.versions.length === 0 || a.kind === 'music' ? { ...a, engine } : a
      })
      await this.store.saveAssets(slug, { assets })
      return { added: merged.added, orphaned: merged.orphaned }
    })
  }

  async deleteProject(slug: string): Promise<void> {
    assertSlug(slug)
    for (const id of await this.deps.jobs.ids('queued')) {
      if (id.startsWith(`${slug}--`)) await fs.rm(this.deps.jobs.file('queued', id), { force: true })
    }
    await this.store.remove(slug)
    this.emit({ type: 'project.deleted', slug })
  }

  // ---- jobs ----

  /** The next run number of a project: one more than the highest `r<n>` in its job ids. */
  async nextRun(slug: string): Promise<number> {
    let max = 0
    for (const state of JOB_STATES) for (const id of await this.deps.jobs.ids(state)) if (id.startsWith(`${slug}--`)) max = Math.max(max, runOf(id))
    return max + 1
  }

  /**
   * Enqueues one job of the VN pipeline (idempotent by id). Returns the id. `priority`: 1 for a request someone made on purpose (an MCP tool,
   * the app), so it runs before the older jobs of the pipeline's own chain (0, the default); dependencies still decide what may start.
   */
  async enqueue(slug: string, task: VnTask, unit: string, run: number, o: { depends_on?: string[]; body?: object; label?: string; vision?: boolean; requested_by?: string; priority?: number; max_attempts?: number } = {}): Promise<string> {
    const id = jobId(slug, task, unit, run)
    await this.deps.jobs.enqueue(
      {
        id,
        task,
        role: ROLE_OF[task],
        book: slug,
        unit,
        round: run,
        depends_on: o.depends_on ?? [],
        ...(o.label ? { label: o.label } : {}),
        ...(o.vision ? { vision: true } : {}),
        ...(o.requested_by ? { requested_by: o.requested_by } : {}),
        ...(o.priority ? { priority: o.priority } : {}),
        ...(o.max_attempts ? { max_attempts: o.max_attempts } : {})
      },
      o.body ? JSON.stringify(o.body) : ''
    )
    this.deps.kick?.()
    return id
  }

  /** Enqueues the director's `vn.pipeline.run`, which enqueues the chain of steps from `from`. */
  async runPipeline(slug: string, from?: PipelineStep, opts: { force?: boolean } = {}): Promise<{ run: number; job: string; from: PipelineStep }> {
    assertSlug(slug)
    if (!(await this.store.exists(slug))) throw new Error(`no project "${slug}"`)
    const hasBook = existsSync(this.store.file(slug, 'vn.json'))
    // a project made over MCP (source '') has nothing to import: it starts at analyse
    const madeOverMcp = (await this.store.loadSettings(slug)).settings.source === ''
    const start: PipelineStep = from ?? (hasBook || madeOverMcp ? 'analyse' : 'import')
    if (!hasBook && start !== 'import') throw new Error(`project "${slug}" has no vn.json: start from the import step`)
    const run = await this.nextRun(slug)
    const job = await this.enqueue(slug, TASKS.pipeline, 'all', run, { body: { from: start, force: !!opts.force }, label: `pipeline from ${start}` })
    await this.setStep(slug, start, 'queued', `run ${run} queued from ${start}`, { reset: { run, from: start } })
    return { run, job, from: start }
  }

  /**
   * Enqueues the build, lint and summary jobs, and before them the voice and stage jobs, from `from` on. `deps` are the job
   * ids they wait for (the asset jobs). Used by the director and by the asset dispatcher.
   */
  async enqueueTail(slug: string, run: number, from: PipelineStep, deps: string[], priority = 0): Promise<string[]> {
    const { settings } = await this.store.loadSettings(slug)
    const ids: string[] = []
    const add = async (task: VnTask, unit: string, depends_on: string[], body?: object) => {
      const id = await this.enqueue(slug, task, unit, run, { depends_on, body, priority })
      ids.push(id)
      const step = STEP_OF_TASK[task]
      if (step) await this.setStep(slug, step, 'queued', 'queued')
      return id
    }
    const at = stepIndex(from)
    let voiceDone: string[] = []
    if (at <= stepIndex('voice') && settings.voice.enabled) {
      const plan = await add(TASKS.voicePlan, 'all', deps)
      const langs = settings.voice.langs.length ? settings.voice.langs : [settings.primaryLang]
      voiceDone = [plan]
      const gens: string[] = []
      for (const lang of langs) gens.push(await add(TASKS.voiceGenerate, lang, [plan]))
      if (gens.length) voiceDone = gens
    }
    let beforeBuild = deps
    if (at <= stepIndex('stage')) beforeBuild = [await add(TASKS.stage, 'all', deps)]
    const build = at <= stepIndex('build') ? await add(TASKS.build, 'all', [...beforeBuild, ...voiceDone]) : undefined
    const lint = await add(TASKS.lint, 'all', build ? [build] : beforeBuild)
    await add(TASKS.summary, 'all', [lint])
    return ids
  }

  /** Enqueues the chain of steps from `from`. Called by the director's `vn.pipeline.run` job. */
  async enqueueChain(slug: string, run: number, from: PipelineStep, force: boolean): Promise<string[]> {
    const ids: string[] = []
    const at = stepIndex(from)
    let prev: string[] = []
    const add = async (task: VnTask, step: PipelineStep, body?: object) => {
      const id = await this.enqueue(slug, task, 'all', run, { depends_on: prev, body })
      ids.push(id)
      prev = [id]
      await this.setStep(slug, step, 'queued', 'queued')
    }
    if (at <= stepIndex('import')) await add(TASKS.import, 'import')
    if (at <= stepIndex('analyse')) await add(TASKS.analyse, 'analyse')
    if (at <= stepIndex('art')) await add(TASKS.artPlan, 'art', { force })
    if (at <= stepIndex('music')) await add(TASKS.musicPlan, 'music', { force })
    if (at <= stepIndex('generate')) {
      await add(TASKS.generate, 'generate', { dispatch: true, force })
      return ids // the dispatcher enqueues the asset jobs and the rest
    }
    ids.push(...(await this.enqueueTail(slug, run, from, [])))
    return ids
  }

  /** Records a pipeline step's state in pipeline.json and tells the UI. */
  async setStep(slug: string, step: PipelineStep, status: StepStatus['status'], message: string, o: { done?: number; total?: number; bump?: boolean; reset?: { run: number; from: PipelineStep } } = {}): Promise<void> {
    try {
      const st = await this.store.withLock(slug, async () => {
        const cur = (await this.store.readJson<PipelineStatus>(slug, 'pipeline.json')) ?? { run: 0, from: step, startedAt: nowIso(), steps: {} }
        const base: PipelineStatus = o.reset ? { run: o.reset.run, from: o.reset.from, startedAt: nowIso(), steps: {} } : cur
        const prev = base.steps[step]
        let done = o.done ?? (status !== 'queued' ? prev?.done : undefined)
        let total = o.total ?? (status !== 'queued' ? prev?.total : undefined)
        let state = status
        if (o.bump) {
          done = (prev?.done ?? 0) + 1
          total = Math.max(prev?.total ?? done, done)
          state = done >= total ? 'done' : 'running'
        }
        const st: StepStatus = { status: state, message, at: nowIso(), ...(done !== undefined ? { done } : {}), ...(total !== undefined ? { total } : {}) }
        base.steps[step] = st
        await this.store.writeJson(slug, 'pipeline.json', base)
        return st
      })
      this.emit({ type: 'pipeline.progress', slug, step, status: st })
      this.scheduleProjectUpdate(slug)
    } catch (e) {
      this.log(`could not record step ${step} of ${slug}: ${(e as Error).message}`)
    }
  }

  /** Counts a finished unit of a step (an asset generated) and returns the new numbers. */
  async bumpStep(slug: string, step: PipelineStep, message: string): Promise<void> {
    await this.setStep(slug, step, 'running', message, { bump: true })
  }

  // ---- editions ----

  /** Reads `config/languages.md`, then checks that the language is known (see `shared/languages.ts`). */
  async knownLang(code: string): Promise<Lang> {
    await loadLanguageConfig(this.dataDir, (m) => this.log(m))
    return assertKnownLang(code)
  }

  /**
   * Adds an edition from a translated book folder. Without `lang` the language of that folder is detected (`detected` says
   * how sure); with it nothing is detected.
   */
  async addEdition(slug: string, source: string, lang?: Lang): Promise<{ job: string; lang: Lang; detected: { lang: Lang; confidence: number } | null }> {
    const { settings } = await this.store.loadSettings(slug)
    if (lang !== undefined) await this.knownLang(lang)
    else await loadLanguageConfig(this.dataDir, (m) => this.log(m))
    const folder = await this.resolveSource(source)
    let detected: { lang: Lang; confidence: number } | null = null
    if (lang === undefined) {
      const d = (await importBook(folder)).detected
      detected = { lang: d.lang, confidence: d.confidence }
      lang = d.lang
    }
    if (lang === settings.primaryLang) {
      throw new Error(`${lang} is the primary language of ${slug}: an edition is another language${detected ? ` (the folder looks like ${lang}; give lang if it is another language)` : ''}`)
    }
    const run = await this.nextRun(slug)
    const job = await this.enqueue(slug, TASKS.editionAdd, lang, run, { body: { source: folder, lang }, label: `add ${lang} edition`, priority: 1 })
    return { job, lang, detected }
  }

  async getEdition(slug: string, lang: Lang): Promise<Edition> {
    return this.store.loadEdition(slug, lang)
  }

  /**
   * Writes the text of another language as JSON (no book folder): a new edition, or entries merged into the existing one
   * (`replace` starts from an empty one). Every key must name a part of the book; text it leaves out stays in the primary language.
   * Returns the edition and how much of the book it covers.
   */
  async setEdition(
    slug: string,
    lang: Lang,
    patch: Partial<Pick<Edition, 'title' | 'chapterTitles' | 'choiceTexts' | 'endings' | 'characterNames' | 'beats'>> & { puzzles?: Record<string, { names?: Record<string, string>; text?: Record<string, string> }>; replace?: boolean }
  ): Promise<{ edition: Edition; missing: { beats: string[]; other: string[] } }> {
    await this.knownLang(lang)
    const r = await this.store.withLock(slug, async () => {
      const { settings } = await this.store.loadSettings(slug)
      if (lang === settings.primaryLang) throw new Error(`${lang} is the primary language of ${slug}: edit its text with the story tools (vno_beat_update ...)`)
      const book = await this.store.loadBook(slug)
      const textBeats = new Set<string>()
      for (const c of book.chapters) for (const s of c.scenes) for (const b of s.beats) if (hasText(b)) textBeats.add(b.id)
      const chapters = new Set(book.chapters.map((c) => String(c.n)))
      const choices = new Set(book.chapters.flatMap((c) => c.choices.map((_, i) => `${c.n}:${i}`)))
      const endings = new Set(book.chapters.filter((c) => c.ending).map((c) => String(c.n)))
      // a character's name, and the name of each alias under `<key>#<n>`
      const chars = new Set(book.characters.flatMap((c) => [c.key, ...(c.aliases ?? []).map((_, i) => `${c.key}#${i + 1}`)]))
      const errors: string[] = []
      const check = (what: string, keys: string[] | undefined, known: Set<string>) => {
        const bad = (keys ?? []).filter((k) => !known.has(k))
        if (bad.length) errors.push(`no ${what} ${bad.join(', ')} in ${slug}`)
      }
      check('text beat', patch.beats && Object.keys(patch.beats), textBeats)
      check('chapter', patch.chapterTitles && Object.keys(patch.chapterTitles), chapters)
      check('choice', patch.choiceTexts && Object.keys(patch.choiceTexts), choices)
      check('ending of chapter', patch.endings && Object.keys(patch.endings), endings)
      check('character', patch.characterNames && Object.keys(patch.characterNames), chars)
      for (const [key, words] of Object.entries(patch.puzzles ?? {})) {
        const pz = book.puzzles?.find((p) => p.key === key)
        if (!pz) {
          errors.push(`no puzzle ${key} in ${slug}${book.puzzles?.length ? ` (puzzles: ${book.puzzles.map((p) => p.key).join(', ')})` : ''}`)
          continue
        }
        check(`item of puzzle ${key}`, words.names && Object.keys(words.names), new Set(Object.keys(pz.names)))
        check(`clue of puzzle ${key}`, words.text && Object.keys(words.text), new Set(Object.keys(pz.text)))
      }
      if (errors.length) throw new Error(errors.join('; '))
      const cur: Edition = (!patch.replace && (await this.store.loadEdition(slug, lang).catch(() => null))) || { lang, title: book.title, chapterTitles: {}, choiceTexts: {}, endings: {}, characterNames: {}, beats: {} }
      const edition: Edition = {
        lang,
        title: patch.title ?? cur.title,
        chapterTitles: { ...cur.chapterTitles, ...(patch.chapterTitles ?? {}) },
        choiceTexts: { ...cur.choiceTexts, ...(patch.choiceTexts ?? {}) },
        endings: { ...cur.endings, ...(patch.endings ?? {}) },
        characterNames: { ...cur.characterNames, ...(patch.characterNames ?? {}) },
        beats: { ...cur.beats, ...(patch.beats ?? {}) }
      }
      if (cur.puzzles || patch.puzzles) {
        const merged: Record<string, { names: Record<string, string>; text: Record<string, string> }> = { ...(cur.puzzles ?? {}) }
        for (const [key, words] of Object.entries(patch.puzzles ?? {})) merged[key] = { names: { ...(merged[key]?.names ?? {}), ...(words.names ?? {}) }, text: { ...(merged[key]?.text ?? {}), ...(words.text ?? {}) } }
        edition.puzzles = merged
      }
      await this.store.saveEdition(slug, edition)
      if (!settings.editions.includes(lang)) await this.store.saveSettings({ ...settings, editions: [...settings.editions, lang].sort() })
      const other = [
        ...[...chapters].filter((n) => !edition.chapterTitles[Number(n)]).map((n) => `chapter ${n} title`),
        ...[...choices].filter((k) => !edition.choiceTexts[k]).map((k) => `choice ${k}`),
        ...[...endings].filter((n) => !edition.endings[Number(n)]).map((n) => `ending ${n}`),
        ...[...chars].filter((k) => !edition.characterNames[k]).map((k) => `name of ${k}`),
        ...(book.puzzles ?? []).flatMap((p) => [...Object.keys(p.names).filter((k) => !edition.puzzles?.[p.key]?.names[k]).map((k) => `puzzle ${p.key} name of ${k}`), ...Object.keys(p.text).filter((k) => !edition.puzzles?.[p.key]?.text[k]).map((k) => `puzzle ${p.key} ${k === 'murder' ? 'murder note' : `clue ${k}`}`)])
      ]
      return { edition, missing: { beats: [...textBeats].filter((id) => !edition.beats[id]?.trim()), other } }
    })
    await this.emitProject(slug)
    return r
  }

  /** Changes the text of one beat (or a title, choice or ending by its key) of an edition, for the beat editor. */
  async updateEditionBeat(slug: string, lang: Lang, beatId: string, text: string): Promise<void> {
    await this.store.withLock(slug, async () => {
      const ed = await this.store.loadEdition(slug, lang)
      const { settings } = await this.store.loadSettings(slug)
      const book = await this.store.loadBook(slug)
      const known = book.chapters.some((c) => c.scenes.some((s) => s.beats.some((b) => b.id === beatId && b.type !== 'cast')))
      if (!known) throw new Error(`no text beat "${beatId}" in ${slug}`)
      ed.beats[beatId] = text
      await this.store.saveEdition(slug, ed)
      // the primary text lives in vn.json too: keep the two in step
      if (lang === settings.primaryLang) {
        for (const c of book.chapters) for (const s of c.scenes) for (const b of s.beats) if (b.id === beatId && hasText(b)) b.text = text
        await this.store.saveBook(slug, book)
      }
      const rep = await this.store.loadAlignReport(slug, lang)
      if (rep && rep.missing.includes(beatId)) await this.store.saveAlignReport(slug, lang, { ...rep, missing: rep.missing.filter((id) => id !== beatId), matched: rep.matched + 1 })
    })
    this.emit({ type: 'edition.updated', slug, lang, beatId, text })
  }

  async alignReport(slug: string, lang: Lang): Promise<AlignReportView | null> {
    return (await this.store.loadAlignReport(slug, lang)) as AlignReport | null
  }

  // ---- assets ----

  assetView(slug: string, entry: AssetEntry, orphaned = false): AssetView {
    const dir = this.store.dir(slug)
    const rel = (f: string) => path.relative(dir, f).split(path.sep).join('/')
    const file = resolveFile(dir, entry)
    const versionFiles: Record<number, string> = {}
    for (const v of entry.versions) versionFiles[v.n] = `assets/${entry.id}/${v.file}`
    return { ...entry, fileRel: file ? rel(file) : null, versionFiles, orphaned }
  }

  async listAssets(slug: string): Promise<AssetView[]> {
    const { settings } = await this.store.loadSettings(slug)
    const book = await this.store.loadBook(slug)
    const manifest = await this.store.loadAssets(slug)
    const orphans = this.orphanIds(book, settings, manifest.assets)
    return manifest.assets.map((a) => this.assetView(slug, a, orphans.has(a.id)))
  }

  async emitAsset(slug: string, entry: AssetEntry): Promise<void> {
    this.emit({ type: 'asset.updated', slug, asset: this.assetView(slug, entry) })
    this.scheduleProjectUpdate(slug)
  }

  /** The assets a command may name: one that is in the manifest. */
  async requireAsset(slug: string, id: string): Promise<AssetEntry> {
    const a = (await this.store.loadAssets(slug)).assets.find((x) => x.id === id)
    if (!a) throw new Error(`project ${slug} has no asset "${id}"`)
    return a
  }

  /** The queued and running generate jobs of a project for these assets (by unit), from any run. */
  async activeGenerateJobs(slug: string, units: string[]): Promise<JobFile[]> {
    const wanted = new Set(units)
    const out: JobFile[] = []
    for (const state of ['queued', 'running'] as const) {
      for (const j of await this.deps.jobs.list(state)) {
        if (j.data.book === slug && (j.data.task === TASKS.generate || j.data.task === TASKS.draw) && j.data.unit && wanted.has(j.data.unit)) out.push(j)
      }
    }
    return out
  }

  /**
   * Asks for a new version of the asset: a job that generates it with the edits, then a build. These jobs have priority 1.
   *
   * A sprite is made from its character sheet, so order matters: a regenerated sheet is made before the sprite jobs that are queued for it (they
   * are made to wait for it), and a regenerated sprite waits for a sheet job that is queued or running. Sprites already made from the old sheet
   * are listed in `staleSprites`; with `sprites: true` they are made again after the sheet (every unlocked, generated sprite of it).
   */
  async regenerateAsset(slug: string, id: string, edits: { prompt?: string; engine?: string; seed?: number; rebuild?: boolean; sprites?: boolean } = {}): Promise<{ jobs: string[]; staleSprites: string[] }> {
    const entry = await this.requireAsset(slug, id)
    if (entry.kind === 'voiceRef') throw new Error('voice references are uploaded (setVoiceRef), not generated')
    const run = await this.nextRun(slug)
    const { settings } = await this.store.loadSettings(slug)
    this.assertNotHandImage(settings, entry)
    const dir = this.store.dir(slug)
    const sprites = entry.kind === 'sheet' ? (await this.store.loadAssets(slug)).assets.filter((a) => a.kind === 'sprite' && a.refs?.[0] === id) : []
    const sheetJobs = entry.kind === 'sprite' && entry.refs?.[0] ? (await this.activeGenerateJobs(slug, [entry.refs[0]])).map((j) => j.id) : []
    const gen = await this.enqueue(slug, this.generateTask(settings, entry), id, run, { body: { force: true, prompt: edits.prompt, engine: edits.engine, seed: edits.seed }, label: `regenerate ${id}`, depends_on: sheetJobs, priority: 1, max_attempts: this.maxAttempts(settings, entry) })
    const ids = [gen]
    const staleSprites: string[] = []
    if (entry.kind === 'sheet') {
      // sprite jobs already in the queue would otherwise run (oldest first) from the old sheet
      for (const j of await this.activeGenerateJobs(slug, sprites.map((s) => s.id))) {
        if (j.state === 'queued' && !j.data.depends_on.includes(gen)) await this.deps.jobs.update('queued', j.id, { depends_on: [...j.data.depends_on, gen] })
      }
      if (edits.sprites) {
        for (const s of sprites.filter((a) => !a.locked && a.source === 'generated')) {
          ids.push(await this.enqueue(slug, this.generateTask(settings, s), s.id, run, { body: { force: true }, label: `regenerate ${s.id}`, depends_on: [gen], priority: 1 }))
        }
      } else {
        staleSprites.push(...sprites.filter((s) => resolveFile(dir, s)).map((s) => s.id))
      }
    }
    if (edits.rebuild !== false) ids.push(await this.enqueue(slug, TASKS.build, `regen-${id}`, run, { depends_on: [...ids], priority: 1 }))
    return { jobs: ids, staleSprites }
  }

  /** In hand-made art mode an image is never generated: it is set with vno_asset_replace. */
  assertNotHandImage(settings: ProjectSettings, entry: Pick<AssetEntry, 'id' | 'kind'>): void {
    if (isHandArt(settings.art) && IMAGE_KINDS.has(entry.kind)) throw new Error(`${entry.id}: this project uses hand-made art (art.provider: hand), so VN Studio does not generate images: make the image yourself and set it with vno_asset_replace`)
  }

  /** The job that makes an asset: sprites of a `pixel-studio-draw` book are drawn by an agent (needs a model), the rest are generated. */
  /** A song from Flow Music is never retried by itself: a failed take may already have spent credits. Null: the factory's default. */
  maxAttempts(settings: ProjectSettings, entry: Pick<AssetEntry, 'kind'>): number | undefined {
    return entry.kind === 'music' && resolveMusicProvider(settings) === 'flow' ? 1 : undefined
  }

  generateTask(settings: ProjectSettings, entry: Pick<AssetEntry, 'kind'>): VnTask {
    return entry.kind === 'sprite' && settings.art.style === 'pixel' && resolveArtProvider(settings.art) === 'pixel-studio-draw' ? TASKS.draw : TASKS.generate
  }

  /** Uses a file for the asset (custom, locked) and rebuilds the game. */
  async replaceAsset(slug: string, id: string, file: string, opts: { rebuild?: boolean } = {}): Promise<AssetEntry> {
    if (!existsSync(file)) throw new Error(`no such file: ${file}`)
    const next = (await this.store.updateAsset(slug, id, (e) => setCustom(this.store.dir(slug), e, path.resolve(file))))!
    await this.emitAsset(slug, next)
    if (opts.rebuild !== false) await this.rebuildAfterEdit(slug)
    return next
  }

  /**
   * Imports a file you made (or found) as the asset: an image is post-processed like a generated one (a sprite on a plain background is cut
   * out and trimmed, a background is fitted to the screen, a pixel project gets pixel art; `process: 'none'` keeps the file as it is), music
   * is copied. It becomes a new locked version (`custom:import`) and the original stays next to it. In hand-made art mode ComfyUI is never
   * called for it unless BiRefNet is asked for. Rebuilds the game unless `rebuild` is false.
   */
  async importAsset(slug: string, id: string, file: string, opts: ImportOptions & { rebuild?: boolean } = {}): Promise<{ entry: AssetEntry; version: AssetVersion }> {
    const source = path.resolve(file)
    if (!existsSync(source)) throw new Error(`no such file: ${source}`)
    await this.requireAsset(slug, id)
    const { settings } = await this.store.loadSettings(slug)
    const book = await this.store.loadBook(slug)
    const res = (await loadRenpyConfig(this.dataDir)).resolution
    const studios = await this.studios({ autoStart: true, log: this.deps.log })
    const ctx = {
      book,
      settings,
      projectDir: this.store.dir(slug),
      comfy: await this.comfy({ autoStart: true, log: this.deps.log }),
      palettesDir: dataFolders(this.dataDir).palettes,
      pixel: studios.pixel,
      sizes: { background: { w: res.w, h: res.h }, cover: { w: res.w, h: res.h }, spriteHeight: Math.round(res.h * 0.9) }
    }
    let imported: { entry: AssetEntry; version: AssetVersion } | undefined
    await this.store.updateAsset(slug, id, async (cur) => {
      imported = await importAssetFile(ctx, cur, source, opts)
      return imported.entry
    })
    const done = imported!
    this.log(`${slug}/${id}: version ${done.version.n} imported from ${path.basename(source)}`)
    await this.emitAsset(slug, done.entry)
    if (opts.rebuild !== false) await this.rebuildAfterEdit(slug)
    return done
  }

  /** Imports voice clips you made for one language (one file for a beat, or a folder of `<beatId>.<ext>` files). The generators keep them. */
  async importVoice(slug: string, lang: Lang, from: { beatId: string; file: string } | { folder: string }, opts: { rebuild?: boolean } = {}): Promise<VoiceImportResult> {
    const r = await importVoiceClips(this, slug, lang, from)
    if (r.imported.length) {
      this.log(`${slug}: ${r.imported.length} voice clip(s) imported for ${lang}`)
      await this.emitProject(slug)
      if (opts.rebuild !== false) await this.rebuildAfterEdit(slug)
    }
    return r
  }

  async pickAssetVersion(slug: string, id: string, n: number, opts: { rebuild?: boolean } = {}): Promise<AssetEntry> {
    const next = (await this.store.updateAsset(slug, id, (e) => pickVersion(e, n)))!
    await this.emitAsset(slug, next)
    if (opts.rebuild !== false) await this.rebuildAfterEdit(slug)
    return next
  }

  async lockAsset(slug: string, id: string, locked: boolean): Promise<AssetEntry> {
    const next = (await this.store.updateAsset(slug, id, (e) => (locked ? lock(e) : unlock(e))))!
    await this.emitAsset(slug, next)
    return next
  }

  /** An asset edit only needs a new build: one build job at a time waits in the queue. */
  async rebuildAfterEdit(slug: string): Promise<string | null> {
    const queued = await this.deps.jobs.list('queued')
    if (queued.some((j) => j.data.book === slug && j.data.task === TASKS.build)) return null
    return this.enqueue(slug, TASKS.build, 'edit', await this.nextRun(slug), { label: 'rebuild after an asset edit', priority: 1 })
  }

  // ---- prompts, music plan and cues by hand ----

  /**
   * Sets the prompt, negative prompt, size, engine or seed of an asset without generating it. A prompt marks the asset
   * `promptByHand`, so the art-director and the composer keep it (an empty prompt clears it and the mark). A locked asset is refused.
   */
  async setAssetPlan(slug: string, id: string, edits: { prompt?: string; negative?: string; size?: { w: number; h: number } | null; engine?: string; seed?: number | null }): Promise<AssetEntry> {
    const next = (await this.store.updateAsset(slug, id, (e) => {
      if (e.locked) throw new Error(`asset ${id} is locked: unlock it (vno_asset_unlock) before changing its prompt`)
      if (e.kind === 'voiceRef') throw new Error('voice references are uploaded (setVoiceRef), they have no prompt to plan')
      const out: AssetEntry = { ...e }
      if (edits.prompt !== undefined) {
        const prompt = edits.prompt.trim()
        out.prompt = prompt
        if (prompt) out.promptByHand = true
        else delete out.promptByHand
      }
      if (edits.negative !== undefined) out.negative = edits.negative.trim()
      if (edits.size !== undefined) out.size = edits.size
      if (edits.engine !== undefined) out.engine = edits.engine
      if (edits.seed !== undefined) out.seed = edits.seed
      return out
    }))!
    await this.emitAsset(slug, next)
    return next
  }

  /**
   * Merges a music plan into music.json and marks it `byHand` (the music step then keeps the menu, chapters and lengths). `chapters`
   * maps a chapter number to a track id, or null to drop the entry. `replace` starts from an empty plan instead of the current one.
   * Track ids are the project's music assets (`music_01` ...), chapter numbers the book's, lengths are clamped.
   */
  async setMusicPlan(slug: string, patch: { menu?: string | null; chapters?: Record<string, string | null>; scenes?: Record<string, string | null>; seconds?: Record<string, number>; replace?: boolean }): Promise<MusicPlan> {
    const out = await this.store.withLock(slug, async () => {
      const book = await this.store.loadBook(slug)
      const tracks = new Set((await this.store.loadAssets(slug)).assets.filter((a) => a.kind === 'music').map((a) => a.id))
      const known = () => (tracks.size ? `the tracks are ${[...tracks].sort().join(', ')}` : 'the project has no music tracks (see music.tracks in vno_update_settings)')
      const track = (id: string, what: string) => {
        if (!tracks.has(id)) throw new Error(`${what}: "${id}" is not a music track of ${slug}; ${known()}`)
      }
      const cur = await this.store.readJson<MusicPlan>(slug, 'music.json')
      // a plan made here has no menu entry until one is given (the music step then picks it)
      const plan = (patch.replace || !cur ? { chapters: {}, seconds: {} } : { ...cur, chapters: { ...cur.chapters }, seconds: { ...cur.seconds } }) as MusicPlan
      if (patch.menu !== undefined) {
        if (patch.menu !== null) track(patch.menu, 'menu')
        plan.menu = patch.menu
      }
      for (const [key, id] of Object.entries(patch.chapters ?? {})) {
        const n = Number(key)
        if (!Number.isInteger(n) || !book.chapters.some((c) => c.n === n)) throw new Error(`chapters: ${slug} has no chapter ${key} (chapters: ${book.chapters.map((c) => c.n).join(', ')})`)
        if (id === null) delete plan.chapters[n]
        else {
          track(id, `chapter ${n}`)
          plan.chapters[n] = id
        }
      }
      // a scene's own track: null is silence in that scene, an empty string drops the entry
      const sceneIds = new Set(book.chapters.flatMap((c) => c.scenes.map((s) => s.id)))
      for (const [sceneId, id] of Object.entries(patch.scenes ?? {})) {
        if (!sceneIds.has(sceneId)) throw new Error(`scenes: ${slug} has no scene "${sceneId}" (ids look like ch01.s02)`)
        plan.scenes ??= {}
        if (id === '') delete plan.scenes[sceneId]
        else {
          if (id !== null) track(id, `scene ${sceneId}`)
          plan.scenes[sceneId] = id
        }
      }
      if (plan.scenes && !Object.keys(plan.scenes).length) delete plan.scenes
      for (const [id, s] of Object.entries(patch.seconds ?? {})) {
        track(id, 'seconds')
        plan.seconds[id] = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(s)))
      }
      plan.byHand = true
      await this.store.writeJson(slug, 'music.json', plan)
      return plan
    })
    await this.emitProject(slug)
    return out
  }

  /**
   * Merges stage cues into cues.json (or into the default cues when there is none) and marks them `byHand` (the stage step then does
   * not ask the stage-director). `replace` drops the cues so far and starts from the defaults. Everything is checked against the
   * book and the music assets; one bad entry changes nothing.
   */
  async setCues(
    slug: string,
    patch: {
      menuMusic?: string | null
      chapters?: Record<string, string | null>
      scenes?: Record<string, { transition?: SceneTransition; pause?: number; music?: string | null; ambience?: string | null }>
      casts?: Record<string, Record<string, Slot>>
      replace?: boolean
    }
  ): Promise<StageCues> {
    const out = await this.store.withLock(slug, async () => {
      const book = await this.store.loadBook(slug)
      const music = (await this.store.loadAssets(slug)).assets.filter((a) => a.kind === 'music').map((a) => a.id).sort()
      const track = (id: string, what: string) => {
        if (!music.includes(id)) throw new Error(`${what}: "${id}" is not a music track of ${slug}${music.length ? ` (${music.join(', ')})` : ' (the project has no music tracks)'}`)
      }
      const cur = await this.store.readJson<StageCues>(slug, 'cues.json')
      const base = patch.replace || !cur ? defaultCues(book, { musicIds: music }) : cur
      const cues: StageCues = { ...base, chapters: { ...base.chapters }, scenes: { ...base.scenes }, casts: { ...base.casts } }
      if (patch.menuMusic !== undefined) {
        if (patch.menuMusic !== null) track(patch.menuMusic, 'menuMusic')
        cues.menuMusic = patch.menuMusic
      }
      for (const [key, id] of Object.entries(patch.chapters ?? {})) {
        const n = Number(key)
        if (!Number.isInteger(n) || !book.chapters.some((c) => c.n === n)) throw new Error(`chapters: ${slug} has no chapter ${key} (chapters: ${book.chapters.map((c) => c.n).join(', ')})`)
        if (id !== null) track(id, `chapter ${n}`)
        cues.chapters[n] = { music: id }
      }
      const scenes = new Set(book.chapters.flatMap((c) => c.scenes.map((s) => s.id)))
      for (const [id, cue] of Object.entries(patch.scenes ?? {})) {
        if (!scenes.has(id)) throw new Error(`scenes: ${slug} has no scene "${id}" (ids look like ch01.s02)`)
        if (cue.transition !== undefined && !SCENE_TRANSITIONS.includes(cue.transition)) throw new Error(`scenes.${id}: transition must be ${SCENE_TRANSITIONS.join(', ')}`)
        if (cue.pause !== undefined && !(cue.pause >= 0)) throw new Error(`scenes.${id}: pause must be 0 or more seconds`)
        const old = cues.scenes[id]
        if (cue.music !== undefined && cue.music !== null) track(cue.music, `scenes.${id}.music`)
        const ambiences = (book.sounds ?? []).filter((s) => s.kind === 'ambience').map((s) => s.key)
        if (cue.ambience !== undefined && cue.ambience !== null && !ambiences.includes(cue.ambience)) throw new Error(`scenes.${id}.ambience: "${cue.ambience}" is not an ambience of ${slug}${ambiences.length ? ` (${ambiences.join(', ')})` : ' (the book has no ambiences: vno_sound_set adds one)'}`)
        const music = cue.music !== undefined ? { music: cue.music } : old && 'music' in old ? { music: old.music } : {}
        const ambience = cue.ambience !== undefined ? { ambience: cue.ambience } : old && 'ambience' in old ? { ambience: old.ambience } : {}
        cues.scenes[id] = { transition: cue.transition ?? old?.transition ?? 'dissolve', ...(cue.pause !== undefined ? (cue.pause ? { pause: cue.pause } : {}) : old?.pause ? { pause: old.pause } : {}), ...music, ...ambience }
      }
      const casts = new Map<string, Set<string>>()
      for (const c of book.chapters) for (const s of c.scenes) for (const b of s.beats) if (b.type === 'cast') casts.set(b.id, new Set(b.cast.map((x) => x.charKey)))
      for (const [id, map] of Object.entries(patch.casts ?? {})) {
        const members = casts.get(id)
        if (!members) throw new Error(`casts: ${slug} has no cast beat "${id}" (ids look like ch01.s02.b001; vno_get_story shows the cast beats)`)
        const used = new Set<string>()
        for (const [key, slot] of Object.entries(map)) {
          if (!members.has(key)) throw new Error(`casts.${id}: "${key}" is not in that cast (${[...members].join(', ')})`)
          if (!SLOTS.includes(slot)) throw new Error(`casts.${id}.${key}: slot must be ${SLOTS.join(', ')}`)
          if (used.has(slot)) throw new Error(`casts.${id}: two characters in the ${slot} slot`)
          used.add(slot)
        }
        cues.casts[id] = { ...map }
      }
      cues.byHand = true
      await this.store.writeJson(slug, 'cues.json', cues)
      return cues
    })
    await this.emitProject(slug)
    return out
  }

  // ---- voice ----

  /** The reference clip of a character or the narrator. Becomes the `voice_<key>` asset: custom and locked. */
  async setVoiceRef(slug: string, charKey: string, file: string): Promise<AssetEntry> {
    if (!existsSync(file)) throw new Error(`no such file: ${file}`)
    const id = voiceRefId(charKey)
    const dir = this.store.dir(slug)
    const next = await this.store.withLock(slug, async () => {
      const { settings } = await this.store.loadSettings(slug)
      const manifest = await this.store.loadAssets(slug)
      let entry = manifest.assets.find((a) => a.id === id)
      if (!entry) {
        const book = await this.store.loadBook(slug)
        if (charKey !== 'narrator' && !book.characters.some((c) => c.key === charKey)) throw new Error(`no character "${charKey}" in ${slug}`)
        entry = { id, kind: 'voiceRef', prompt: '', engine: settings.voice.engines[settings.primaryLang] ?? '', seed: null, size: null, versions: [], selected: null, source: 'generated', locked: false }
      }
      const updated = await setCustom(dir, entry, path.resolve(file))
      const assets = manifest.assets.some((a) => a.id === id) ? manifest.assets.map((a) => (a.id === id ? updated : a)) : [...manifest.assets, updated]
      await this.store.saveAssets(slug, { assets })
      return updated
    })
    await this.emitAsset(slug, next)
    return next
  }

  // ---- Pixel Studio and Chiptune Studio ----

  /** The studio clients and `config/studios.md` (the clients are the ones the engine was given, else made from the config). */
  async studios(o: { autoStart?: boolean; log?: (m: string) => void } = {}): Promise<{ pixel: PixelClient; chiptune: ChiptuneClient; flow: FlowClient; config: StudiosConfig }> {
    const config = await loadStudiosConfig(this.dataDir)
    const starter = o.autoStart ? this.deps.starter : undefined
    const hook = (id: string, url: string) => (starter ? { ensureUp: (signal?: AbortSignal) => starter.ensure(id, url, { signal, log: o.log }) } : {})
    return {
      pixel: this.deps.pixel ?? pixelClientFor(config, hook('pixel-studio', config.pixelStudioUrl)),
      chiptune: this.deps.chiptune ?? chiptuneClientFor(config, hook('chiptune-studio', config.chiptuneStudioUrl)),
      flow: this.deps.flow ?? flowClientFor(config),
      config
    }
  }

  /** The Ren'Py SDK's Python and the puzzle library, for the `vno_puzzle_*` tools. */
  async puzzlePython(): Promise<PuzzlePython> {
    return { sdkPath: (await loadRenpyConfig(this.dataDir)).sdkPath, packagesDir: packagesDirOf(this.dirs.templates) }
  }

  /** What an import proves its puzzles with (the puzzle library), or null when the Ren'Py SDK is not there: the puzzles are then left unproved. */
  private async importProver(): Promise<((p: PuzzleEntry) => Promise<PuzzleProof>) | null> {
    try {
      const py = await this.puzzlePython()
      return sdkPython(py.sdkPath) ? (p) => solvePuzzle(py, p.data) : null
    } catch {
      return null
    }
  }

  /** Asks both studios for their tools. Never throws: an unreachable studio is `ok: false` with the message (and how to start it). */
  async studiosStatus(): Promise<StudioStatusView[]> {
    const { pixel, chiptune, flow, config } = await this.studios()
    const probe = async (id: StudioId, client: PixelClient | ChiptuneClient): Promise<StudioStatusView> => {
      const base = { id, name: STUDIO_NAMES[id], url: client.url || studioUrl(config, id), repo: studioRepo(config, id), hint: startHint(config, id) }
      try {
        const tools = await client.listTools()
        return { ...base, ok: true, error: '', tools: tools.length }
      } catch (e) {
        return { ...base, ok: false, error: (e as Error).message, tools: 0 }
      }
    }
    const probeFlow = async (): Promise<StudioStatusView> => {
      const base = { id: 'flow' as const, name: 'flow-music-mcp (Google Flow)', url: flow.url || config.flowUrl, repo: config.flowRepo, hint: flowStartHint(config) }
      try {
        const s = await flow.status()
        if (!s.up) return { ...base, ok: false, error: s.hint ?? base.hint, tools: 0 }
        if (s.signedIn === false) return { ...base, ok: false, error: s.hint ?? 'Google Flow is not signed in', tools: 0 }
        return { ...base, ok: true, error: '', tools: 0 }
      } catch (e) {
        return { ...base, ok: false, error: (e as Error).message, tools: 0 }
      }
    }
    return Promise.all([probe('pixel', pixel), probe('chiptune', chiptune), probeFlow()])
  }

  /** Opens an asset in its studio; each save there makes a new custom, locked version (see `vn/roundtrip.ts`). */
  async openInStudio(slug: string, id: string, opts: OpenOptions = {}): Promise<OpenResult> {
    const r = await openAssetInStudio(this, slug, id, opts)
    this.emit({ type: 'studio.opened', slug, id, studio: r.studio, mode: r.mode, message: r.message })
    return r
  }

  /** The VibeTTS client and `config/voice.md` (the client is the one the engine was given, else made from the config). */
  async vibetts(): Promise<{ client: VibeTtsClient; config: VoiceConfig }> {
    const config = await loadVoiceConfig(this.dataDir)
    return { client: this.deps.vibetts ?? clientFor(config), config }
  }

  /** Asks VibeTTS for its voices. Never throws: an unreachable VibeTTS is `ok: false` with the message to show. */
  async voiceStatus(): Promise<Extract<EngineEvent, { type: 'voice.status' }>> {
    const { client } = await this.vibetts()
    try {
      const r = await client.listVoices()
      const voices = r.voices.map((v) => ({ id: v.id, label: v.label || v.id, engine: v.engine ?? '', languages: v.languages ?? [] }))
      const languages = (r.languages ?? []).map((l) => l.code)
      const english = { engine: r.english?.engine ?? '', language: 'en', voice: r.english?.voice ?? '' }
      const other = { engine: '', language: r.other?.language ?? '', voice: r.other?.voice ?? '' }
      return { type: 'voice.status', ok: true, url: client.url, error: '', supertonicInstalled: r.supertonic_installed === true, languages, english, other, voices }
    } catch (e) {
      const none = { engine: '', language: '', voice: '' }
      return { type: 'voice.status', ok: false, url: client.url, error: (e as Error).message, supertonicInstalled: false, languages: [], english: none, other: none, voices: [] }
    }
  }

  /** Enqueues the voice plan (a VibeTTS voice per speaker). Does nothing when the project's voice is off. */
  async planVoices(slug: string, opts: { overwrite?: boolean } = {}): Promise<string[]> {
    const { settings } = await this.store.loadSettings(slug)
    if (!settings.voice.enabled) {
      this.log(`${slug}: voice is off, the voices are not planned (turn voice.enabled on in the project settings)`)
      return []
    }
    return [await this.enqueue(slug, TASKS.voicePlan, 'plan', await this.nextRun(slug), { body: { overwrite: !!opts.overwrite, standalone: true }, label: 'plan the voices', priority: 1 })]
  }

  /** Gives a speaker the voice for one language and makes its preview (a few seconds to load the model on the first call). */
  async setVoice(slug: string, speakerKey: string, lang: Lang, voice: string): Promise<VoicePreview> {
    const { settings } = await this.store.loadSettings(slug)
    if (settings.voice.provider === 'flow') return setFlowVoice(this, slug, speakerKey, lang, voice, { flow: (await this.studios()).flow, format: (await this.vibetts()).config.format })
    return setVoice(this, slug, speakerKey, lang, voice)
  }

  /** A short sample of a voice in a language (the project's primary one when `lang` is left out). */
  async previewVoice(slug: string, speakerKey: string, voice: string, lang?: Lang): Promise<VoicePreview> {
    const { settings } = await this.store.loadSettings(slug)
    if (settings.voice.provider === 'flow') return previewFlowVoice(this, slug, speakerKey, voice, lang ?? settings.primaryLang, { flow: (await this.studios()).flow, style: settings.voice.flowStyles?.[speakerKey], format: (await this.vibetts()).config.format })
    return previewVoice(this, slug, speakerKey, voice, lang ?? settings.primaryLang)
  }

  /** Enqueues the voice clips job(s). Does nothing when the project's voice is off (and says so). */
  async generateVoice(slug: string, opts: { lang?: Lang; beatId?: string; limit?: number } = {}): Promise<string[]> {
    const { settings } = await this.store.loadSettings(slug)
    if (!settings.voice.enabled) {
      this.log(`${slug}: voice is off, no voice clips are generated (turn voice.enabled on in the project settings)`)
      return []
    }
    const langs = opts.lang ? [opts.lang] : settings.voice.langs.length ? settings.voice.langs : [settings.primaryLang]
    const run = await this.nextRun(slug)
    const ids: string[] = []
    for (const lang of langs) ids.push(await this.enqueue(slug, TASKS.voiceGenerate, lang, run, { body: { beatId: opts.beatId, limit: opts.limit }, priority: 1 }))
    return ids
  }

  // ---- game ----

  gameDir(slug: string): string {
    return path.join(this.store.dir(slug), 'game')
  }

  async enqueueBuild(slug: string): Promise<string> {
    return this.enqueue(slug, TASKS.build, 'now', await this.nextRun(slug), { label: 'build the game', priority: 1 })
  }

  async enqueueLint(slug: string): Promise<string> {
    return this.enqueue(slug, TASKS.lint, 'now', await this.nextRun(slug), { label: 'lint the game', priority: 1 })
  }

  async enqueueAndroid(slug: string, bundle = false): Promise<string> {
    return this.enqueue(slug, TASKS.android, 'now', await this.nextRun(slug), { body: { bundle }, label: 'build the Android package', priority: 1 })
  }

  async runGame(slug: string): Promise<{ pid: number | undefined }> {
    const renpy = await loadRenpyConfig(this.dataDir)
    const dir = this.gameDir(slug)
    if (!existsSync(path.join(dir, 'game'))) throw new Error(`${slug} has not been built yet: build it first`)
    return runRenpyGame(dir, { sdkPath: renpy.sdkPath })
  }

  async androidPreflight(slug: string): Promise<BuildResult> {
    const renpy = await loadRenpyConfig(this.dataDir)
    const pre = runAndroidPreflight(this.gameDir(slug), { sdkPath: renpy.sdkPath })
    const result: BuildResult = { slug, action: 'preflight', ok: pre.ok, messages: pre.ok ? pre.found : pre.problems, at: nowIso(), gameDir: this.gameDir(slug) }
    this.emit({ type: 'build.result', result })
    return result
  }

  async sdkAvailable(): Promise<boolean> {
    return sdkExists((await loadRenpyConfig(this.dataDir)).sdkPath)
  }

  // ---- Ren'Py config (config/renpy.md) ----

  async renpyConfigView(warning?: string): Promise<RenpyConfigView> {
    const c = await loadRenpyConfig(this.dataDir)
    const sdkFound = sdkExists(c.sdkPath)
    const envOverride = !!process.env.VNO_RENPY_SDK
    const note = warning ?? (sdkFound ? undefined : `the Ren'Py SDK was not found in ${c.sdkPath}: games are written but not translated, linted or run`)
    return { sdkPath: c.sdkPath, resolution: `${c.resolution.w}x${c.resolution.h}`, imageFormat: c.imageFormat, sdkFound, envOverride, ...(note ? { warning: note } : {}) }
  }

  /** Writes the given fields to config/renpy.md (the others and the notes below the frontmatter stay). A missing SDK is a warning. */
  async saveRenpyConfig(cmd: { sdkPath?: string; resolution?: string; imageFormat?: 'webp' | 'png' }): Promise<RenpyConfigView> {
    const file = path.join(this.dataDir, 'config', 'renpy.md')
    let doc: { data: Record<string, unknown>; body: string }
    try {
      doc = await readMd(file)
    } catch {
      doc = { data: {}, body: '' }
    }
    const merged: Record<string, unknown> = { ...doc.data, kind: 'renpy' }
    if (cmd.sdkPath !== undefined && cmd.sdkPath.trim()) merged.sdkPath = cmd.sdkPath.trim().replace(/\\/g, '/')
    if (cmd.resolution !== undefined) merged.resolution = cmd.resolution.trim()
    if (cmd.imageFormat !== undefined) merged.imageFormat = cmd.imageFormat
    const parsed = renpyConfigSchema.safeParse(merged)
    if (!parsed.success) throw new Error(`bad Ren'Py setting: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    await writeMd(file, merged, doc.body)
    const warning = process.env.VNO_RENPY_SDK ? 'VNO_RENPY_SDK is set and overrides the SDK path while the app runs' : undefined
    return this.renpyConfigView(warning)
  }

  // ---- themes, ComfyUI, engines ----

  listThemes(): ThemeInfo[] {
    return listThemes(this.dirs.themes).themes.map((t) => ({
      name: t.theme.name,
      label: t.theme.label,
      description: t.theme.description,
      light: t.theme.light,
      pixel: t.theme.pixel,
      previewCss: themeFontFaces(t.theme, path.basename(t.dir)) + themePreviewCss(t.theme),
      dir: t.dir
    }))
  }

  themeDir(name: string): string | null {
    return findTheme(name, this.dirs.themes)?.dir ?? null
  }

  async comfyStatus(): Promise<Extract<EngineEvent, { type: 'comfy.status' }>> {
    const config = await loadComfyConfigFor(this.dataDir)
    const inv = await buildInventory(config, { workflowDirs: dataFolders(this.dataDir).workflows })
    return { type: 'comfy.status', ok: inv.ok, lanes: inv.lanes, engines: inv.engines, customWorkflows: inv.customWorkflows, backgroundRemoval: inv.backgroundRemoval }
  }

  async comfyFree() {
    return freeAllLanes(await loadComfyConfigFor(this.dataDir))
  }

  async listEngines(): Promise<{ image: EngineInfo[]; audio: EngineInfo[]; palettes: string[] }> {
    const all: EngineInfo[] = Object.entries(ENGINES).map(([id, e]) => ({ id, kind: e.kind, label: e.label, edit: !!e.acceptsReferences }))
    return { image: all.filter((e) => e.kind === 'image'), audio: all.filter((e) => e.kind === 'audio'), palettes: await listPalettes(dataFolders(this.dataDir).palettes) }
  }

  async customWorkflows(): Promise<CustomWorkflowInfo[]> {
    const dirs = dataFolders(this.dataDir).workflows
    const out: CustomWorkflowInfo[] = []
    for (const name of await listCustomWorkflows(dirs)) {
      try {
        const wf = await loadCustomWorkflow(dirs, name)
        out.push({ name, kind: workflowKind(wf.graph, wf.mapping), languages: Object.keys(wf.mapping.languages ?? {}) })
      } catch (e) {
        this.log(`workflow ${name}: ${(e as Error).message}`)
      }
    }
    return out
  }

  // ---- status and waiting ----

  async status(slug: string): Promise<{ pipeline: PipelineStatus | null; jobs: JobCounts; running: { id: string; task: string; unit: string | null }[]; failed: { id: string; failure: string }[] }> {
    if (!(await this.store.exists(slug))) throw new Error(`no project "${slug}"`)
    const running = (await this.deps.jobs.list('running')).filter((j) => j.data.book === slug).map((j) => ({ id: j.id, task: j.data.task, unit: j.data.unit }))
    const failed = (await this.deps.jobs.list('failed'))
      .filter((j) => j.data.book === slug)
      .map((j) => ({ id: j.id, failure: String((j.data as Record<string, unknown>).failure ?? '') }))
    return { pipeline: await this.pipelineStatus(slug), jobs: await this.jobCounts(slug), running, failed }
  }

  /**
   * Waits until the project (or every project) has nothing left to run: no running job, and every queued job is blocked by a failed
   * one. Returns the failed job ids. Used by the CLI.
   *
   * A running job whose model call waits in the client task queue (`client/...` model, answered over MCP) is not working: the call
   * returns as soon as nothing else runs, with `clientTasks` (how many tasks wait or are leased for this project) so the caller
   * can take them (`vno_get_task`). Without one it would block until the timeout.
   */
  async waitIdle(
    slug: string | null,
    o: { timeoutMs?: number; pollMs?: number; onTick?: () => void } = {}
  ): Promise<{ failed: string[]; timedOut: boolean; clientTasks: number }> {
    const end = o.timeoutMs ? Date.now() + o.timeoutMs : Infinity
    const mine = (b: string | null) => !slug || b === slug
    let idleSeen = false
    for (;;) {
      // running, queued, running again: a job that starts or ends between the reads is not missed (it is in one of them)
      const running1 = (await this.deps.jobs.list('running')).filter((j) => mine(j.data.book))
      const queued = (await this.deps.jobs.list('queued')).filter((j) => mine(j.data.book))
      const running2 = (await this.deps.jobs.list('running')).filter((j) => mine(j.data.book))
      const running = [...new Map([...running1, ...running2].map((j) => [j.id, j])).values()]
      // jobs parked in the client queue (waiting for Claude): not running work
      const queue = this.deps.registry.clientQueue
      const parked = queue.jobs()
      const working = running.filter((j) => !parked.has(j.id))
      const clientTasks = queue.countFor((job) => running.some((j) => j.id === job))
      const failed = (await this.deps.jobs.list('failed')).filter((j) => mine(j.data.book)).map((j) => j.id)
      const blocked = new Set<string>()
      const failedSet = new Set(failed)
      for (let changed = true; changed; ) {
        changed = false
        for (const j of queued) {
          if (blocked.has(j.id)) continue
          if (j.data.depends_on.some((d) => failedSet.has(d) || blocked.has(d))) {
            blocked.add(j.id)
            changed = true
          }
        }
      }
      const pending = queued.filter((j) => !blocked.has(j.id))
      // only the failures of the latest run count: an older run's failed job is history
      const latest = slug ? (await this.nextRun(slug)) - 1 : 0
      const current = slug ? failed.filter((id) => runOf(id) === latest) : failed
      if (working.length === 0 && clientTasks > 0) return { failed: current, timedOut: false, clientTasks }
      if (running.length === 0 && pending.length === 0) {
        // a job that just ended may have queued its next jobs after the read above: look once more before saying idle
        if (idleSeen) return { failed: current, timedOut: false, clientTasks: 0 }
        idleSeen = true
        await new Promise((r) => setTimeout(r, 75))
        continue
      }
      idleSeen = false
      if (Date.now() > end) return { failed: current, timedOut: true, clientTasks }
      o.onTick?.()
      await new Promise((r) => setTimeout(r, o.pollMs ?? 300))
    }
  }

  /** Counts of jobs per state for a state list helper. */
  async jobIds(state: JobState, slug: string): Promise<string[]> {
    return (await this.deps.jobs.ids(state)).filter((id) => id.startsWith(`${slug}--`))
  }

  // ---- commands ----

  /** Runs a UI command and sends the answer events. Errors become `command.error`. */
  async handle(cmd: VnCommand): Promise<void> {
    const slug = 'slug' in cmd ? cmd.slug : undefined
    try {
      switch (cmd.type) {
        case 'listSourceBooks':
          this.emit({ type: 'books.listed', books: await this.listSourceBooks(), scriptoriumData: this.scriptoriumDir() })
          return
        case 'previewImport':
          this.emit({ type: 'import.preview', preview: await this.previewImport(cmd.source) })
          return
        case 'importProject': {
          const r = await this.importProject(cmd.source, { lang: cmd.lang })
          if (cmd.run) await this.runPipeline(r.slug, 'analyse')
          return
        }
        case 'listProjects':
          this.emit({ type: 'projects.listed', projects: await this.listProjects() })
          return
        case 'getProject':
          this.emit({ type: 'project.loaded', slug: cmd.slug, project: await this.detail(cmd.slug) })
          return
        case 'updateProjectSettings':
          await this.updateSettings(cmd.slug, cmd.patch)
          return
        case 'deleteProject':
          await this.deleteProject(cmd.slug)
          return
        case 'runPipeline':
          await this.runPipeline(cmd.slug, cmd.from, { force: cmd.force })
          return
        case 'addEdition':
          await this.addEdition(cmd.slug, cmd.source, cmd.lang)
          return
        case 'getEdition':
          this.emit({ type: 'edition.loaded', slug: cmd.slug, lang: cmd.lang, edition: await this.getEdition(cmd.slug, cmd.lang) })
          return
        case 'updateEditionBeat':
          await this.updateEditionBeat(cmd.slug, cmd.lang, cmd.beatId, cmd.text)
          return
        case 'getAlignReport':
          this.emit({ type: 'align.report', slug: cmd.slug, lang: cmd.lang, report: await this.alignReport(cmd.slug, cmd.lang) })
          return
        case 'listAssets':
          this.emit({ type: 'assets.listed', slug: cmd.slug, assets: await this.listAssets(cmd.slug) })
          return
        case 'regenerateAsset':
          await this.regenerateAsset(cmd.slug, cmd.id, { prompt: cmd.prompt, engine: cmd.engine, seed: cmd.seed })
          return
        case 'replaceAsset':
          await this.replaceAsset(cmd.slug, cmd.id, cmd.file)
          return
        case 'pickAssetVersion':
          await this.pickAssetVersion(cmd.slug, cmd.id, cmd.n)
          return
        case 'lockAsset':
          await this.lockAsset(cmd.slug, cmd.id, true)
          return
        case 'unlockAsset':
          await this.lockAsset(cmd.slug, cmd.id, false)
          return
        case 'buildGame':
          await this.enqueueBuild(cmd.slug)
          return
        case 'lintGame':
          await this.enqueueLint(cmd.slug)
          return
        case 'runGame': {
          const r = await this.runGame(cmd.slug)
          this.emit({ type: 'game.started', slug: cmd.slug, pid: r.pid ?? null })
          return
        }
        case 'androidPreflight':
          await this.androidPreflight(cmd.slug)
          return
        case 'androidBuild':
          await this.enqueueAndroid(cmd.slug, cmd.bundle)
          return
        case 'listThemes':
          this.emit({ type: 'themes.listed', themes: this.listThemes() })
          return
        case 'comfyStatus':
          try {
            this.emit(await this.comfyStatus())
          } catch (e) {
            this.emit({ type: 'comfy.status', ok: false, lanes: [], engines: [], customWorkflows: [], backgroundRemoval: { available: false, models: [] } })
            this.emit({ type: 'command.error', command: cmd.type, message: (e as Error).message })
          }
          return
        case 'comfyFree':
          this.emit({ type: 'comfy.freed', results: await this.comfyFree() })
          return
        case 'listEngines':
          this.emit({ type: 'engines.listed', ...(await this.listEngines()) })
          return
        case 'listCustomWorkflows':
          this.emit({ type: 'workflows.listed', workflows: await this.customWorkflows() })
          return
        case 'setVoiceRef':
          await this.setVoiceRef(cmd.slug, cmd.charKey, cmd.file)
          return
        case 'generateVoice':
          await this.generateVoice(cmd.slug, { lang: cmd.lang, beatId: cmd.beatId, limit: cmd.limit })
          return
        case 'voiceStatus':
          this.emit(await this.voiceStatus())
          return
        case 'planVoices':
          await this.planVoices(cmd.slug, { overwrite: cmd.overwrite })
          return
        case 'studiosStatus':
          this.emit({ type: 'studios.status', studios: await this.studiosStatus() })
          return
        case 'openInStudio':
          await this.openInStudio(cmd.slug, cmd.id)
          return
        case 'setVoice':
        case 'previewVoice': {
          // a few seconds (the model loads on the first call): answer when done, and do not hold up the other commands
          const run = cmd.type === 'setVoice' ? this.setVoice(cmd.slug, cmd.speakerKey, cmd.lang, cmd.voice) : this.previewVoice(cmd.slug, cmd.speakerKey, cmd.voice, cmd.lang)
          void run
            .then((p) => this.emit({ type: 'voice.preview', ...p }))
            .catch((e: Error) => {
              this.log(`command ${cmd.type} failed: ${e.message}`)
              this.emit({ type: 'command.error', command: cmd.type, message: e.message, slug: cmd.slug })
            })
          return
        }
        case 'getRenpyConfig':
          this.emit({ type: 'renpy.config', ...(await this.renpyConfigView()) })
          return
        case 'saveRenpyConfig':
          this.emit({ type: 'renpy.config', ...(await this.saveRenpyConfig(cmd)) })
          return
      }
    } catch (e) {
      this.log(`command ${cmd.type} failed: ${(e as Error).message}`)
      this.emit({ type: 'command.error', command: cmd.type, message: (e as Error).message, ...(slug ? { slug } : {}) })
    }
  }
}

/** Drops the keys whose value is `null`: a settings patch uses `null` to clear an optional field (art.palette, art.stylePrompt). */
function clearNulls<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null)) as T
}
