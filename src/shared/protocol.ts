/**
 * Engine <-> UI protocol. The engine sends events and accepts commands.
 * A Transport carries them. Today that is the Electron utilityProcess port. Later it could be a WebSocket.
 */

import type { AssetEntry, Edition, Lang, ProjectSettings, VnBook } from './vn'

export type AgentState = 'working' | 'reviewing' | 'waiting-provider' | 'waiting-research' | 'idle' | 'error' | 'paused'

/**
 * Why a model didn't answer an agent: `day-limit` (the provider's requests for today are used up), `rate-limit` (too many
 * requests now, HTTP 429), `down` (the server isn't running), `too-big` (the request doesn't fit the model's context or answer
 * budget), `no-access` (401/403: key missing or wrong), `no-credit` (402), `not-found` (404: no such model), `bad-request`
 * (another 4xx), `server` (5xx), `budget` (a paid model over a spending cap), `other`.
 */
export type ProblemKind = 'day-limit' | 'rate-limit' | 'down' | 'too-big' | 'no-access' | 'no-credit' | 'not-found' | 'bad-request' | 'server' | 'budget' | 'other'

/** The last failed request of an agent, kept until one of its requests is answered again. */
export interface AgentProblem {
  kind: ProblemKind
  /** `provider/model` that failed. */
  model: string
  /** The error, shortened. */
  message: string
  /** When it happened (ms since epoch). */
  at: number
  /** The job failed for good on it (every model of the role failed), rather than retrying or falling back. */
  failed?: boolean
}

export interface ModelSummary {
  /** `provider/model`, the id used in `setModel` and in config files. */
  ref: string
  provider: string
  model: string
  family: string
  local: boolean
  /** The kind a fallback row with this model has: `paid` for an API model, otherwise its provider's id (`strata`, `lmstudio`, `client` ...). */
  kind: string
  /** The fallback group it belongs to (`paid`, `strata`, `lmstudio`, or a provider id), see `ModelGroup`. Missing for the client provider. */
  group?: string
  /** True when the provider is switched on and usable (has a key, or is local). */
  enabled: boolean
  /** The pickers offer it: not hidden in the Models dialog (config/models.md). */
  shown: boolean
  /** Where it comes from: providers.md, the provider's own list (`discover`), or picked in the Models dialog. */
  source: 'config' | 'discovered' | 'picked'
  context?: number
  /** Accepts images (a vision model). */
  vision: boolean
  /** USD per 1M tokens. */
  priceIn: number
  priceOut: number
}

/** A model provider for the Models dialog (search services are left out). */
export interface ProviderSummary {
  id: string
  /** The name shown on screen (`name` in providers.md), else the id. */
  name: string
  kind: string
  local: boolean
  /** Added in the Add provider form: it can be edited and removed there. */
  custom: boolean
  /** Switched on in providers.md (it may still be unavailable: no key). */
  enabled: boolean
  baseUrl?: string
  /** Sends the JSON schema as `response_format`. */
  jsonSchema: boolean
  /** The key variable (`api_key_env`), and whether a key was found for it. */
  keyName?: string
  keySet: boolean
  /** Switched on and usable (has a key, or is local). */
  available: boolean
  /** Why it isn't available: switched off, or no key. */
  reason?: string
  /** The key comes from another tool's credential store (`the scriptorium credential store`). */
  keyFrom?: string
  /** It can list its models (`GET /models`, OpenAI-style providers). */
  canList: boolean
  /** Requests at once. With `concurrencyAuto` the server sets it (Strata, LM Studio), so it can't be changed here. */
  concurrency: number
  concurrencyAuto: boolean
  /** Requests per minute and per day; missing means no limit. */
  rpm?: number
  rpd?: number
  /** Requests sent since midnight UTC, when daily limits start again. */
  requestsToday: number
  /** The daily limit is used up: its jobs use their next model until `dayResetsAt` (epoch ms). */
  dayFull: boolean
  dayResetsAt: number
}

/** A model a provider lists, from `detectModels`. */
export interface CatalogModel {
  id: string
  /** `provider/model`. */
  ref: string
  context?: number
  /** USD per 1M tokens, when the provider lists prices. */
  priceIn?: number
  priceOut?: number
  /** It can be shown in the pickers: local, or with a listed price (a paid model the budget can't price never is). */
  pickable: boolean
}

