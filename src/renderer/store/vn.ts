import type {
  AlignReportView,
  AssetView,
  BuildResult,
  ComfyEngineView,
  CustomWorkflowInfo,
  EngineEvent,
  EngineInfo,
  ImportPreview,
  PipelineStep,
  ProjectDetail,
  RenpyConfigView,
  ProjectSummary,
  SourceBook,
  StepStatus,
  StudioStatusView,
  ThemeInfo,
  VoiceEngineView
} from '../../shared/protocol'
import type { Edition, Lang } from '../../shared/vn'

export interface ComfyStatusView {
  ok: boolean
  lanes: { url: string; reachable: boolean; running: number; pending: number; error: string }[]
  engines: ComfyEngineView[]
  customWorkflows: string[]
  backgroundRemoval: { available: boolean; models: string[] }
}

/** The local voice engines (TTS Audio Suite) and the custom TTS workflows, as the last `voice.status` saw them. */
export interface VoiceStatusView {
  ok: boolean
  error: string
  comfyUrl: string
  /** The engine every language without a `voice.engines` entry uses (the registry default, OmniVoice). */
  defaultEngine: string
  engines: VoiceEngineView[]
  /** The custom TTS workflows: their name and the language codes their mapping declares. */
  workflows: { name: string; languages: string[] }[]
}

/** The last preview clip of a voice slot (speaker and language, `voice.preview`), `file` relative to the project folder. */
export interface VoicePreviewView {
  voice: string
  file: string
  rev: number
  lang: Lang
}

export interface CommandErrorView {
  command: string
  message: string
  slug?: string
  at: number
}

/** The VN part of the UI state: what the engine answered about the library, projects, assets, themes and ComfyUI. */
export interface VnData {
  sourceBooks: SourceBook[] | null
  scriptoriumData: string
  projects: Record<string, ProjectSummary>
  projectsLoaded: boolean
  details: Record<string, ProjectDetail>
  /** slug -> asset id -> asset. */
  assets: Record<string, Record<string, AssetView>>
  /** slug:id -> counter that grows with every `asset.updated`, to refresh a replaced file under the same name. */
  assetRev: Record<string, number>
  /** `<slug>:<assetId>` -> latest prompt suggestion from `suggestAssetPrompt`. */
  promptSuggestions: Record<string, { prompt: string; source: 'ai' | 'fallback'; rev: number }>
  editions: Record<string, Partial<Record<Lang, Edition>>>
  alignReports: Record<string, Partial<Record<Lang, AlignReportView | null>>>
  /** Live step statuses from `pipeline.progress`, over the saved ones in the project summary. */
  progress: Record<string, Partial<Record<PipelineStep, StepStatus>>>
  builds: Record<string, Partial<Record<BuildResult['action'], BuildResult>>>
  themes: ThemeInfo[]
  engines: { image: EngineInfo[]; audio: EngineInfo[]; palettes: string[] } | null
  workflows: CustomWorkflowInfo[]
  comfy: ComfyStatusView | null
  /** The local voice engines and custom TTS workflows (null until `voiceStatus` was answered). */
  voiceStatus: VoiceStatusView | null
  /** Pixel Studio and Chiptune Studio (null until `studiosStatus` was answered). */
  studios: StudioStatusView[] | null
  /** `<slug>:<assetId>` -> what the last "Open in ... Studio" said. */
  studioOpened: Record<string, string>
  /** `<slug>:<speakerKey>` -> the last preview clip. */
  voicePreviews: Record<string, VoicePreviewView>
  /** config/renpy.md, from `getRenpyConfig` / `saveRenpyConfig`. */
  renpy: RenpyConfigView | null
  /** The answer to the last `comfyFree`. */
  freed: { lane: string; ok: boolean; error?: string }[] | null
  /** The preview of the import being confirmed. */
  importPreview: ImportPreview | null
  /** The slug of the project the last import made (the dialog opens it). */
  lastImported: string | null
  errors: CommandErrorView[]
  /** The Book page shows this project. */
  currentSlug: string | null
}

export function initialVn(): VnData {
  return {
    sourceBooks: null,
    scriptoriumData: '',
    projects: {},
    projectsLoaded: false,
    details: {},
    assets: {},
    assetRev: {},
    promptSuggestions: {},
    editions: {},
    alignReports: {},
    progress: {},
    builds: {},
    themes: [],
    engines: null,
    workflows: [],
    comfy: null,
    voiceStatus: null,
    studios: null,
    studioOpened: {},
    voicePreviews: {},
    freed: null,
    renpy: null,
    importPreview: null,
    lastImported: null,
    errors: [],
    currentSlug: null
  }
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = rec
  return rest
}

