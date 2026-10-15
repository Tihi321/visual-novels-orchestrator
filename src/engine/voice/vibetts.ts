/**
 * A minimal MCP client (Streamable HTTP) for VibeTTS: `initialize`, then `tools/call`. The server answers with plain JSON; a
 * `text/event-stream` answer (SSE) is read too. No SDK: this is a few hundred bytes of JSON-RPC over `fetch`.
 */

export const NOT_RUNNING_HINT =
  'VibeTTS is not running or its MCP server is off — start it with `python -m vibetts --mcp-only` in C:\\projects\\Personal\\vibe-tts-flow or enable Settings > Agents (MCP)'

export class VibeTtsError extends Error {
  constructor(
    message: string,
    /** `unreachable`: nothing answers at the URL. `timeout`, `http`, `tool` (the tool said isError), `protocol`. */
    readonly kind: 'unreachable' | 'timeout' | 'http' | 'tool' | 'protocol' | 'aborted'
  ) {
    super(message)
    this.name = 'VibeTtsError'
  }
}

export interface VibeVoice {
  id: string
  label?: string
  engine?: string
  kind?: string
  description?: string
  lang?: string
}

export interface VibeVoiceList {
  voices: VibeVoice[]
  engine?: string
  default_voice?: string
  omnivoice_installed?: boolean
}

export interface BatchItem {
  text: string
  /** Absolute path ending in .wav or .mp3. */
  output: string
  voice?: string
  lang?: string
  speed?: number
}

export interface BatchRow {
  output: string
  duration_s: number
  ok: boolean
  error: string | null
}

export interface BatchResult {
  results: BatchRow[]
  ok_count?: number
  failed_count?: number
  total_duration_s?: number
}

export interface CreatedVoice {
  voice: string
  name: string
  description: string
  seed: number
  lang: string
}

export interface FileResult {
  path: string
  format?: string
  duration_seconds: number
  voice?: string
  lang?: string
}

/** What the voice jobs need from VibeTTS. Tests pass a fake. */
export interface VibeTtsClient {
  readonly url: string
  listVoices(signal?: AbortSignal): Promise<VibeVoiceList>
  createVoice(args: { name: string; description?: string; seed?: number; lang?: string; overwrite?: boolean }, signal?: AbortSignal): Promise<CreatedVoice>
  deleteVoice(name: string, signal?: AbortSignal): Promise<{ deleted: string }>
  synthesizeToFile(args: { text: string; output: string; voice?: string; lang?: string; speed?: number; overwrite?: boolean }, signal?: AbortSignal): Promise<FileResult>
  synthesizeBatch(items: BatchItem[], opts?: { overwrite?: boolean; signal?: AbortSignal }): Promise<BatchResult>
  /** Cancels a running export (best effort). */
  stop(cancelExport?: boolean): Promise<void>
}

export interface VibeTtsOptions {
  url?: string
  /** Timeout of the short calls (initialize, list_voices, delete_voice). */
  timeoutMs?: number
  /** Timeout of create_voice and synthesize_to_file (the model loads on the first call). */
  voiceTimeoutMs?: number
  /** Timeout of one synthesize_batch call. */
  batchTimeoutMs?: number
  fetchImpl?: typeof fetch
}

export const DEFAULT_VIBETTS_URL = 'http://127.0.0.1:7723/mcp'
const PROTOCOL_VERSION = '2025-06-18'

interface RpcMessage {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

/** The JSON-RPC message with this id from a response body: plain JSON, or SSE `data:` events. */
export function parseRpcBody(body: string, contentType: string, id: number): RpcMessage | null {
  const pick = (v: unknown): RpcMessage | null => {
    const list = Array.isArray(v) ? v : [v]
    for (const m of list) if (m && typeof m === 'object' && (m as RpcMessage).id === id) return m as RpcMessage
    return null
  }
  if (/text\/event-stream/i.test(contentType)) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data.trim()) continue
      try {
        const m = pick(JSON.parse(data))
        if (m) return m
      } catch {
        /* a comment or a partial event */
      }
    }
    return null
  }
  try {
    return pick(JSON.parse(body))
  } catch {
    return null
  }
}

function combine(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([t, signal]) : t
}