/** A local model server the engine checks (Strata, LM Studio): running or not, and how many requests it serves at once. */
export interface ServerStatus {
  /** Provider id: `strata`, `lmstudio`. */
  id: string
  down: boolean
  slots: number
}

export interface AgentSummary {
  id: string
  name: string
  role: string
  /** The agent's own override (`provider/model`), or null. */
  model: string | null
  /** The model its running job calls now, else what it will use for its next job: the override, else the role default (first usable model). */
  resolvedModel: string | null
  /** The project the agent is assigned to (`pin` in its file): it only takes that project's jobs. Null when it takes any job. */
  pin: string | null
  paused: boolean
  state: AgentState
  /** What it is doing now, when it has a job. */
  task?: string
  /** The project of the job it works on. */
  book?: string
  jobId?: string
  /** Its last request failed and none has been answered since. */
  problem?: AgentProblem
}

export interface SettingsSummary {
  /** `fallbacks` in settings.md: `provider/model` refs, first row first. A kind name (`paid`, `strata` ...) stands for the first row of that kind, `<kind>-<n>` for the n-th. */
  fallbacks: string[]
  /** `fallback_shared`: every role tries the rows top to bottom. False: each role keeps its own list from roles.md. */
  fallbackShared: boolean
  /** `provider/model` behind each role alias, per group: kept for compatibility */
  groupDefaults?: Record<string, string>
  /** `model_order` in settings.md: kept for compatibility */
  modelOrder?: ModelGroup[]
  /** How the engine loads LM Studio models: requests at once, context window, idle minutes before unloading. */
  lmstudioParallel: number
  lmstudioContext: number
  lmstudioTtlMinutes: number
  /** The Scriptorium data folder, whose `books/` the library lists. */
  scriptoriumData: string
}

/** A fallback group: `paid` (every non-local seed API provider), or a provider id (`strata`, `lmstudio`, `acp`, a custom provider). */
export type ModelGroup = string

export interface SnapshotEvent {
  type: 'snapshot'
  dataDir: string
  uptimeMs: number
  /** Pause all. */
  paused: boolean
  agents: AgentSummary[]
  /** Every chat model the engine knows, including the LM Studio models found on this machine. The pickers offer the `shown` ones. */
  models: ModelSummary[]
  providers: ProviderSummary[]
  /** Role -> `provider/model` of the role default (first in the role's list). */
  roleDefaults: Record<string, string>
  servers: ServerStatus[]
  spend: { today: number; month: number; dailyCap: number; monthlyCap: number }
  running: { jobId: string; agent: string }[]
  settings: SettingsSummary
  /** Names of secrets that are set (never their values): the provider key variables. */
  secretsSet: string[]
  /** Every key variable the app may store (`api_key_env` of the providers), for the Settings key select. */
  keyNames: string[]
  at: string
}

// ---- VN projects, assets, pipeline (see docs/protocol.md) ----

/** A book in the Scriptorium library (or any listed folder) that can be imported. */
export interface SourceBook {
  slug: string
  title: string
  format: string
  script: boolean
  stage: string
  hasChoices: boolean
  /** The book folder. */
  path: string
}

/** What an import would make of a folder, with the detected language to confirm or override. */
export interface ImportPreview {
  /** The text the command was given (a folder, or a Scriptorium book slug). */
  source: string
  /** The folder it resolved to. */
  path: string
  slug: string
  title: string
  format: string
  kind: 'linear' | 'choice'
  detected: { lang: Lang; confidence: number }
  chapters: number
  characters: number
  places: number
  /** Items the script-analyst will settle. */
  uncertain: number
  warnings: string[]
}

export type StepState = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export interface StepStatus {
  status: StepState
  message: string
  at: string
  /** Progress inside a step (assets generated of the assets to generate). */
  done?: number
  total?: number
}

/** The pipeline steps, in order. */
export type PipelineStep = 'import' | 'analyse' | 'art' | 'music' | 'generate' | 'voice' | 'stage' | 'build' | 'lint'

export interface PipelineStatus {
  /** The run number: the `r<n>` in the job ids. */
  run: number
  from: PipelineStep
  startedAt: string
  steps: Partial<Record<PipelineStep, StepStatus>>
}

export interface AssetCounts {
  total: number
  /** Has a usable file (the selected version or a custom file). */
  ready: number
  missing: number
  locked: number
  custom: number
}

