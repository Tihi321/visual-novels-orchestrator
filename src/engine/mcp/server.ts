import { z } from 'zod'
import type { Readable, Writable } from 'node:stream'
import type { PipelineStep } from '../../shared/protocol'
import { jsonSchemaOf } from '../pipeline/llm'
import { isStep, STEPS } from '../vn/pipeline'
import type { VnService } from '../vn/service'

/**
 * A minimal MCP server over stdio (newline-delimited JSON-RPC 2.0): `initialize`, `tools/list` and `tools/call`, written by hand
 * so the app needs no extra dependency. The tools drive the same service as the app and the CLI, so Claude Code (or any agent)
 * can list books, import them, run the pipeline, replace assets and build the game.
 *
 *   claude mcp add vn-studio -- yarn --cwd <repo> engine -- mcp
 */

export const SERVER_INFO = { name: 'vn-studio', version: '0.0.1' }
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

type Json = Record<string, unknown>

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Json
}

interface Tool {
  name: string
  description: string
  schema: z.ZodType
  run: (args: never) => Promise<unknown>
}

const slug = z.string().describe('The project slug (see vno_list_projects)')
const lang = z.enum(['en', 'hr'])
const wait = z.boolean().optional().describe('Wait until the jobs finish before answering')

export interface McpOptions {
  /** How long a `wait` call waits at most (ms). Default 10 minutes. */
  waitTimeoutMs?: number
}

/** The tool list, bound to a service. */
export function buildTools(svc: VnService, opts: McpOptions = {}): Tool[] {
  const timeoutMs = opts.waitTimeoutMs ?? 10 * 60_000
  const settle = async (s: string, doWait: boolean | undefined) => {
    if (!doWait) return { waited: false }
    const r = await svc.waitIdle(s, { timeoutMs })
    return { waited: true, timedOut: r.timedOut, failedJobs: r.failed }
  }
  const def = <S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.output<S>) => Promise<unknown>): Tool => ({ name, description, schema, run: run as Tool['run'] })

  return [
    def('vno_list_books', 'List the books in the Scriptorium library that can become visual novels (slug, title, format, folder).', z.object({}), async () => ({ scriptoriumData: svc.scriptoriumDir(), books: await svc.listSourceBooks() })),
    def(
      'vno_import',
      'Import a book (a book folder, or a Scriptorium library slug) into a new VN Studio project. The language is detected; pass lang to override it. Returns the project slug and the detected language.',
      z.object({ source: z.string().describe('A book folder path or a library slug'), lang: lang.optional(), run: z.boolean().optional().describe('Start the pipeline after the import') }),
      async (a) => {
        const r = await svc.importProject(a.source, { lang: a.lang })
        const run = a.run ? await svc.runPipeline(r.slug, 'analyse') : null
        return { slug: r.slug, preview: r.preview, run }
      }
    ),
    def('vno_list_projects', 'List the projects with their language, editions, asset counts and pipeline state.', z.object({}), async () => ({ projects: await svc.listProjects() })),
    def(
      'vno_run_pipeline',
      `Run the pipeline for a project from a step (${STEPS.join(', ')}); default: analyse. It is restartable from any step. Use vno_status to follow it, or pass wait.`,
      z.object({ slug, from: z.string().optional().describe(`One of ${STEPS.join(', ')}`), force: z.boolean().optional().describe('Plan and generate again, even for assets that have a file'), wait }),
      async (a) => {
        if (a.from !== undefined && !isStep(a.from)) throw new Error(`from must be one of ${STEPS.join(', ')}`)
        const r = await svc.runPipeline(a.slug, a.from as PipelineStep | undefined, { force: a.force })
        return { ...r, ...(await settle(a.slug, a.wait)), status: await svc.status(a.slug) }
      }
    ),
    def('vno_status', 'The pipeline state of a project: each step, the jobs queued, running, done and failed, and the failures.', z.object({ slug }), async (a) => svc.status(a.slug)),
    def(
      'vno_asset_list',
      'List the assets of a project (backgrounds, character sheets, sprites, cover, music, voice references) with their prompt, versions, lock and file.',
      z.object({ slug, kind: z.enum(['background', 'sheet', 'sprite', 'cover', 'music', 'voiceRef']).optional() }),
      async (a) => {
        const assets = await svc.listAssets(a.slug)
        return { assets: assets.filter((x) => !a.kind || x.kind === a.kind).map((x) => ({ id: x.id, kind: x.kind, prompt: x.prompt, engine: x.engine, selected: x.selected, versions: x.versions.length, source: x.source, locked: x.locked, review: x.review, file: x.fileRel, unused: x.orphaned })) }
      }
    ),
    def(
      'vno_asset_replace',
      'Use your own file for an asset (it becomes custom and locked, and the next build uses it). Rebuilds the game unless rebuild is false.',
      z.object({ slug, id: z.string().describe('The asset id, for example bg_harbour_dusk or sprite_mara_happy'), file: z.string().describe('Absolute path of the image or audio file'), rebuild: z.boolean().optional(), wait }),
      async (a) => {
        const entry = await svc.replaceAsset(a.slug, a.id, a.file, { rebuild: a.rebuild })
        return { asset: svc.assetView(a.slug, entry), ...(a.rebuild === false ? {} : await settle(a.slug, a.wait)) }
      }
    ),
    def(
      'vno_asset_regen',
      'Generate a new version of an asset with ComfyUI (optionally with a new prompt, engine or seed), select it, and rebuild.',
      z.object({ slug, id: z.string(), prompt: z.string().optional(), engine: z.string().optional(), seed: z.number().int().optional(), wait }),
      async (a) => {
        const jobs = await svc.regenerateAsset(a.slug, a.id, { prompt: a.prompt, engine: a.engine, seed: a.seed })
        return { jobs, ...(await settle(a.slug, a.wait)) }
      }
    ),
    def(
      'vno_build',
      "Build the Ren'Py game of a project (waits for the build by default). Returns the game folder, the theme, which assets are still placeholders and the build warnings.",
      z.object({ slug, wait }),
      async (a) => {
        const job = await svc.enqueueBuild(a.slug)
        const w = await settle(a.slug, a.wait ?? true)
        return { job, ...w, build: (await svc.detail(a.slug).catch(() => null))?.build ?? null }
      }
    ),
    def(
      'vno_lint',
      "Run Ren'Py lint on the built game (waits by default). Returns ok and the problems; skipped when the SDK is missing or the game is not built.",
      z.object({ slug, wait }),
      async (a) => {
        const job = await svc.enqueueLint(a.slug)
        const w = await settle(a.slug, a.wait ?? true)
        return { job, ...w, lint: (await svc.detail(a.slug).catch(() => null))?.lint ?? null }
      }
    ),
    def(
      'vno_add_edition',
      'Add a translated edition (a book folder in the same format, translated by a person) to a project. It reuses every asset and only adds text. Returns the alignment report.',
      z.object({ slug, source: z.string().describe('The translated book folder (or library slug)'), lang, wait }),
      async (a) => {
        const job = await svc.addEdition(a.slug, a.source, a.lang)
        const w = await settle(a.slug, a.wait ?? true)
        return { job, ...w, report: await svc.alignReport(a.slug, a.lang) }
      }
    )
  ]
}

