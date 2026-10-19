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
import { CHIPTUNE_ENGINE, projectSettingsSchema, resolveArtProvider, resolveMusicProvider } from '../../shared/vn'
import type { AssetEntry, Edition, Lang, ProjectSettings, VnBook } from '../../shared/vn'
import { deriveAssets } from '../assets/derive'
import { lock, mergeDerived, pickVersion, resolveFile, setCustom, unlock } from '../assets/manifest'
import { listPalettes } from '../assets/palettes'
import { createComfyClient } from '../comfy/client'
import type { ComfyClient } from '../comfy/client'
import { listCustomWorkflows, loadCustomWorkflow, workflowKind } from '../comfy/custom-workflow'
import { ENGINES } from '../comfy/graphs'
import { buildInventory, freeAllLanes } from '../comfy/inventory'
import type { ModelRegistry } from '../models/registry'
import type { ModelRouter } from '../models/router'
import type { JobState, JobStore } from '../queue/jobs'
import { JOB_STATES } from '../queue/jobs'
import { androidPreflight as runAndroidPreflight } from '../renpy/android'
import { run as runRenpyGame, sdkExists } from '../renpy/run'
import { findTheme, listThemes } from '../themes/load'
import { pickTheme } from '../themes/pick'
import { themeFontFaces, themePreviewCss } from '../themes/emit'
import type { SettingsConfig } from '../../shared/schemas'
import { findAppDirs } from './appdirs'
import type { AppDirs } from './appdirs'
import type { AlignReport } from './align'
import { importBook } from './import'
import { listBooks } from './reader'
import type { BookSummary } from './reader'
import { ProjectStore, assertSlug, dataFolders, loadComfyConfigFor, loadRenpyConfig, projectSlug, renpyConfigSchema } from './project'
import { readMd, writeMd } from '../store/atomic'
import { jobId, ROLE_OF, runOf, STEP_OF_TASK, stepIndex, TASKS } from './pipeline'
import type { VnTask } from './pipeline'
import { voiceRefId } from './ids'
import { clientFor, loadVoiceConfig } from '../voice/config'
import type { VoiceConfig } from '../voice/config'
import { previewVoice, setVoice } from '../voice/jobs'
import type { VoicePreview } from '../voice/jobs'
import type { VibeTtsClient } from '../voice/vibetts'
import { chiptuneClientFor, loadStudiosConfig, pixelClientFor, startHint, studioRepo, studioUrl, STUDIO_NAMES } from '../studios/config'
import type { StudioId, StudiosConfig } from '../studios/config'
import type { ChiptuneClient } from '../studios/chiptune'
import type { PixelClient } from '../studios/pixel'
import type { Watch } from '../studios/launch'
import { openAssetInStudio } from './roundtrip'
import type { OpenOptions, OpenResult } from './roundtrip'

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
  /** The folders that ship with the app. Default: found relative to this code. */
  dirs?: Partial<AppDirs>
}

const nowIso = () => new Date().toISOString()