/** One line of the Library and the header of the Book page. */
export interface ProjectSummary {
  slug: string
  title: string
  format: string
  kind: 'linear' | 'choice'
  genre?: string
  primaryLang: Lang
  editions: Lang[]
  theme: string | null
  chapters: number
  characters: number
  places: number
  voice: boolean
  assets: AssetCounts
  warnings: number
  pipeline: PipelineStatus | null
  updatedAt: string
}

export type StageSlotView = 'left' | 'center' | 'right'
export type SceneTransitionView = 'dissolve' | 'fade' | 'none'

/** A stage cue on one beat: the picture shown (null hides it), an effect played, an ambience started (null stops it). */
export interface BeatCueView {
  image?: string | null
  sfx?: string
  ambience?: string | null
}

export interface SceneCuesView {
  transition?: SceneTransitionView
  pause?: number
  /** Music of this scene: a track id, null for silence. Missing: the story's `scene.music`, else the chapter track. */
  music?: string | null
  /** Ambience of this scene: a sound key, null to stop it. Missing: the story's `scene.ambience`, else what plays. */
  ambience?: string | null
  casts: Record<string, Record<string, StageSlotView>>
  /** Beat cues of this scene (picture, sound effect, ambience). */
  beats?: Record<string, BeatCueView>
}

/** The stage music outside the scenes: the main menu track and the track of each chapter. */
export interface StageMusicView {
  menu: string | null
  /** Chapter number (as a string) -> music asset id, or null for no music. */
  chapters: Record<string, string | null>
}

/** The whole project for the Book page. `book` is vn.json (structure and the primary text). */
export interface ProjectDetail {
  summary: ProjectSummary
  settings: ProjectSettings
  book: VnBook
  /** The last build and lint results, when there are any. */
  build: BuildResult | null
  lint: BuildResult | null
  /** The theme the build would use (the chosen one, or the automatic pick). */
  resolvedTheme: string
  /** Queued, running, done and failed jobs of this project. */
  jobs: { queued: number; running: number; done: number; failed: number }
  /** Scene and cast cues from `cues.json` (keyed by scene ID). */
  cues: Record<string, SceneCuesView>
  /** The menu and chapter tracks from `cues.json`, used by the Scenes preview. */
  stageMusic: StageMusicView
}

/** An asset for the gallery: the entry, the path of its current file (relative to the project folder) and whether the book still needs it. */
export interface AssetView extends AssetEntry {
  /** `assets/<id>/v2.webp`, or null when there is no file yet. */
  fileRel: string | null
  /** Relative paths of every version file, by version number. */
  versionFiles: Record<number, string>
  /** The book no longer uses it (kept, never deleted). */
  orphaned: boolean
}

export interface AlignReportView {
  matched: number
  missing: string[]
  extra: { chapter: number; scene: number; text: string }[]
  nameMap: Record<string, string>
  placeMap: Record<string, string>
  warnings: string[]
}

/** The result of a build or lint. */
export interface BuildResult {
  slug: string
  action: 'build' | 'lint'
  ok: boolean
  /** A step that could not run (no Ren'Py SDK): ok is false and this says why. */
  skipped?: boolean
  messages: string[]
  at: string
  gameDir?: string
  theme?: string
  /** Asset ids that were drawn as placeholders (no file yet). */
  placeholders?: string[]
  /** The Ren'Py languages that got a translation. */
  translated?: string[]
  /** Lint statistics. */
  statistics?: string
}

export interface ThemeInfo {
  name: string
  label: string
  description: string
  light: boolean
  pixel: boolean
  /** CSS for the live preview: `.vnp-stage`, `.vnp-textbox`, `.vnp-name`, `.vnp-text`, `.vnp-menu`, `.vnp-choice`. */
  previewCss: string
  /** Absolute folder of the theme (its `fonts/` hold the font files the preview loads). */
  dir: string
}

export interface EngineInfo {
  id: string
  kind: 'image' | 'audio'
  label: string
  /** Edit engines take a reference image. */
  edit: boolean
}

export interface CustomWorkflowInfo {
  name: string
  kind: 'image' | 'audio'
  /** Language codes the mapping declares (a TTS workflow); empty for the other kinds. */
  languages: string[]
}

