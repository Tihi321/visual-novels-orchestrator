import { McpHttpError, createMcpClient } from '../studios/mcp-http'

/**
 * The MCP client of VibeTTS: the generic Streamable HTTP client (`studios/mcp-http.ts`) with VibeTTS's timeouts and error type.
 */

export { parseRpcBody } from '../studios/mcp-http'

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

/** A fixed VibeTTS voice: a Kokoro voice (`af_heart`, English only) or a Supertonic one (`supertonic:F1` .. `M5`, 31 languages). */
export interface VibeVoice {
  id: string
  label: string
  /** `kokoro` or `supertonic`. */
  engine: string
  /** The language codes it reads. */
  languages: string[]
}

/** `list_voices`. Supertonic voices are only listed once it is downloaded (`supertonic_installed`). */
export interface VibeVoiceList {
  voices: VibeVoice[]
  languages?: { code: string; name: string }[]
  /** The user's own default voices in VibeTTS. */
  english?: { engine?: string; voice?: string }
  other?: { language?: string; voice?: string }
  language_mode?: string
  supertonic_installed?: boolean
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
  synthesizeToFile(args: { text: string; output: string; voice?: string; lang?: string; speed?: number; overwrite?: boolean }, signal?: AbortSignal): Promise<FileResult>
  synthesizeBatch(items: BatchItem[], opts?: { overwrite?: boolean; signal?: AbortSignal }): Promise<BatchResult>
  /** Cancels a running export (best effort). */
  stop(cancelExport?: boolean): Promise<void>
}

export interface VibeTtsOptions {
  url?: string
  /** Timeout of the short calls (initialize, list_voices). */
  timeoutMs?: number
  /** Timeout of synthesize_to_file, the voice preview (the model loads on the first call). */
  voiceTimeoutMs?: number
  /** Timeout of one synthesize_batch call. */
  batchTimeoutMs?: number
  fetchImpl?: typeof fetch
}

export const DEFAULT_VIBETTS_URL = 'http://127.0.0.1:7723/mcp'

export function createVibeTtsClient(opts: VibeTtsOptions = {}): VibeTtsClient {
  const url = opts.url ?? DEFAULT_VIBETTS_URL
  const timeoutMs = opts.timeoutMs ?? 15_000
  const voiceTimeoutMs = opts.voiceTimeoutMs ?? 180_000
  const batchTimeoutMs = opts.batchTimeoutMs ?? 900_000
  const mcp = createMcpClient({ url, label: 'VibeTTS', notRunningHint: NOT_RUNNING_HINT, timeoutMs, fetchImpl: opts.fetchImpl })

  async function call<T>(name: string, args: object, ms: number, signal?: AbortSignal): Promise<T> {
    try {
      const r = await mcp.callTool(name, args, { timeoutMs: ms, signal })
      if (r.json === null) throw new VibeTtsError(`${name}: unexpected answer: ${r.text.slice(0, 120)}`, 'protocol')
      return r.json as T
    } catch (e) {
      if (e instanceof McpHttpError) throw new VibeTtsError(e.message, e.kind)
      throw e
    }
  }

  return {
    url,
    listVoices: (signal) => call<VibeVoiceList>('list_voices', {}, timeoutMs, signal),
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