/** Pure reducer for the VN events. Returns only what changed. */
export function reduceVn(s: VnData, e: EngineEvent, now = Date.now()): Partial<VnData> {
  switch (e.type) {
    case 'books.listed':
      return { sourceBooks: e.books, scriptoriumData: e.scriptoriumData }
    case 'import.preview':
      return { importPreview: e.preview }
    case 'import.done':
      return { lastImported: e.slug, importPreview: null }
    case 'projects.listed': {
      const projects: Record<string, ProjectSummary> = {}
      for (const p of e.projects) projects[p.slug] = p
      return { projects, projectsLoaded: true }
    }
    case 'project.loaded': {
      const progress = s.progress[e.slug]
      // a fresh load has the saved statuses; drop live ones from an older run
      const keep = progress && e.project.summary.pipeline ? Object.fromEntries(Object.entries(progress).filter(([step, st]) => st.at > (e.project.summary.pipeline!.steps[step as PipelineStep]?.at ?? ''))) : progress
      const builds = { ...(s.builds[e.slug] ?? {}) }
      if (e.project.build) builds[e.project.build.action] = e.project.build
      if (e.project.lint) builds.lint = e.project.lint
      return {
        details: { ...s.details, [e.slug]: e.project },
        projects: { ...s.projects, [e.slug]: e.project.summary },
        progress: keep ? { ...s.progress, [e.slug]: keep } : s.progress,
        builds: { ...s.builds, [e.slug]: builds }
      }
    }
    case 'project.updated': {
      const d = s.details[e.slug]
      return {
        projects: { ...s.projects, [e.slug]: e.project },
        details: d ? { ...s.details, [e.slug]: { ...d, summary: e.project } } : s.details
      }
    }
    case 'project.deleted':
      return {
        projects: omit(s.projects, e.slug),
        details: omit(s.details, e.slug),
        assets: omit(s.assets, e.slug),
        currentSlug: s.currentSlug === e.slug ? null : s.currentSlug
      }
    case 'edition.loaded':
      return { editions: { ...s.editions, [e.slug]: { ...(s.editions[e.slug] ?? {}), [e.lang]: e.edition } } }
    case 'edition.updated': {
      const ed = s.editions[e.slug]?.[e.lang]
      if (!ed) return {}
      return { editions: { ...s.editions, [e.slug]: { ...s.editions[e.slug], [e.lang]: { ...ed, beats: { ...ed.beats, [e.beatId]: e.text } } } } }
    }
    case 'align.report':
      return { alignReports: { ...s.alignReports, [e.slug]: { ...(s.alignReports[e.slug] ?? {}), [e.lang]: e.report } } }
    case 'assets.listed': {
      const map: Record<string, AssetView> = {}
      for (const a of e.assets) map[a.id] = a
      const rev = { ...s.assetRev }
      for (const a of e.assets) rev[`${e.slug}:${a.id}`] = rev[`${e.slug}:${a.id}`] ?? 0
      return { assets: { ...s.assets, [e.slug]: map }, assetRev: rev }
    }
    case 'asset.updated': {
      const key = `${e.slug}:${e.asset.id}`
      return {
        assets: { ...s.assets, [e.slug]: { ...(s.assets[e.slug] ?? {}), [e.asset.id]: e.asset } },
        assetRev: { ...s.assetRev, [key]: (s.assetRev[key] ?? 0) + 1 }
      }
    }
    case 'asset.prompt.suggested': {
      const key = `${e.slug}:${e.id}`
      return {
        promptSuggestions: {
          ...s.promptSuggestions,
          [key]: { prompt: e.prompt, source: e.source, rev: (s.promptSuggestions[key]?.rev ?? 0) + 1 }
        }
      }
    }
    case 'pipeline.progress':
      return { progress: { ...s.progress, [e.slug]: { ...(s.progress[e.slug] ?? {}), [e.step]: e.status } } }
    case 'build.result':
      return { builds: { ...s.builds, [e.result.slug]: { ...(s.builds[e.result.slug] ?? {}), [e.result.action]: e.result } } }
    case 'themes.listed':
      return { themes: e.themes }
    case 'comfy.status':
      return { comfy: { ok: e.ok, lanes: e.lanes, engines: e.engines, customWorkflows: e.customWorkflows, backgroundRemoval: e.backgroundRemoval } }
    case 'renpy.config': {
      const { type: _t, ...view } = e
      return { renpy: view }
    }
    case 'voice.status': {
      const { type: _t, ...view } = e
      return { voiceStatus: view }
    }
    case 'studios.status':
      return { studios: e.studios }
    case 'studio.opened':
      return { studioOpened: { ...s.studioOpened, [`${e.slug}:${e.id}`]: e.message } }
    case 'voice.preview':
      return { voicePreviews: { ...s.voicePreviews, [`${e.slug}:${e.speakerKey}:${e.lang}`]: { voice: e.voice, file: e.file, rev: e.rev, lang: e.lang } } }
    case 'comfy.freed':
      return { freed: e.results }
    case 'engines.listed':
      return { engines: { image: e.image, audio: e.audio, palettes: e.palettes } }
    case 'workflows.listed':
      return { workflows: e.workflows }
    case 'command.error':
      return { errors: [...s.errors.slice(-19), { command: e.command, message: e.message, slug: e.slug, at: now }] }
    default:
      return {}
  }
}