export type EngineEvent =
  | { type: 'engine.ready'; pid: number; dataDir: string; at: string }
  | { type: 'engine.heartbeat'; n: number; at: string; uptimeMs: number }
  | { type: 'pong'; id?: string; at: string }
  | SnapshotEvent
  | { type: 'engine.warning'; message: string }
  | { type: 'agent.state'; agent: string; role: string; state: AgentState; jobId?: string; task?: string; book?: string }
  | { type: 'agent.hired'; agent: AgentSummary }
  | { type: 'agent.removed'; agent: string }
  /** An agent's file changed (its model, paused, ...). */
  | { type: 'agent.updated'; agent: AgentSummary }
  | { type: 'factory.paused'; paused: boolean }
  | { type: 'job.started'; jobId: string; agent: string; task: string; book?: string; model?: string }
  /** A request of the agent failed (`problem`), or one was answered again after that (`null`). */
  | { type: 'agent.problem'; agent: string; problem: AgentProblem | null }
  /** The job moved to another model (a fallback after a failure), so the office shows the one answering now. */
  | { type: 'job.model'; jobId: string; agent: string; model: string }
  | { type: 'job.token'; jobId: string; agent: string; text: string }
  /** A local model server went down, came back or changed its slot count. */
  | { type: 'servers'; servers: ServerStatus[] }
  | { type: 'job.done'; jobId: string; agent: string; ok: boolean; result?: string; error?: string }
  /** A job asked by another agent (or you) starts or ends: who handed it to whom. */
  | { type: 'handover'; from: string; to: string; label: string; jobId?: string; done?: boolean }
  | {
      type: 'spend'
      provider: string
      model: string
      tokensIn: number
      tokensOut: number
      costUsd: number
      agent?: string
      book?: string
    }
  | { type: 'secrets.updated'; secretsSet: string[]; keyNames?: string[] }
  /** The answer to `testCustomProvider`: `GET /models` worked (`count` models) or failed (`error`). */
  | { type: 'provider.tested'; ok: boolean; count?: number; error?: string; at: string }
  /** The answer to `saveCustomProvider` and `removeCustomProvider`: done, or why it was refused. */
  | { type: 'provider.saved'; ok: boolean; id?: string; removed?: boolean; error?: string }
  /** The answer to `detectModels`: every chat model the provider lists, or why it couldn't be asked. */
  | { type: 'models.catalog'; provider: string; models: CatalogModel[]; error?: string; at: string }
  // ---- VN: answers to the queries, and what changes while jobs run ----
  /** A command failed (bad slug, missing file ...). `slug` is set when the command was about a project. */
  | { type: 'command.error'; command: string; message: string; slug?: string }
  | { type: 'books.listed'; books: SourceBook[]; scriptoriumData: string }
  | { type: 'import.preview'; preview: ImportPreview }
  /** A project was imported (or re-imported). */
  | { type: 'import.done'; slug: string; preview: ImportPreview }
  | { type: 'projects.listed'; projects: ProjectSummary[] }
  | { type: 'project.loaded'; slug: string; project: ProjectDetail }
  /** A project's summary changed (imported, settings, a pipeline step, an asset count ...). */
  | { type: 'project.updated'; slug: string; project: ProjectSummary }
  | { type: 'project.deleted'; slug: string }
  | { type: 'edition.loaded'; slug: string; lang: Lang; edition: Edition }
  | { type: 'edition.updated'; slug: string; lang: Lang; beatId: string; text: string }
  | { type: 'align.report'; slug: string; lang: Lang; report: AlignReportView | null }
  | { type: 'assets.listed'; slug: string; assets: AssetView[] }
  /** One asset changed: a version was added, it was locked, replaced, a version was picked, a review finished. */
  | { type: 'asset.updated'; slug: string; asset: AssetView }
  /** A prompt suggestion generated (or derived) for the Regenerate dialog. */
  | { type: 'asset.prompt.suggested'; slug: string; id: string; prompt: string; source: 'ai' | 'fallback' }
  /** A pipeline step changed state or counted a unit of work. */
  | { type: 'pipeline.progress'; slug: string; step: PipelineStep; status: StepStatus }
  | { type: 'build.result'; result: BuildResult }
  | { type: 'themes.listed'; themes: ThemeInfo[] }
  | {
      type: 'comfy.status'
      ok: boolean
      lanes: { url: string; reachable: boolean; running: number; pending: number; error: string }[]
      engines: { id: string; kind: 'image' | 'audio'; label: string; ready: boolean; missing: string[] }[]
      customWorkflows: string[]
      backgroundRemoval: { available: boolean; models: string[] }
    }
  | { type: 'comfy.freed'; results: { lane: string; ok: boolean; error?: string }[] }
  | { type: 'engines.listed'; image: EngineInfo[]; audio: EngineInfo[]; palettes: string[] }
  | { type: 'workflows.listed'; workflows: CustomWorkflowInfo[] }
  /** VibeTTS (MCP): reachable or not, and its voices. The answer to `voiceStatus`. */
  | { type: 'voice.status'; ok: boolean; url: string; error: string; supertonicInstalled: boolean; languages: string[]; english: VibeDefaultView; other: VibeDefaultView; voices: VibeVoiceView[] }
  /** A preview clip of a voice (`setVoice`, `previewVoice`): `file` is relative to the project folder; `rev` busts the player's cache. */
  | { type: 'voice.preview'; slug: string; speakerKey: string; voice: string; file: string; rev: number; lang: Lang }
  /** Pixel Studio and Chiptune Studio (MCP): reachable or not. The answer to `studiosStatus`. */
  | { type: 'studios.status'; studios: StudioStatusView[] }
  /** An asset was opened in a studio (`openInStudio`): `window` when a window was started, `mcp` when a running studio was asked. Saving there makes a new version. */
  | { type: 'studio.opened'; slug: string; id: string; studio: 'pixel' | 'chiptune'; mode: 'window' | 'mcp'; message: string }
  /** The game was started (`runGame`). */
  | { type: 'game.started'; slug: string; pid: number | null }
  /** The MCP HTTP server (config/mcp.md): listening or not. Sent when it changes and as the answer to `mcpStatus` and `saveMcpConfig`. `error` is empty when there is none; `token` is never sent, only whether one is set. */
  | { type: 'mcp.status'; enabled: boolean; listening: boolean; url: string | null; error: string; port: number; tokenSet: boolean }
  /** The Ren'Py settings (config/renpy.md): the answer to `getRenpyConfig` and `saveRenpyConfig`. */
  | ({ type: 'renpy.config' } & RenpyConfigView)

