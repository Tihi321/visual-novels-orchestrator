import { createStore } from 'zustand/vanilla'
import { applySettingsPatch } from '../lib/settings'
import { initialVn, reduceVn, type VnData } from './vn'
import type { ProjectSettingsPatch } from '../../shared/protocol'
import type { AgentProblem, AgentState, AgentSummary, CatalogModel, EngineEvent, ModelSummary, ProviderSummary, ServerStatus, SettingsSummary } from '../../shared/protocol'

export type Page = 'library' | 'book' | 'models' | 'agents' | 'comfy' | 'settings'

export const PAGES: { id: Page; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'book', label: 'Book' },
  { id: 'models', label: 'Models' },
  { id: 'agents', label: 'Agents' },
  { id: 'comfy', label: 'Generators' },
  { id: 'settings', label: 'Settings' }
]

export interface AgentView {
  id: string
  name: string
  role: string
  /** The agent's own override (`provider/model`), or null. */
  override: string | null
  /** The model it calls now or will call next. */
  model: string | null
  state: AgentState
  paused: boolean
  task?: string
  book?: string
  jobId?: string
  problem?: AgentProblem
}

export interface VnState extends VnData {
  connected: boolean
  dataDir: string
  paused: boolean
  warnings: string[]
  agents: Record<string, AgentView>
  agentOrder: string[]
  spend: { today: number; month: number; dailyCap: number; monthlyCap: number }
  /** Every model the engine knows, from the snapshot. The pickers offer the `shown` ones. */
  models: ModelSummary[]
  providers: ProviderSummary[]
  /** What each provider listed on the Models page (`detectModels`), or why it couldn't. `loading` until it answers. */
  catalogs: Record<string, { models: CatalogModel[]; error?: string; at?: string; loading?: boolean }>
  roleDefaults: Record<string, string>
  /** The local model servers (Strata, LM Studio): running or not. */
  servers: ServerStatus[]
  settings: SettingsSummary | null
  secretsSet: string[]
  page: Page
}

export interface VnActions {
  applyEvents(events: EngineEvent[]): void
  setPage(page: Page): void
  /** The Models page asked a provider for its models: show it as loading until `models.catalog` comes. */
  markCatalogLoading(provider: string): void
  /** Opens the Book page on a project. */
  openProject(slug: string): void
  /** Shows a settings change at once, before the engine confirms it. */
  patchSettingsLocal(slug: string, patch: ProjectSettingsPatch): void
  /** Closes the import dialog's preview and the last-imported marker. */
  clearImport(): void
}

export type VnStore = VnState & VnActions

function initial(): VnState {
  return {
    connected: false,
    dataDir: '',
    paused: false,
    warnings: [],
    agents: {},
    agentOrder: [],
    spend: { today: 0, month: 0, dailyCap: 0, monthlyCap: 0 },
    models: [],
    providers: [],
    catalogs: {},
    roleDefaults: {},
    servers: [],
    settings: null,
    secretsSet: [],
    page: 'library',
    ...initialVn()
  }
}

function agentFromSummary(a: AgentSummary): AgentView {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    override: a.model,
    model: a.resolvedModel ?? a.model,
    state: a.paused ? 'paused' : a.state,
    paused: a.paused,
    task: a.task,
    book: a.book,
    jobId: a.jobId,
    problem: a.problem
  }
}

export function reduceEvent(s: VnState, e: EngineEvent): Partial<VnState> {
  switch (e.type) {
    case 'engine.ready':
      return { connected: true, dataDir: e.dataDir }
    case 'engine.heartbeat':
      return { connected: true }
    case 'engine.warning':
      return { warnings: [...s.warnings.slice(-19), e.message] }
    case 'snapshot': {
      const agents: Record<string, AgentView> = {}
      for (const a of e.agents) agents[a.id] = agentFromSummary(a)
      return {
        connected: true,
        dataDir: e.dataDir,
        paused: e.paused,
        agents,
        agentOrder: e.agents.map((a) => a.id),
        spend: e.spend,
        models: e.models,
        providers: e.providers ?? [],
        roleDefaults: e.roleDefaults,
        servers: e.servers ?? [],
        settings: e.settings,
        secretsSet: e.secretsSet
      }
    }
    case 'agent.hired':
    case 'agent.updated': {
      const had = !!s.agents[e.agent.id]
      return { agents: { ...s.agents, [e.agent.id]: agentFromSummary(e.agent) }, agentOrder: had ? s.agentOrder : [...s.agentOrder, e.agent.id] }
    }
    case 'agent.removed': {
      const { [e.agent]: _gone, ...rest } = s.agents
      return { agents: rest, agentOrder: s.agentOrder.filter((id) => id !== e.agent) }
    }
    case 'agent.state': {
      const prev = s.agents[e.agent]
      if (!prev) return {}
      return { agents: { ...s.agents, [e.agent]: { ...prev, state: e.state, task: e.task, book: e.book, jobId: e.jobId } } }
    }
    case 'agent.problem': {
      const prev = s.agents[e.agent]
      return prev ? { agents: { ...s.agents, [e.agent]: { ...prev, problem: e.problem ?? undefined } } } : {}
    }
    case 'factory.paused':
      return { paused: e.paused }
    case 'servers':
      return { servers: e.servers }
    case 'secrets.updated':
      return { secretsSet: e.secretsSet }
    case 'models.catalog':
      return { catalogs: { ...s.catalogs, [e.provider]: { models: e.models, error: e.error, at: e.at } } }
    default:
      return reduceVn(s, e)
  }
}

const ACTION_KEYS = ['applyEvents', 'setPage', 'markCatalogLoading', 'openProject', 'clearImport', 'patchSettingsLocal'] as const

export const vnStore = createStore<VnStore>()((set, get) => ({
  ...initial(),
  applyEvents(events) {
    if (!events.length) return
    let next: VnState = get()
    for (const e of events) next = { ...next, ...reduceEvent(next, e) }
    const state: Record<string, unknown> = { ...next }
    for (const k of ACTION_KEYS) delete state[k]
    set(state as unknown as VnState)
  },
  setPage(page) {
    set({ page })
  },
  openProject(slug) {
    set({ currentSlug: slug, page: 'book' })
  },
  patchSettingsLocal(slug, patch) {
    const d = get().details[slug]
    if (d) set({ details: { ...get().details, [slug]: { ...d, settings: applySettingsPatch(d.settings, patch) } } })
  },
  clearImport() {
    set({ importPreview: null, lastImported: null })
  },
  markCatalogLoading(provider) {
    const cur = get().catalogs[provider] ?? { models: [] }
    set({ catalogs: { ...get().catalogs, [provider]: { ...cur, loading: true, error: undefined } } })
  }
}))