const reply = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** Handles one JSON-RPC message. Returns the response, or null for a notification. */
export class McpServer {
  private readonly tools: Tool[]

  constructor(svc: VnService, opts: McpOptions = {}) {
    this.tools = buildTools(svc, opts)
  }

  toolList(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
    return this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchemaOf(t.schema) }))
  }

  async handle(msg: RpcRequest): Promise<Json | null> {
    const isNotification = msg.id === undefined
    switch (msg.method) {
      case 'initialize': {
        const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : ''
        return reply(msg.id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO })
      }
      case 'ping':
        return isNotification ? null : reply(msg.id, {})
      case 'tools/list':
        return reply(msg.id, { tools: this.toolList() })
      case 'tools/call': {
        const name = msg.params?.name
        const tool = this.tools.find((t) => t.name === name)
        if (!tool) return fail(msg.id, -32602, `unknown tool "${String(name)}"`)
        const parsed = tool.schema.safeParse(msg.params?.arguments ?? {})
        if (!parsed.success) {
          return reply(msg.id, { isError: true, content: [{ type: 'text', text: `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}` }] })
        }
        try {
          const result = await tool.run(parsed.data as never)
          return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
        } catch (e) {
          return reply(msg.id, { isError: true, content: [{ type: 'text', text: (e as Error).message }] })
        }
      }
      default:
        if (isNotification || msg.method?.startsWith('notifications/')) return null
        return fail(msg.id, -32601, `method not found: ${String(msg.method)}`)
    }
  }
}

/** Reads newline-delimited JSON-RPC from `input` and writes the responses to `output`. Resolves when the input ends. */
export function serveMcp(server: McpServer, input: Readable, output: Writable): Promise<void> {
  return new Promise((resolve) => {
    let buf = ''
    let pending = 0
    let chain: Promise<void> = Promise.resolve()
    let ended = false
    const finish = () => {
      if (ended && pending === 0) resolve()
    }
    const send = (m: Json) => output.write(JSON.stringify(m) + '\n')
    const onLine = (line: string) => {
      const t = line.trim()
      if (!t) return
      let msg: RpcRequest
      try {
        msg = JSON.parse(t) as RpcRequest
      } catch {
        send(fail(null, -32700, 'parse error'))
        return
      }
      pending++
      // one request at a time, in the order they came: a client that sends an import and then a build expects them in that order
      chain = chain
        .then(() => server.handle(msg))
        .then((r) => {
          if (r) send(r)
        })
        .catch((e: Error) => {
          send(fail(msg.id, -32603, e.message))
        })
        .finally(() => {
          pending--
          finish()
        })
    }
    input.setEncoding('utf8')
    input.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    input.on('end', () => {
      if (buf.trim()) onLine(buf)
      buf = ''
      ended = true
      finish()
    })
  })
}