/** One studio app (Pixel Studio, Chiptune Studio) as `studiosStatus` saw it. */
export interface StudioStatusView {
  id: 'pixel' | 'chiptune' | 'flow'
  name: string
  ok: boolean
  url: string
  /** Why it is not reachable (includes how to start it). */
  error: string
  /** The app folder from config/studios.md. */
  repo: string
  /** How to start it headless. */
  hint: string
  /** The number of tools it offers, when reachable. */
  tools: number
}

/** A VibeTTS voice as `list_voices` gives it: a Kokoro voice reads English only, a Supertonic voice 31 languages. */
export interface VibeVoiceView {
  id: string
  label: string
  engine: string
  /** The language codes it reads. */
  languages: string[]
}

/** The user's default voice in VibeTTS (its `english` or `other` profile): the engine, or the language, and the voice id. Empty when unknown. */
export interface VibeDefaultView {
  engine: string
  language: string
  voice: string
}

/** What the Settings page shows of config/renpy.md. */
export interface RenpyConfigView {
  sdkPath: string
  /** `WIDTHxHEIGHT`. */
  resolution: string
  imageFormat: 'webp' | 'png'
  /** `renpy.exe` (or `renpy.sh`) exists in `sdkPath`. */
  sdkFound: boolean
  /** The `VNO_RENPY_SDK` environment variable is set: it wins over `sdkPath`. */
  envOverride: boolean
  /** A problem that does not stop the save, for example the SDK folder is missing. */
  warning?: string
}

export type EngineEventType = EngineEvent['type']