export function createVibeTtsClient(opts: VibeTtsOptions = {}): VibeTtsClient {
  const url = opts.url ?? DEFAULT_VIBETTS_URL
  const timeoutMs = opts.timeoutMs ?? 15_000
  const voiceTimeoutMs = opts.voiceTimeoutMs ?? 180_000
  const batchTimeoutMs = opts.batchTimeoutMs ?? 900_000
  const doFetch = opts.fetchImpl ?? fetch
  let nextId = 1
  let ready: Promise<void> | null = null
  let session: string | null = null
  let version = PROTOCOL_VERSION

  async function post(message: object, ms: number, signal: AbortSignal | undefined): Promise<{ status: number; text: string; type: string; headers: Headers }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    if (session) headers['Mcp-Session-Id'] = session
    if ('method' in message && (message as { method: string }).method !== 'initialize') headers['MCP-Protocol-Version'] = version
    try {
      const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(message), signal: combine(ms, signal) })
      return { status: res.status, text: await res.text(), type: res.headers.get('content-type') ?? '', headers: res.headers }
    } catch (e) {
      if (signal?.aborted) throw new VibeTtsError('stopped', 'aborted')
      const name = (e as Error).name
      if (name === 'TimeoutError' || name === 'AbortError') throw new VibeTtsError(`VibeTTS did not answer within ${Math.round(ms / 1000)} s`, 'timeout')
      throw new VibeTtsError(NOT_RUNNING_HINT, 'unreachable')
    }
  }

  async function rpc(method: string, params: object, ms: number, signal?: AbortSignal): Promise<unknown> {
    const id = nextId++
    const r = await post({ jsonrpc: '2.0', id, method, params }, ms, signal)
    if (r.status === 403) throw new VibeTtsError('VibeTTS refused the request (HTTP 403: Host or Origin not allowed)', 'http')
    if (r.status < 200 || r.status >= 300) throw new VibeTtsError(`VibeTTS answered HTTP ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}`, 'http')
    const msg = parseRpcBody(r.text, r.type, id)
    if (!msg) throw new VibeTtsError(`VibeTTS sent an answer that is not MCP: ${r.text.slice(0, 120)}`, 'protocol')
    if (msg.error) throw new VibeTtsError(`VibeTTS: ${msg.error.message}`, 'protocol')
    if (method === 'initialize') {
      const sid = r.headers.get('mcp-session-id')
      if (sid) session = sid
      const v = (msg.result as { protocolVersion?: string } | undefined)?.protocolVersion
      if (v) version = v
    }
    return msg.result
  }

  function init(signal?: AbortSignal): Promise<void> {
    ready ??= (async () => {
      await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'vn-studio', version: '1' } }, timeoutMs, signal)
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs, signal)
    })().catch((e) => {
      ready = null // try again next time (VibeTTS may have been started since)
      throw e
    })
    return ready
  }

  async function call<T>(name: string, args: object, ms: number, signal?: AbortSignal): Promise<T> {
    await init(signal)
    let result: { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] }
    try {
      result = (await rpc('tools/call', { name, arguments: args }, ms, signal)) as typeof result
    } catch (e) {
      if (e instanceof VibeTtsError && e.kind === 'unreachable') ready = null
      throw e
    }
    const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
    if (result.isError) throw new VibeTtsError(text || `${name} failed`, 'tool')
    if (result.structuredContent !== undefined) return result.structuredContent as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new VibeTtsError(`${name}: unexpected answer: ${text.slice(0, 120)}`, 'protocol')
    }
  }

  return {
    url,
    listVoices: (signal) => call<VibeVoiceList>('list_voices', {}, timeoutMs, signal),
    createVoice: (args, signal) => call<CreatedVoice>('create_voice', args, voiceTimeoutMs, signal),
    deleteVoice: (name, signal) => call<{ deleted: string }>('delete_voice', { name }, timeoutMs, signal),
    synthesizeToFile: (args, signal) => call<FileResult>('synthesize_to_file', args, voiceTimeoutMs, signal),
    synthesizeBatch: (items, o = {}) => call<BatchResult>('synthesize_batch', { items, overwrite: o.overwrite ?? false }, batchTimeoutMs, o.signal),
    stop: async (cancelExport = true) => {
      try {
        await call('stop', { cancel_export: cancelExport }, timeoutMs)
      } catch {
        /* best effort */
      }
    }
  }
}
