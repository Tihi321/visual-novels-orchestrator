import { useEffect, useMemo, useState } from 'react'
import { sendCommand } from '../api'
import { useVn } from '../store/hooks'
import { vnStore } from '../store/store'
import type { ModelGroup, ProviderSummary, SettingsSummary } from '../../shared/protocol'

interface Row {
  ref: string
  id: string
  context?: number
  priceIn?: number
  priceOut?: number
  /** In the pickers now. */
  shown: boolean
  source?: 'config' | 'discovered' | 'picked'
  /** It can be ticked: known, local, or listed with a price. */
  pickable: boolean
  vision?: boolean
}

const SOURCE_LABEL = { config: 'providers.md', discovered: 'found', picked: 'added' } as const

type LoadKey = 'lmstudioParallel' | 'lmstudioContext' | 'lmstudioTtlMinutes'
type LimitKey = 'concurrency' | 'rpm' | 'rpd'
/** A provider's limits as typed: empty per minute or per day means no limit. */
type Limits = Record<LimitKey, string>

function limitsOf(p: ProviderSummary): Limits {
  return { concurrency: String(p.concurrency), rpm: p.rpm ? String(p.rpm) : '', rpd: p.rpd ? String(p.rpd) : '' }
}

/** Today's requests against the daily limit, and when it starts again (midnight UTC, in local time). */
function todayText(p: ProviderSummary): string {
  const at = new Date(p.dayResetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (p.dayFull) return `Used up today (${p.requestsToday}${p.rpd ? ` of ${p.rpd}` : ''} requests): jobs use their next model until ${at}`
  return `Today: ${p.requestsToday}${p.rpd ? ` of ${p.rpd}` : ''} requests. The day starts again at ${at} (midnight UTC).`
}

/** The groups that always have a row: API (every non-local built-in provider), Strata and LM Studio. Every other provider is its own group once it has a ticked model. */
const BASE_GROUPS: ModelGroup[] = ['paid', 'strata', 'lmstudio']
const BASE_LABELS: Record<string, string> = { paid: 'API', strata: 'Strata', lmstudio: 'LM Studio' }

/** The Add provider form as typed. `id` is set when editing a custom provider. */
interface ProviderForm {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  free: boolean
  jsonSchema: boolean
  /** A number, or `auto`. */
  concurrency: string
  enabled: boolean
  saving?: boolean
  error?: string
}

const emptyForm = (): ProviderForm => ({ name: '', baseUrl: 'http://127.0.0.1:7461/v1', apiKey: '', free: true, jsonSchema: false, concurrency: '2', enabled: true })

function formOf(p: ProviderSummary): ProviderForm {
  return { id: p.id, name: p.name, baseUrl: p.baseUrl ?? '', apiKey: '', free: p.local, jsonSchema: p.jsonSchema, concurrency: p.concurrencyAuto ? 'auto' : String(p.concurrency), enabled: p.enabled }
}

/** A short word for why a provider can't be used: its key is missing, or it is switched off. */
function shortReason(reason?: string): string {
  if (reason?.startsWith('no key')) return 'no key'
  if (reason?.startsWith('disabled')) return 'off'
  return 'not available'
}

function formatContext(n?: number): string {
  if (!n) return ''
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

function formatPrice(r: Row, local: boolean, kind?: string): string {
  if (kind === 'client') return 'local, free (answered over MCP)'
  if (local) return 'local'
  if (r.priceIn === undefined || r.priceOut === undefined) return 'no price'
  if (r.priceIn === 0 && r.priceOut === 0) return 'free'
  const f = (x: number) => `$${+x.toPrecision(3)}`
  return `${f(r.priceIn)} / ${f(r.priceOut)}`
}

/** Saves one or more of the model settings, keeping the rest as they are. */
function saveModelSettings(settings: SettingsSummary, change: Partial<SettingsSummary>) {
  sendCommand({ type: 'saveSettings', ...settings, ...change })
}

/**
 * The Models page: the default models behind the aliases, every model a provider has, which ones the model
 * pickers offer (config/models.md), adding a model by its id, and how LM Studio loads its models.
 */
export function ModelsPage() {
  const providers = useVn((s) => s.providers)
  const models = useVn((s) => s.models)
  const catalogs = useVn((s) => s.catalogs)
  const settings = useVn((s) => s.settings)
  const providerTest = useVn((s) => s.providerTest)
  const providerSaved = useVn((s) => s.providerSaved)
  const [form, setForm] = useState<ProviderForm | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)
  const [shownOnly, setShownOnly] = useState(false)
  const [add, setAdd] = useState({ id: '', priceIn: '', priceOut: '', context: '', vision: false })
  const [load, setLoad] = useState<Pick<SettingsSummary, LoadKey> | null>(null)
  const [limits, setLimits] = useState<{ provider: string; values: Limits } | null>(null)

  // the LM Studio fields are filled once, so a snapshot that arrives while you type doesn't undo it
  useEffect(() => {
    if (settings && !load) setLoad({ lmstudioParallel: settings.lmstudioParallel, lmstudioContext: settings.lmstudioContext, lmstudioTtlMinutes: settings.lmstudioTtlMinutes })
  }, [settings, load])

  // the answer to Save: close the form and open the provider, or show why it was refused
  useEffect(() => {
    if (!providerSaved) return
    setForm((f) => {
      if (!f?.saving) return f
      return providerSaved.ok ? null : { ...f, saving: false, error: providerSaved.error ?? 'could not save' }
    })
    if (providerSaved.ok && providerSaved.id && !providerSaved.removed) setProvider(providerSaved.id)
  }, [providerSaved])

  const current = providers.find((p) => p.id === provider) ?? providers.find((p) => p.available) ?? providers[0]
  const catalog = current ? catalogs[current.id] : undefined
  const local = !!current?.local

  // today's request counts are fresh when the page opens
  useEffect(() => {
    sendCommand({ type: 'snapshot' })
  }, [])
  // a provider's limit fields are filled when it is opened, so a snapshot that arrives while you type doesn't undo it
  useEffect(() => {
    if (!current) setLimits(null)
    else if (limits?.provider !== current.id) setLimits({ provider: current.id, values: limitsOf(current) })
  }, [current, limits])

  const rows = useMemo<Row[]>(() => {
    if (!current) return []
    const out = new Map<string, Row>()
    for (const m of models) {
      if (m.provider !== current.id) continue
      out.set(m.ref, { ref: m.ref, id: m.model, context: m.context, priceIn: m.priceIn, priceOut: m.priceOut, shown: m.shown !== false, source: m.source, pickable: true, vision: m.vision })
    }
    for (const c of catalog?.models ?? []) {
      const known = out.get(c.ref)
      if (known) out.set(c.ref, { ...known, context: known.context ?? c.context })
      else out.set(c.ref, { ref: c.ref, id: c.id, context: c.context, priceIn: c.priceIn, priceOut: c.priceOut, shown: false, pickable: c.pickable })
    }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
  }, [current, models, catalog])

  const saveLoad = () => {
    if (!settings || !load) return
    const changed = (Object.keys(load) as LoadKey[]).some((k) => load[k] !== settings[k])
    if (changed) saveModelSettings(settings, load)
  }
  const detect = (id: string) => {
    vnStore.getState().markCatalogLoading(id)
    sendCommand({ type: 'detectModels', provider: id })
  }
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const visible = rows.filter(
    (r) => words.every((w) => r.id.toLowerCase().includes(w)) && (!freeOnly || local || (r.priceIn === 0 && r.priceOut === 0)) && (!shownOnly || r.shown)
  )
  const toShow = visible.filter((r) => !r.shown && r.pickable).map((r) => r.ref)
  const toHide = visible.filter((r) => r.shown).map((r) => r.ref)

  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const addPriceOk = local || (num(add.priceIn) !== undefined && num(add.priceIn)! >= 0 && num(add.priceOut) !== undefined && num(add.priceOut)! >= 0)
  const canAdd = !!current && add.id.trim() !== '' && addPriceOk
  const addModel = () => {
    if (!current || !canAdd) return
    sendCommand({ type: 'addModel', provider: current.id, id: add.id.trim(), priceIn: num(add.priceIn), priceOut: num(add.priceOut), context: num(add.context), ...(add.vision ? { vision: true } : {}) })
    setAdd({ id: '', priceIn: '', priceOut: '', context: '', vision: false })
  }

  // the order every role tries the groups in; empty means each role keeps the order of its own list
  const shared = (settings?.modelOrder.length ?? 0) > 0
  // the groups with a row: API, Strata and LM Studio, and every other group that has a ticked model (a custom provider, acp)
  const groups: ModelGroup[] = [...BASE_GROUPS]
  for (const m of models) if (m.shown !== false && m.group && !groups.includes(m.group)) groups.push(m.group)
  for (const g of settings?.modelOrder ?? []) if (!groups.includes(g) && providers.some((p) => p.id === g)) groups.push(g)
  const groupLabel = (g: ModelGroup) => BASE_LABELS[g] ?? providers.find((p) => p.id === g)?.name ?? g
  const order: ModelGroup[] = shared ? [...settings!.modelOrder.filter((g) => groups.includes(g)), ...groups.filter((g) => !settings!.modelOrder.includes(g))] : groups
  const move = (i: number, by: number) => {
    if (!settings) return
    const next = [...order]
    ;[next[i], next[i + by]] = [next[i + by]!, next[i]!]
    saveModelSettings(settings, { modelOrder: next })
  }

  /** One group's row: its place in the order, the default model behind its alias (the ticked models it may point at), and moving it. */
  const groupRow = (g: ModelGroup, i: number) => {
    if (!settings) return null
    const refs = models.filter((m) => m.shown !== false && m.group === g).map((m) => m.ref)
    const chosen = settings.groupDefaults[g] ?? ''
    if (chosen && !refs.includes(chosen)) refs.unshift(chosen)
    return (
      <div key={g} className="row" style={{ gap: 6 }} data-testid={`order-${g}`}>
        <span className="dim" style={{ width: 16 }}>{shared ? `${i + 1}.` : ''}</span>
        <span style={{ width: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={groupLabel(g)}>
          {groupLabel(g)}
        </span>
        <select
          value={chosen || refs[0] || ''}
          onChange={(e) => saveModelSettings(settings, { groupDefaults: { ...settings.groupDefaults, [g]: e.target.value } })}
          style={{ flex: 1, minWidth: 0 }}
          data-testid={`set-default-${g}`}
        >
          {refs.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button disabled={i === 0} onClick={() => move(i, -1)} title="Try this group earlier" data-testid={`order-up-${g}`}>
          ↑
        </button>
        <button disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Try this group later" data-testid={`order-down-${g}`}>
          ↓
        </button>
      </div>
    )
  }
  const formUrlOk = !!form && /^https?:\/\/\S+$/i.test(form.baseUrl.trim())
  const formConcurrencyOk = !!form && (form.concurrency.trim() === 'auto' || (Number.isInteger(Number(form.concurrency)) && Number(form.concurrency) >= 1))
  const saveForm = () => {
    if (!form || !form.name.trim() || !formUrlOk || !formConcurrencyOk || form.saving) return
    setForm({ ...form, saving: true, error: undefined })
    sendCommand({
      type: 'saveCustomProvider',
      id: form.id,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      free: form.free,
      jsonSchema: form.jsonSchema,
      concurrency: form.concurrency.trim() === 'auto' ? 'auto' : Number(form.concurrency),
      enabled: form.enabled
    })
  }
  const testForm = () => {
    if (!form || !formUrlOk) return
    vnStore.getState().markProviderTesting(true)
    sendCommand({ type: 'testCustomProvider', baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() || undefined, id: form.id })
  }
  /** The Add provider / Edit form. */
  const providerForm = () => {
    if (!form) return null
    const set = (change: Partial<ProviderForm>) => setForm({ ...form, ...change })
    return (
      <div className="stack panel" style={{ gap: 6 }} data-testid="provider-form">
        <div className="panel-title">{form.id ? `Edit ${form.id}` : 'Add provider'}</div>
        <div className="dim">Any OpenAI-compatible server. Saved in config/providers.md; the key goes to the Windows credential store.</div>
        <label>Name</label>
        <input value={form.name} placeholder="ACP proxy (home)" onChange={(e) => set({ name: e.target.value })} data-testid="pf-name" />
        <label>Base URL</label>
        <input value={form.baseUrl} placeholder="http://127.0.0.1:7461/v1" onChange={(e) => set({ baseUrl: e.target.value })} data-testid="pf-url" />
        <label>API key (optional)</label>
        <input
          type="password"
          autoComplete="off"
          value={form.apiKey}
          placeholder={form.id && providers.find((p) => p.id === form.id)?.keySet ? 'Key is set. Type to replace' : 'Paste the key'}
          onChange={(e) => set({ apiKey: e.target.value })}
          data-testid="pf-key"
        />
        <div className="row" style={{ gap: 12 }}>
          <label className="inline" title="A local or free server: no key needed, no budget, never paid. Off: its models need a price">
            <input type="checkbox" checked={form.free} onChange={(e) => set({ free: e.target.checked })} data-testid="pf-free" />
            Free (local)
          </label>
          <label className="inline" title="Send the JSON schema as response_format. Leave off for servers that reject a bad JSON answer">
            <input type="checkbox" checked={form.jsonSchema} onChange={(e) => set({ jsonSchema: e.target.checked })} data-testid="pf-schema" />
            Send JSON schema
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="pf-enabled" />
            Enabled
          </label>
        </div>
        <label>Parallel (a number, or auto)</label>
        <input value={form.concurrency} onChange={(e) => set({ concurrency: e.target.value })} data-testid="pf-concurrency" />
        {form.error && (
          <div className="warn" data-testid="pf-error">
            {form.error}
          </div>
        )}
        {providerTest && (
          <div className={providerTest.ok === false ? 'warn' : 'dim'} data-testid="pf-test-result">
            {providerTest.pending ? 'Testing...' : providerTest.ok ? `Reachable, ${providerTest.count} model${providerTest.count === 1 ? '' : 's'}` : `Could not reach it: ${providerTest.error}`}
          </div>
        )}
        <div className="row" style={{ gap: 6 }}>
          <button disabled={!formUrlOk || providerTest?.pending} onClick={testForm} data-testid="pf-test">
            Test
          </button>
          <button className="primary" disabled={!form.name.trim() || !formUrlOk || !formConcurrencyOk || form.saving} onClick={saveForm} data-testid="pf-save">
            {form.id ? 'Save' : 'Add'}
          </button>
          <button
            onClick={() => {
              setForm(null)
              vnStore.getState().markProviderTesting(false)
            }}
            data-testid="pf-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }
  /** Sends the limits that changed: an empty per minute or per day field means no limit (0). */
  const saveLimits = () => {
    if (!current || !limits || limits.provider !== current.id) return
    const was = limitsOf(current)
    const change: { concurrency?: number; rpm?: number; rpd?: number } = {}
    const n = (v: string) => (v.trim() === '' ? 0 : Math.max(0, Math.round(Number(v))))
    if (limits.values.concurrency !== was.concurrency && n(limits.values.concurrency) >= 1) change.concurrency = n(limits.values.concurrency)
    if (limits.values.rpm !== was.rpm && Number.isFinite(n(limits.values.rpm))) change.rpm = n(limits.values.rpm)
    if (limits.values.rpd !== was.rpd && Number.isFinite(n(limits.values.rpd))) change.rpd = n(limits.values.rpd)
    if (Object.keys(change).length) sendCommand({ type: 'setProviderLimits', provider: current.id, ...change })
  }
  const limitField = (label: string, key: LimitKey, title: string) => (
    <div style={{ flex: 1 }} title={title}>
      <label>{label}</label>
      <input
        type="number"
        min={key === 'concurrency' ? 1 : 0}
        value={limits?.values[key] ?? ''}
        placeholder="no limit"
        disabled={key === 'concurrency' && current?.concurrencyAuto}
        onChange={(e) => limits && setLimits({ ...limits, values: { ...limits.values, [key]: e.target.value } })}
        onBlur={saveLimits}
        onKeyDown={(e) => e.key === 'Enter' && saveLimits()}
        data-testid={`limit-${key}`}
      />
    </div>
  )
  const loadField = (label: string, key: LoadKey) => (
    <div style={{ flex: 1 }}>
      <label>{label}</label>
      <input
        type="number"
        value={load?.[key] ?? ''}
        onChange={(e) => load && setLoad({ ...load, [key]: Number(e.target.value) })}
        onBlur={saveLoad}
        data-testid={`set-${key}`}
      />
    </div>
  )

  return (
    <div className="stack models-page" data-testid="models-page">
      <div className="models" style={{ display: 'contents' }}>
        <div className="panel-title">Models</div>
        <div className="dim">Default models: the aliases paid (API, free or paid), strata, lmstudio and the id of any provider you added, in roles.md. Every role that names one follows it.</div>
        <label className="inline">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => settings && saveModelSettings(settings, { modelOrder: e.target.checked ? order : [] })}
            data-testid="order-shared"
          />
          One fallback order for every role
        </label>
        <div className="stack" style={{ gap: 4 }}>
          {order.map(groupRow)}
        </div>
        <div className="dim">
          {shared
            ? "Every role tries the groups top to bottom: the first is the primary, the rest are fallbacks. An agent's own model still goes first. Running jobs switch at once."
            : 'Each role keeps the order of its list in roles.md. Move a group up or down to use one order for every role.'}
        </div>
        <hr />
        <div className="dim">Tick the models the pickers offer. Saved in config/models.md.</div>
        <div className="models-body">
          <div className="models-providers">
            {providers.map((p) => (
              <button
                key={p.id}
                className={p.id === current?.id ? 'primary' : ''}
                onClick={() => setProvider(p.id)}
                data-testid={`models-provider-${p.id}`}
                title={p.available ? (p.keyFrom ? `key from ${p.keyFrom}` : undefined) : p.reason}
              >
                <span>{p.name}</span>
                <span className="dim">{p.available ? `${models.filter((m) => m.provider === p.id && m.shown !== false).length} ticked` : shortReason(p.reason)}</span>
              </button>
            ))}
            <button onClick={() => setForm(emptyForm())} data-testid="models-add-provider" title="Add any OpenAI-compatible server (config/providers.md)">
              Add provider
            </button>
          </div>
          {current ? (
            <div className="models-pane">
              {form && providerForm()}
              {current.custom && !form && (
                <div className="row" style={{ gap: 6 }} data-testid="custom-provider-actions">
                  <span className="dim">
                    {current.name} was added here ({current.baseUrl})
                  </span>
                  <button style={{ marginLeft: 'auto' }} onClick={() => setForm(formOf(current))} data-testid="provider-edit">
                    Edit
                  </button>
                  <button
                    onClick={() => window.confirm(`Remove ${current.name}? Its key is deleted and its models leave the pickers.`) && sendCommand({ type: 'removeCustomProvider', id: current.id })}
                    data-testid="provider-remove"
                  >
                    Remove
                  </button>
                </div>
              )}
              {current.kind === 'client' && (
                <div className="dim" data-testid="client-note">
                  Local and free. These models do nothing by themselves: a job on one waits until the MCP client it names (client/claude-code: Claude Code; client/antigravity: Antigravity CLI, which passes client: "antigravity") takes it with vno_get_task and answers with vno_submit_task. Do not leave a role on it when no client is working.
                </div>
              )}
              {!local && (
                <>
                  <div className="row" style={{ gap: 8 }} data-testid="provider-limits">
                    {limitField('Requests at once', 'concurrency', 'How many requests to this provider run at the same time, across every agent')}
                    {limitField('Per minute', 'rpm', 'Requests per minute: more wait for the next minute. Empty: no limit')}
                    {limitField('Per day', 'rpd', "Requests per day, from midnight UTC: after that, jobs use their next model. OpenRouter's free models: 50, or 1000 after buying 10 credits. Empty: no limit")}
                  </div>
                  <div className={current.dayFull ? 'warn' : 'dim'} data-testid="provider-today">
                    {todayText(current)}
                  </div>
                </>
              )}
              <div className="row">
                <input value={filter} placeholder="Filter, e.g. qwen" onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} data-testid="models-filter" />
                <button
                  disabled={!current.available || !current.canList || catalog?.loading}
                  onClick={() => detect(current.id)}
                  title={current.canList ? `Ask ${current.id} for every model it has` : `${current.id} can't list its models: add them by id below`}
                  data-testid="models-detect"
                >
                  {catalog?.loading ? 'Detecting...' : 'Detect models'}
                </button>
              </div>
              <div className="row" style={{ gap: 12 }}>
                {!local && (
                  <label className="inline">
                    <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} data-testid="models-free" />
                    free only
                  </label>
                )}
                <label className="inline">
                  <input type="checkbox" checked={shownOnly} onChange={(e) => setShownOnly(e.target.checked)} />
                  ticked only
                </label>
                <span className="dim" style={{ marginLeft: 'auto' }} data-testid="models-status">
                  {!current.available
                    ? current.reason?.startsWith('no key')
                      ? 'No key: store it on the Settings page, under Provider API key'
                      : (current.reason ?? 'not available')
                    : !current.canList
                      ? "Can't list its models: add them by id below"
                      : catalog?.error
                        ? `Could not list: ${catalog.error}`
                        : catalog?.at
                          ? `${catalog.models.length} listed, ${rows.filter((r) => r.shown).length} ticked`
                          : 'Detect models lists everything it has'}
                </span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button disabled={!toShow.length} onClick={() => sendCommand({ type: 'showModels', refs: toShow, shown: true })} data-testid="models-tick-all">
                  Tick all {toShow.length || ''}
                </button>
                <button disabled={!toHide.length} onClick={() => sendCommand({ type: 'showModels', refs: toHide, shown: false })} data-testid="models-untick-all">
                  Untick all {toHide.length || ''}
                </button>
                <span className="dim">of the ones listed below</span>
              </div>
              <div className="models-list" data-testid="models-list">
                {visible.map((r) => (
                  <label
                    key={r.ref}
                    className={`model-row${r.pickable ? '' : ' disabled'}`}
                    title={r.pickable ? r.ref : 'No listed price, so the budget could not count it: add it by id below with its price'}
                    data-testid={`model-row-${r.ref}`}
                  >
                    <input type="checkbox" checked={r.shown} disabled={!r.pickable} onChange={(e) => sendCommand({ type: 'showModels', refs: [r.ref], shown: e.target.checked })} />
                    <span className="model-id">{r.id}</span>
                    <span className="dim">{formatContext(r.context)}</span>
                    <span className={r.vision ? 'free' : 'dim'} title="Accepts images (vision: true in providers.md or models.md)">{r.vision ? 'vision' : ''}</span>
                    <span className={r.priceIn === 0 && r.priceOut === 0 && !local ? 'free' : 'dim'}>{formatPrice(r, local, current?.kind)}</span>
                    <span className="dim">{r.source ? SOURCE_LABEL[r.source] : ''}</span>
                  </label>
                ))}
                {!visible.length && <div className="dim">{catalog?.loading ? 'Asking the provider...' : 'No models here.'}</div>}
              </div>
              <div className="dim">Add a model by its id{local ? '' : ', with its price in USD per 1M tokens (0 and 0 for a free one)'}:</div>
              <div className="row" style={{ gap: 6 }}>
                <input
                  value={add.id}
                  placeholder={current.id === 'openrouter' ? 'e.g. qwen/qwen3-235b-a22b:free' : 'model id'}
                  onChange={(e) => setAdd({ ...add, id: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addModel()}
                  style={{ flex: 3 }}
                  data-testid="models-add-id"
                />
                {!local && (
                  <>
                    <input type="number" min={0} step="any" value={add.priceIn} placeholder="$ in" onChange={(e) => setAdd({ ...add, priceIn: e.target.value })} style={{ flex: 1 }} data-testid="models-add-in" />
                    <input type="number" min={0} step="any" value={add.priceOut} placeholder="$ out" onChange={(e) => setAdd({ ...add, priceOut: e.target.value })} style={{ flex: 1 }} data-testid="models-add-out" />
                  </>
                )}
                <input type="number" min={0} value={add.context} placeholder="context" onChange={(e) => setAdd({ ...add, context: e.target.value })} style={{ flex: 1 }} data-testid="models-add-context" />
                <label className="inline" title="The model accepts images: the art-critic is offered it">
                  <input type="checkbox" checked={add.vision} onChange={(e) => setAdd({ ...add, vision: e.target.checked })} data-testid="models-add-vision" />
                  vision
                </label>
                <button disabled={!canAdd} onClick={addModel} data-testid="models-add">
                  Add
                </button>
              </div>
              {current.id === 'lmstudio' && (
                <>
                  <div className="dim" style={{ marginTop: 4 }}>Loading LM Studio models (a model LM Studio has loaded already keeps its own settings)</div>
                  <div className="row" style={{ gap: 8 }}>
                    {loadField('Requests at once', 'lmstudioParallel')}
                    {loadField('Context window', 'lmstudioContext')}
                    {loadField('Unload after idle min', 'lmstudioTtlMinutes')}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="dim">No model providers in providers.md.</div>
          )}
        </div>
        <div className="row spread" style={{ marginTop: 10 }}>
          <span className="dim">Prices are USD per 1M tokens in / out. A model added here is saved with its price, and the budget counts it.</span>
          <button onClick={() => { saveLoad(); saveLimits() }} data-testid="models-save">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