export type Command =
  | { type: 'hire'; role: string; name?: string; model?: string }
  | { type: 'fire'; agent: string; now?: boolean }
  | { type: 'pause'; agent: string }
  | { type: 'resume'; agent: string }
  | { type: 'stop'; agent: string }
  | { type: 'pauseAll' }
  | { type: 'resumeAll' }
  | { type: 'stopNow' }
  /** `model: null` with an `agent` clears that agent's override. */
  | { type: 'setModel'; model: string | null; agent?: string; role?: string }
  /** Asks a provider for every model it has (`GET /models`). Answers with `models.catalog`. */
  | { type: 'detectModels'; provider: string }
  /** Shows models in the pickers, or hides them (config/models.md). A listed model that isn't known yet is added with its listed price. */
  | { type: 'showModels'; refs: string[]; shown: boolean }
  /** Adds a model by its id to `picked` in config/models.md, for one the provider doesn't list. A paid provider needs both prices (USD per 1M tokens, 0 for free). */
  | { type: 'addModel'; provider: string; id: string; priceIn?: number; priceOut?: number; context?: number; vision?: boolean }
  /**
   * Adds a provider to config/providers.md (`custom: true`), or edits the custom provider `id`. The key goes to the credential store (an empty
   * `apiKey` on an edit keeps the stored one). `free`: a local, keyless provider with no budget. Answers with `provider.saved`.
   */
  | { type: 'saveCustomProvider'; id?: string; name: string; baseUrl: string; apiKey?: string; free: boolean; jsonSchema: boolean; concurrency: number | 'auto'; enabled: boolean }
  /** Removes a custom provider, its stored key, and what config/models.md and config/settings.md say about it. Answers with `provider.saved`. */
  | { type: 'removeCustomProvider'; id: string }
  /** Calls `GET <baseUrl>/models` to see whether the server answers. `id`: an edited provider, whose stored key is used when `apiKey` is empty. Answers with `provider.tested`. */
  | { type: 'testCustomProvider'; baseUrl: string; apiKey?: string; id?: string }
  /**
   * Sets a provider's limits in config/models.md, over providers.md: requests at once (not for a server that reports its own),
   * per minute and per day. 0 for `rpm` or `rpd` means no limit; a field left out keeps its value.
   */
  | { type: 'setProviderLimits'; provider: string; concurrency?: number; rpm?: number; rpd?: number }
  /** Any of the settings may be left out: they keep their value. */
  | ({ type: 'saveSettings' } & Partial<SettingsSummary>)
  /** Stores a secret in the Windows credential store. Only the provider key variables are allowed. */
  | { type: 'setSecret'; name: string; value: string }
  | { type: 'snapshot' }
  | { type: 'ping'; id?: string }
  /** Check the local model servers now (Strata was just started), instead of at the next 10-second check. */
  | { type: 'checkServers' }
  // ---- VN (docs/protocol.md) ----
  /** The books of the Scriptorium library. Answers with `books.listed`. */
  | { type: 'listSourceBooks' }
  /** What importing this folder or Scriptorium slug would give, with the detected language. Answers with `import.preview`. */
  | { type: 'previewImport'; source: string }
  /** Imports a book: makes the project with the language you confirmed (`lang`) or the detected one. `run` starts the pipeline. Answers with `import.done` and `project.updated`. */
  | { type: 'importProject'; source: string; lang?: Lang; run?: boolean }
  | { type: 'listProjects' }
  | { type: 'getProject'; slug: string }
  /** `patch` is merged into project.md (theme, art, music, voice). */
  | { type: 'updateProjectSettings'; slug: string; patch: ProjectSettingsPatch }
  /** Deletes the project folder. Only this command ever deletes a project. */
  | { type: 'deleteProject'; slug: string }
  /** Enqueues the pipeline from a step (default: analyse, or import when there is no vn.json). `force` plans and generates again. */
  | { type: 'runPipeline'; slug: string; from?: PipelineStep; force?: boolean }
  /** Aborts running jobs for this project and drops its queued jobs. */
  | { type: 'stopPipeline'; slug: string }
  /** Adds a translated edition from a book folder (or Scriptorium slug). */
  | { type: 'addEdition'; slug: string; source: string; lang: Lang }
  | { type: 'getEdition'; slug: string; lang: Lang }
  | { type: 'updateEditionBeat'; slug: string; lang: Lang; beatId: string; text: string }
  | { type: 'getAlignReport'; slug: string; lang: Lang }
  | { type: 'listAssets'; slug: string }
  /** Generates the asset again as a new version (selected). `prompt`, `engine` and `seed` change the entry first. */
  | { type: 'regenerateAsset'; slug: string; id: string; prompt?: string; engine?: string; seed?: number }
  /** Generates a suggested prompt for an asset in the Regenerate modal without saving or queueing a job. Answers with `asset.prompt.suggested`. */
  | { type: 'suggestAssetPrompt'; slug: string; id: string; instructions?: string }
  /** Uses this file for the asset: it becomes `custom` and locked. */
  | { type: 'replaceAsset'; slug: string; id: string; file: string }
  | { type: 'pickAssetVersion'; slug: string; id: string; n: number }
  | { type: 'lockAsset'; slug: string; id: string }
  | { type: 'unlockAsset'; slug: string; id: string }
  | { type: 'buildGame'; slug: string }
  | { type: 'lintGame'; slug: string }
  /** Starts the built game. Answers with `game.started`. */
  | { type: 'runGame'; slug: string }
  | { type: 'listThemes' }
  | { type: 'comfyStatus' }
  | { type: 'comfyFree' }
  | { type: 'listEngines' }
  | { type: 'listCustomWorkflows' }
  /** Reads config/renpy.md. Answers with `renpy.config`. */
  | { type: 'getRenpyConfig' }
  /** Writes the given fields to config/renpy.md (the others keep their value). A missing SDK is a `warning` in the answer, not an error; a bad resolution is a `command.error`. Answers with `renpy.config`. */
  | { type: 'saveRenpyConfig'; sdkPath?: string; resolution?: string; imageFormat?: 'webp' | 'png' }
  /** Asks for the state of the MCP server. Answers with `mcp.status`. */
  | { type: 'mcpStatus' }
  /** Writes config/mcp.md and restarts the server when enabled, port or token changed. `token` left out keeps the old one, `''` clears it. Answers with `mcp.status`. */
  | { type: 'saveMcpConfig'; enabled: boolean; port: number; token?: string }
  /** The voice reference clip of a character (or `narrator`): becomes the voice_<charKey> asset, custom and locked. */
  | { type: 'setVoiceRef'; slug: string; charKey: string; file: string }
  /** Generates the TTS clips (all languages of the project, or one `lang`, or one `beatId`, or at most `limit` clips per language). Nothing happens when the project's voice is off. */
  | { type: 'generateVoice'; slug: string; lang?: Lang; beatId?: string; limit?: number }
  /** Checks VibeTTS (its MCP server) and lists its voices. Answers with `voice.status`. */
  | { type: 'voiceStatus' }
  /** Checks Pixel Studio and Chiptune Studio (their MCP servers). Answers with `studios.status`. */
  | { type: 'studiosStatus' }
  /** Opens an asset in its studio (images in Pixel Studio, music in Chiptune Studio). Each save there becomes a new custom, locked version. Answers with `studio.opened`. */
  | { type: 'openInStudio'; slug: string; id: string }
  /** Enqueues the voice plan: a VibeTTS voice per character and the narrator (existing ones are kept unless `overwrite`). */
  | { type: 'planVoices'; slug: string; overwrite?: boolean }
  /** Picks the VibeTTS voice of a speaker (a character key or `narrator`) for one language, forgets that speaker's clips in it and answers with `voice.preview`. */
  | { type: 'setVoice'; slug: string; speakerKey: string; lang: Lang; voice: string }
  /** Makes a short preview clip of a VibeTTS voice in a language. Answers with `voice.preview`. */
  | { type: 'previewVoice'; slug: string; speakerKey: string; voice: string; lang?: Lang }
  /** Updates stage cues (scene transitions/pauses and cast slot positions) for one or more scenes/beats. */
  | {
      type: 'updateSceneCues'
      slug: string
      scenes?: { id: string; transition?: SceneTransitionView | null; pause?: number | null }[]
      casts?: { beatId: string; slots: Record<string, StageSlotView> }[]
      /** Queue a build afterwards. */
      rebuild?: boolean
    }
  /** Updates scene metadata (place, time, music, ambience, description) and/or beat fields (cast, speaker, expression, image, sfx, ambience). */
  | {
      type: 'updateSceneStory'
      slug: string
      scenes?: { id: string; placeKey?: string | null; time?: string | null; music?: string | null; ambience?: string | null; description?: string }[]
      beats?: { id: string; cast?: string[]; speakerKey?: string | null; expression?: string; image?: string | null; sfx?: string | null; ambience?: string | null }[]
      /** Queue a build afterwards. */
      rebuild?: boolean
    }