/** The engine id a kind of asset is generated with, from the project settings. */
export function engineFor(kind: AssetEntry['kind'], settings: ProjectSettings): string | null {
  switch (kind) {
    case 'background':
    case 'sheet':
    case 'cover':
      return settings.art.generator
    case 'sprite':
      return settings.art.editor
    case 'music':
      return resolveMusicProvider(settings) === 'chiptune' ? CHIPTUNE_ENGINE : settings.music.engine
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

  async comfy(): Promise<ComfyClient> {
    const o = this.comfyOverride
    if (o) return typeof o === 'function' ? o() : o
    return createComfyClient({ config: await loadComfyConfigFor(this.dataDir), dataDir: this.dataDir })
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
    const r = await importBook(folder)
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
    const folder = await this.resolveSource(source)
    const r = await importBook(folder, { lang: opts.lang })
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
      await this.store.writeJson(slug, 'import.json', { at: nowIso(), source: folder, detected: r.detected, uncertain: r.uncertain.length })
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
      counts.total++
      if (this.store.resolveAsset(slug, a)) counts.ready++
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

  /** Merges a settings patch (theme, art, music, voice) into project.md and brings the asset list in line with it. */
  async updateSettings(slug: string, patch: ProjectSettingsPatch): Promise<ProjectSettings> {
    const { settings: cur } = await this.store.loadSettings(slug)
    const art: Record<string, unknown> = clearNulls({ ...cur.art, ...(patch.art ?? {}) })
    // the pixel settings are merged field by field (a patch with only the dither keeps the size)
    if (patch.art?.pixel) art.pixel = clearNulls({ ...(cur.art.pixel ?? {}), ...patch.art.pixel })
    const next = projectSettingsSchema.parse({
      ...cur,
      theme: patch.theme !== undefined ? patch.theme : cur.theme,
      art,
      music: clearNulls({ ...cur.music, ...(patch.music ?? {}) }),
      voice: { ...cur.voice, ...(patch.voice ?? {}) }
    })
    await this.store.saveSettings(next)
    if (patch.art || patch.music || patch.voice) await this.reconcileAssets(slug)
    await this.emitProject(slug)
    return next
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
        const engine = engineFor(a.kind, settings)
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

  /** Enqueues one job of the VN pipeline (idempotent by id). Returns the id. */
  async enqueue(slug: string, task: VnTask, unit: string, run: number, o: { depends_on?: string[]; body?: object; label?: string; vision?: boolean; requested_by?: string } = {}): Promise<string> {
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
        ...(o.requested_by ? { requested_by: o.requested_by } : {})
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
    const start: PipelineStep = from ?? (hasBook ? 'analyse' : 'import')
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
  async enqueueTail(slug: string, run: number, from: PipelineStep, deps: string[]): Promise<string[]> {
    const { settings } = await this.store.loadSettings(slug)
    const ids: string[] = []
    const add = async (task: VnTask, unit: string, depends_on: string[], body?: object) => {
      const id = await this.enqueue(slug, task, unit, run, { depends_on, body })
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

  async addEdition(slug: string, source: string, lang: Lang): Promise<string> {
    const { settings } = await this.store.loadSettings(slug)
    if (lang === settings.primaryLang) throw new Error(`${lang} is the primary language of ${slug}: an edition is another language`)
    const folder = await this.resolveSource(source)
    const run = await this.nextRun(slug)
    return this.enqueue(slug, TASKS.editionAdd, lang, run, { body: { source: folder, lang }, label: `add ${lang} edition` })
  }

  async getEdition(slug: string, lang: Lang): Promise<Edition> {
    return this.store.loadEdition(slug, lang)
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
        for (const c of book.chapters) for (const s of c.scenes) for (const b of s.beats) if (b.id === beatId && b.type !== 'cast') b.text = text
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

  /** Asks for a new version of the asset: a job that generates it with the edits, then a build. */
  async regenerateAsset(slug: string, id: string, edits: { prompt?: string; engine?: string; seed?: number; rebuild?: boolean } = {}): Promise<string[]> {
    const entry = await this.requireAsset(slug, id)
    if (entry.kind === 'voiceRef') throw new Error('voice references are uploaded (setVoiceRef), not generated')
    const run = await this.nextRun(slug)
    const { settings } = await this.store.loadSettings(slug)
    const gen = await this.enqueue(slug, this.generateTask(settings, entry), id, run, { body: { force: true, prompt: edits.prompt, engine: edits.engine, seed: edits.seed }, label: `regenerate ${id}` })
    const ids = [gen]
    if (edits.rebuild !== false) ids.push(await this.enqueue(slug, TASKS.build, `regen-${id}`, run, { depends_on: [gen] }))
    return ids
  }

  /** The job that makes an asset: sprites of a `pixel-studio-draw` book are drawn by an agent (needs a model), the rest are generated. */
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
    return this.enqueue(slug, TASKS.build, 'edit', await this.nextRun(slug), { label: 'rebuild after an asset edit' })
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
  async studios(): Promise<{ pixel: PixelClient; chiptune: ChiptuneClient; config: StudiosConfig }> {
    const config = await loadStudiosConfig(this.dataDir)
    return { pixel: this.deps.pixel ?? pixelClientFor(config), chiptune: this.deps.chiptune ?? chiptuneClientFor(config), config }
  }

  /** Asks both studios for their tools. Never throws: an unreachable studio is `ok: false` with the message (and how to start it). */
  async studiosStatus(): Promise<StudioStatusView[]> {
    const { pixel, chiptune, config } = await this.studios()
    const probe = async (id: StudioId, client: PixelClient | ChiptuneClient): Promise<StudioStatusView> => {
      const base = { id, name: STUDIO_NAMES[id], url: client.url || studioUrl(config, id), repo: studioRepo(config, id), hint: startHint(config, id) }
      try {
        const tools = await client.listTools()
        return { ...base, ok: true, error: '', tools: tools.length }
      } catch (e) {
        return { ...base, ok: false, error: (e as Error).message, tools: 0 }
      }
    }
    return Promise.all([probe('pixel', pixel), probe('chiptune', chiptune)])
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
    return [await this.enqueue(slug, TASKS.voicePlan, 'plan', await this.nextRun(slug), { body: { overwrite: !!opts.overwrite, standalone: true }, label: 'plan the voices' })]
  }

  /** Gives a speaker the voice for one language and makes its preview (a few seconds to load the model on the first call). */
  setVoice(slug: string, speakerKey: string, lang: Lang, voice: string): Promise<VoicePreview> {
    return setVoice(this, slug, speakerKey, lang, voice)
  }

  /** A short sample of a voice in a language (the project's primary one when `lang` is left out). */
  async previewVoice(slug: string, speakerKey: string, voice: string, lang?: Lang): Promise<VoicePreview> {
    const { settings } = await this.store.loadSettings(slug)
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
    for (const lang of langs) ids.push(await this.enqueue(slug, TASKS.voiceGenerate, lang, run, { body: { beatId: opts.beatId, limit: opts.limit } }))
    return ids
  }

  // ---- game ----

  gameDir(slug: string): string {
    return path.join(this.store.dir(slug), 'game')
  }

  async enqueueBuild(slug: string): Promise<string> {
    return this.enqueue(slug, TASKS.build, 'now', await this.nextRun(slug), { label: 'build the game' })
  }

  async enqueueLint(slug: string): Promise<string> {
    return this.enqueue(slug, TASKS.lint, 'now', await this.nextRun(slug), { label: 'lint the game' })
  }

  async enqueueAndroid(slug: string, bundle = false): Promise<string> {
    return this.enqueue(slug, TASKS.android, 'now', await this.nextRun(slug), { body: { bundle }, label: 'build the Android package' })
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
   */
  async waitIdle(slug: string | null, o: { timeoutMs?: number; pollMs?: number; onTick?: () => void } = {}): Promise<{ failed: string[]; timedOut: boolean }> {
    const end = o.timeoutMs ? Date.now() + o.timeoutMs : Infinity
    const mine = (b: string | null) => !slug || b === slug
    let idleSeen = false
    for (;;) {
      // running, queued, running again: a job that starts or ends between the reads is not missed (it is in one of them)
      const running1 = (await this.deps.jobs.list('running')).filter((j) => mine(j.data.book))
      const queued = (await this.deps.jobs.list('queued')).filter((j) => mine(j.data.book))
      const running2 = (await this.deps.jobs.list('running')).filter((j) => mine(j.data.book))
      const running = [...new Map([...running1, ...running2].map((j) => [j.id, j])).values()]
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
      if (running.length === 0 && pending.length === 0) {
        // a job that just ended may have queued its next jobs after the read above: look once more before saying idle
        if (idleSeen) return { failed: current, timedOut: false }
        idleSeen = true
        await new Promise((r) => setTimeout(r, 75))
        continue
      }
      idleSeen = false
      if (Date.now() > end) return { failed: current, timedOut: true }
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