/** The settings an `updateProjectSettings` command may change (each part is merged into the current one). */
export interface ProjectSettingsPatch {
  theme?: string | null
  /** Role -> `provider/model` for this project, merged into the current ones; `null` clears a role. */
  models?: Record<string, string | null>
  /** `null` clears an optional field (`palette`, `stylePrompt`, `provider`, `pixelProvider`, `pixel`). `pixel` is merged field by field. */
  art?: Partial<Omit<ProjectSettings['art'], 'palette' | 'stylePrompt' | 'provider' | 'pixelProvider' | 'pixel' | 'flowModel' | 'flowProject'>> & {
    flowModel?: string | null
    flowProject?: string | null
    palette?: string | null
    stylePrompt?: string | null
    provider?: ProjectSettings['art']['provider'] | null
    pixelProvider?: ProjectSettings['art']['pixelProvider'] | null
    pixel?: ProjectSettings['art']['pixel'] | null
  }
  /** `null` clears an optional field (`provider`, `chip`). */
  music?: Partial<Omit<ProjectSettings['music'], 'provider' | 'chip'>> & { provider?: ProjectSettings['music']['provider'] | null; chip?: ProjectSettings['music']['chip'] | null }
  voice?: Partial<ProjectSettings['voice']>
  /** Sound effects and ambiences. `null` clears `sfxEngine`. */
  sound?: { ambienceEngine?: string; sfxEngine?: string | null }
}

/** The commands about VN projects (handled by `VnService`). */
export type VnCommand = Extract<
  Command,
  {
    type:
      | 'listSourceBooks'
      | 'previewImport'
      | 'importProject'
      | 'listProjects'
      | 'getProject'
      | 'updateProjectSettings'
      | 'deleteProject'
      | 'runPipeline'
      | 'addEdition'
      | 'getEdition'
      | 'updateEditionBeat'
      | 'getAlignReport'
      | 'listAssets'
      | 'regenerateAsset'
      | 'replaceAsset'
      | 'pickAssetVersion'
      | 'lockAsset'
      | 'unlockAsset'
      | 'buildGame'
      | 'lintGame'
      | 'runGame'
      | 'listThemes'
      | 'comfyStatus'
      | 'comfyFree'
      | 'listEngines'
      | 'listCustomWorkflows'
      | 'setVoiceRef'
      | 'generateVoice'
      | 'voiceStatus'
      | 'planVoices'
      | 'studiosStatus'
      | 'openInStudio'
      | 'setVoice'
      | 'previewVoice'
      | 'getRenpyConfig'
      | 'saveRenpyConfig'
      | 'stopPipeline'
      | 'suggestAssetPrompt'
      | 'updateSceneCues'
      | 'updateSceneStory'
  }
>

export type CommandType = Command['type']

/** Every command type, as an object so the compiler fails when a new command is not listed (main drops unlisted ones). */
const COMMAND_TYPE_SET: Record<CommandType, true> = {
  hire: true,
  fire: true,
  pause: true,
  resume: true,
  stop: true,
  pauseAll: true,
  resumeAll: true,
  stopNow: true,
  setModel: true,
  checkServers: true,
  listSourceBooks: true,
  previewImport: true,
  importProject: true,
  listProjects: true,
  getProject: true,
  updateProjectSettings: true,
  deleteProject: true,
  runPipeline: true,
  addEdition: true,
  getEdition: true,
  updateEditionBeat: true,
  getAlignReport: true,
  listAssets: true,
  regenerateAsset: true,
  replaceAsset: true,
  pickAssetVersion: true,
  lockAsset: true,
  unlockAsset: true,
  buildGame: true,
  lintGame: true,
  runGame: true,
  listThemes: true,
  comfyStatus: true,
  comfyFree: true,
  listEngines: true,
  listCustomWorkflows: true,
  setVoiceRef: true,
  generateVoice: true,
  voiceStatus: true,
  planVoices: true,
  studiosStatus: true,
  openInStudio: true,
  setVoice: true,
  previewVoice: true,
  getRenpyConfig: true,
  saveRenpyConfig: true,
  stopPipeline: true,
  suggestAssetPrompt: true,
  updateSceneCues: true,
  updateSceneStory: true,
  mcpStatus: true,
  saveMcpConfig: true,
  saveSettings: true,
  setSecret: true,
  detectModels: true,
  showModels: true,
  addModel: true,
  saveCustomProvider: true,
  removeCustomProvider: true,
  testCustomProvider: true,
  setProviderLimits: true,
  snapshot: true,
  ping: true
}

export const COMMAND_TYPES: readonly CommandType[] = Object.keys(COMMAND_TYPE_SET) as CommandType[]

export function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && (COMMAND_TYPES as readonly string[]).includes(type)
}

/** One end of a link: sends `Out` messages and receives `In` messages. */
export interface Transport<Out, In> {
  send(message: Out): void
  /** Returns an unsubscribe function. */
  onMessage(handler: (message: In) => void): () => void
  close(): void
}

/** The engine's end of the link. The UI's end is the mirror: Transport<Command, EngineEvent>. */
export type EngineTransport = Transport<EngineEvent, Command>

/** What the preload script exposes to the renderer as `window.vnstudio`. */
export interface VnStudioApi {
  on(handler: (event: EngineEvent) => void): () => void
  send(command: Command): void
}
