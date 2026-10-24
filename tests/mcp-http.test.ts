import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpHttpServer } from '../src/engine/mcp/http'
import { buildTools } from '../src/engine/mcp/tools'
import type { BatchItem, BatchResult, FileResult, VibeTtsClient, VibeVoiceList } from '../src/engine/voice/vibetts'
import { waitFor } from './helpers'
import { book, makeVnEnv } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

/** A VibeTTS with a few fixed voices that writes tiny "audio" files. */
class FakeVibeTts implements VibeTtsClient {
  url = 'http://fake/mcp'
  async listVoices(): Promise<VibeVoiceList> {
    return {
      voices: [
        { id: 'af_heart', label: 'af_heart (Kokoro)', engine: 'kokoro', languages: ['en'] },
        { id: 'supertonic:F2', label: 'F2 (Supertonic)', engine: 'supertonic', languages: ['en', 'hr'] }
      ],
      languages: [{ code: 'en', name: 'English' }, { code: 'hr', name: 'Croatian' }],
      english: { engine: 'kokoro', voice: 'af_heart' },
      other: { language: 'hr', voice: 'supertonic:F2' },
      language_mode: 'auto',
      supertonic_installed: true
    }
  }
  async synthesizeToFile(a: { text: string; output: string }): Promise<FileResult> {
    await mkdir(path.dirname(a.output), { recursive: true })
    await writeFile(a.output, `AUDIO:${a.text}`)
    return { path: a.output, duration_seconds: 1 }
  }
  async synthesizeBatch(items: BatchItem[]): Promise<BatchResult> {
    return { results: items.map((i) => ({ output: i.output, duration_s: 1, ok: true, error: null })) }
  }
  async stop() {}
}

let env: VnEnv | undefined
let server: McpHttpServer | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined)
  await server?.stop()
  server = undefined
  await env?.cleanup()
  env = undefined
})

async function start(o: { token?: string; port?: number; client?: boolean } = {}): Promise<McpHttpServer> {
  env = await makeVnEnv({ sdk: false, client: o.client, engine: { vibetts: new FakeVibeTts() } })
  server = new McpHttpServer({ host: { tools: buildTools(env.engine.vn, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue }) }, port: o.port ?? 0, token: o.token })
  const st = await server.start()
  expect(st.running).toBe(true)
  return server
}

async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined }))
  clients.push(client)
  return client
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }

/** A raw POST with chosen headers (the SDK client always sends a good Host). */
function post(url: string, headers: Record<string, string>, body: unknown = INIT): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      let text = ''
      res.on('data', (d: Buffer) => (text += d.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

describe('MCP over HTTP', () => {
  it('initialises, lists the old and new tools, calls one and reads the guide', async () => {
    const s = await start()
    expect(s.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const client = await connect(s.url()!)
    expect(client.getServerVersion()).toMatchObject({ name: 'vn-studio' })
    expect(client.getInstructions()).toMatch(/vno_voice_status/)
    expect(s.getStatus().sessions).toBe(1)
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const n of ['vno_list_books', 'vno_import', 'vno_list_projects', 'vno_run_pipeline', 'vno_status', 'vno_build', 'vno_add_edition', 'vno_get_project', 'vno_update_beat', 'vno_asset_pick', 'vno_asset_generate', 'vno_themes', 'vno_wait', 'vno_pause_all', 'vno_voice_status', 'vno_voice_plan', 'vno_voice_set', 'vno_voice_preview', 'vno_voice_generate', 'vno_client_tasks', 'vno_get_task', 'vno_submit_task', 'vno_release_task']) expect(names).toContain(n)
    const imported = await client.callTool({ name: 'vno_import', arguments: { source: book('linear-en') } })
    expect(imported.structuredContent).toMatchObject({ slug: 'lighthouse-letters' })
    const list = await client.callTool({ name: 'vno_list_projects', arguments: {} })
    expect((list.structuredContent as { projects: unknown[] }).projects).toHaveLength(1)
    const guide = await client.readResource({ uri: 'vn-studio://guide' })
    expect((guide.contents[0] as { text: string }).text).toMatch(/Kokoro voices/)
    await s.stop()
    expect(s.getStatus()).toMatchObject({ running: false, url: null, sessions: 0 })
  })

  it('lists the voices and sets one through the voice tools', async () => {
    const s = await start()
    const client = await connect(s.url()!)
    const status = (await client.callTool({ name: 'vno_voice_status', arguments: {} })).structuredContent as { ok: boolean; supertonicInstalled: boolean; voices: { id: string; languages: string[] }[] }
    expect(status).toMatchObject({ ok: true, supertonicInstalled: true })
    expect(status.voices.map((v) => v.id)).toEqual(['af_heart', 'supertonic:F2'])
    await env!.engine.vn.importProject(book('linear-en'))
    const slug = 'lighthouse-letters'
    const set = await client.callTool({ name: 'vno_voice_set', arguments: { slug, speakerKey: 'narrator', lang: 'en', voice: 'af_heart' } })
    expect(set.isError).toBeFalsy()
    expect(set.structuredContent).toMatchObject({ preview: { slug, speakerKey: 'narrator', voice: 'af_heart', lang: 'en' } })
    expect((await env!.engine.vn.store.loadSettings(slug)).settings.voice.voices.narrator).toEqual({ en: 'af_heart' })
    // preview without a voice uses the assigned one; a speaker without one is told what to do
    expect((await client.callTool({ name: 'vno_voice_preview', arguments: { slug, speakerKey: 'narrator', lang: 'en' } })).structuredContent).toMatchObject({ preview: { voice: 'af_heart' } })
    const none = await client.callTool({ name: 'vno_voice_preview', arguments: { slug, speakerKey: 'narrator', lang: 'hr' } })
    expect(none.isError).toBe(true)
    expect((await client.callTool({ name: 'vno_voice_set', arguments: { slug, speakerKey: 'narrator', lang: 'en', voice: 'nope' } })).isError).toBe(true)
  })

  it('answers vno_status while a vno_wait call is still open', async () => {
    const s = await start()
    const waiter = await connect(s.url()!)
    const other = await connect(s.url()!)
    await env!.engine.vn.importProject(book('linear-en'))
    await env!.engine.setPaused(true) // the jobs stay queued, so the wait has to time out
    await env!.engine.vn.runPipeline('lighthouse-letters')
    let waitDone = false
    const waiting = waiter.callTool({ name: 'vno_wait', arguments: { slug: 'lighthouse-letters', timeoutSeconds: 2 } }).then((r) => {
      waitDone = true
      return r
    })
    await new Promise((r) => setTimeout(r, 300))
    const st = await other.callTool({ name: 'vno_status', arguments: { slug: 'lighthouse-letters' } })
    expect(st.isError).toBeFalsy()
    expect(waitDone).toBe(false) // the status came back first
    const done = await waiting
    expect((done.structuredContent as { timedOut: boolean }).timedOut).toBe(true)
  }, 30_000)

  it('refuses a wrong Host or Origin, and a missing or wrong token', async () => {
    const s = await start({ token: 's3cret' })
    const url = s.url()!
    const port = new URL(url).port
    const good = { host: `127.0.0.1:${port}`, authorization: 'Bearer s3cret' }
    expect((await post(url, good)).status).toBe(200)
    expect((await post(url, { ...good, host: 'evil.example:80' })).status).toBe(403)
    expect((await post(url, { ...good, origin: 'http://evil.example' })).status).toBe(403)
    expect((await post(url, { host: good.host })).status).toBe(401)
    expect((await post(url, { host: good.host, authorization: 'Bearer nope' })).status).toBe(401)
    expect((await post(url.replace('/mcp', '/other'), good)).status).toBe(404)
    await expect(connect(url)).rejects.toThrow()
    const ok = await connect(url, 's3cret')
    expect((await ok.listTools()).tools.length).toBeGreaterThan(20)
  })

  it('reports a port that is already in use instead of throwing', async () => {
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const port = (blocker.address() as net.AddressInfo).port
    try {
      env = await makeVnEnv({ sdk: false })
      const seen: unknown[] = []
      server = new McpHttpServer({ host: { tools: buildTools(env.engine.vn) }, port, onStatus: (st) => seen.push(st) })
      const st = await server.start()
      expect(st).toMatchObject({ running: false, url: null, error: `Port ${port} is already in use.` })
      expect(seen).toHaveLength(1)
    } finally {
      await new Promise((r) => blocker.close(r))
    }
  })
})

describe('MCP client tasks', () => {
  type Tasks = { waiting: number; leased: number; tasks: { id: string; state: string; role: string }[] }
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })).structuredContent as Record<string, unknown>

  it('lists the four client tools, the guide section and clientTasks in vno_status', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const names = (await c.listTools()).tools.map((t) => t.name)
    for (const n of ['vno_client_tasks', 'vno_get_task', 'vno_submit_task', 'vno_release_task']) expect(names).toContain(n)
    expect(c.getInstructions()).toMatch(/vno_get_task/)
    expect(await call(c, 'vno_client_tasks')).toEqual({ waiting: 0, leased: 0, tasks: [] })
    expect(await call(c, 'vno_get_task')).toEqual({ none: true, waiting: 0 })
    await env!.engine.vn.importProject(book('linear-en'))
    expect((await call(c, 'vno_status', { slug: 'lighthouse-letters' })).clientTasks).toEqual({ waiting: 0, leased: 0 })
    const guide = (await c.readResource({ uri: 'vn-studio://guide' })).contents[0] as { text: string }
    expect(guide.text).toMatch(/Do the model work yourself/)
  })

  it('vno_get_task takes a client: without it only claude-code tasks, with client: "antigravity" only that client tasks', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const queue = env!.engine.clientQueue
    const user = [{ role: 'user' as const, content: 'hi' }]
    queue.add({ client: 'antigravity', messages: user }, { job: 'p--vn.art.plan--all--r1', role: 'art-director', task: 'vn.art.plan', book: 'p' })
    expect(await call(c, 'vno_get_task')).toEqual({ none: true, waiting: 1 })
    expect(await call(c, 'vno_get_task', { client: 'claude-code' })).toEqual({ none: true, waiting: 1 })
    expect(((await call(c, 'vno_client_tasks')) as unknown as { tasks: { client: string }[] }).tasks[0]!.client).toBe('antigravity')
    const got = await call(c, 'vno_get_task', { client: 'antigravity' })
    expect(got).toMatchObject({ taskId: 'p--vn.art.plan--all--r1#1', meta: { client: 'antigravity', role: 'art-director' } })
    const tool = (await c.listTools()).tools.find((t) => t.name === 'vno_get_task')!
    expect(tool.description).toMatch(/client: "antigravity"/)
    expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toContain('client')
  })

  it('vno_wait returns at once while a job waits for the client; get, bad submit, release and good submit work over MCP', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const svc = env!.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.reconcileAssets(slug)
    await svc.enqueue(slug, 'vn.art.plan', 'all', 1)
    const t0 = Date.now()
    const waited = await waitFor(async () => {
      const w = await call(c, 'vno_wait', { slug, timeoutSeconds: 20 })
      return (w.clientTasks as number) > 0 ? w : null
    }, 30_000, 'vno_wait with clientTasks')
    expect(Date.now() - t0).toBeLessThan(15_000)
    expect(waited).toMatchObject({ timedOut: false, clientTasks: 1 })
    expect(String(waited.hint)).toMatch(/vno_get_task/)
    expect((await call(c, 'vno_status', { slug })).clientTasks).toEqual({ waiting: 1, leased: 0 })
    const list = (await call(c, 'vno_client_tasks')) as unknown as Tasks
    expect(list).toMatchObject({ waiting: 1, leased: 0, tasks: [{ role: 'art-director', state: 'waiting' }] })

    expect(await call(c, 'vno_get_task', { role: 'composer' })).toEqual({ none: true, waiting: 1 })
    const got = await call(c, 'vno_get_task', { task: 'vn.art.plan' })
    expect(got).toMatchObject({ taskId: expect.stringMatching(/--vn\.art\.plan--all--r1#1$/), meta: { role: 'art-director', task: 'vn.art.plan', book: slug }, leaseMinutes: 30 })
    expect(typeof got.system).toBe('string')
    expect(got.user).toMatch(/^Assets \(id/m)
    expect(got.schema).toMatchObject({ type: 'object' })
    expect(got.output).toBe('Reply with one JSON object that matches `schema`. No prose, no code fence.')
    expect(await call(c, 'vno_get_task')).toEqual({ none: true, waiting: 0 }) // it is leased now
    const bad = await call(c, 'vno_submit_task', { taskId: got.taskId, text: 'no' })
    expect(bad.accepted).toBe(false)
    expect((bad.problems as string[]).length).toBeGreaterThan(0)
    expect(await call(c, 'vno_release_task', { taskId: got.taskId })).toEqual({ released: true })
    expect(((await call(c, 'vno_client_tasks')) as unknown as Tasks).waiting).toBe(1)
    expect(await call(c, 'vno_release_task', { taskId: 'nope#1' })).toEqual({ released: false })
    expect(await call(c, 'vno_submit_task', { taskId: 'nope#1', text: '{}' })).toEqual({ accepted: false, problems: ['task not found (it was aborted, answered, or the engine restarted)'] })

    // answer it the way the art-director would
    const again = await call(c, 'vno_get_task', {})
    const lines = String(again.user).split('\n')
    const assets = JSON.parse(lines[lines.findIndex((l) => /^Assets \(id/.test(l)) + 1]!) as { id: string }[]
    const ok = await call(c, 'vno_submit_task', { taskId: again.taskId, text: JSON.stringify({ stylePrefix: 'ink wash', assets: assets.map((a) => ({ id: a.id, prompt: `prompt ${a.id}`, negative: '' })) }) })
    expect(ok).toEqual({ accepted: true })
    expect(((await call(c, 'vno_client_tasks')) as unknown as Tasks).leased).toBe(0)
  })

  it('a vision task returns its images as MCP image content, with [image n] in the text', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    env!.engine.clientQueue.add(
      {
        messages: [
          { role: 'system', content: 'You are the art critic.' },
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: [{ type: 'text', text: 'Is this the harbour?' }, { type: 'image', mime: 'image/png', data: 'AAAA' }, { type: 'text', text: 'And this?' }, { type: 'image', mime: 'image/jpeg', data: 'BBBB' }] }
        ]
      },
      { job: 'p--vn.art.review--bg_harbour--r1', role: 'art-critic', task: 'vn.art.review', book: 'p', unit: 'bg_harbour' }
    )
    const res = await c.callTool({ name: 'vno_get_task', arguments: { role: 'art-critic' } })
    const content = res.content as { type: string; text?: string; data?: string; mimeType?: string }[]
    expect(content.map((x) => x.type)).toEqual(['text', 'image', 'image'])
    expect(content[1]).toMatchObject({ data: 'AAAA', mimeType: 'image/png' })
    expect(content[2]).toMatchObject({ data: 'BBBB', mimeType: 'image/jpeg' })
    const view = res.structuredContent as { system: string; user: string; output: string; schema?: unknown; messages?: unknown[] }
    expect(view.system).toBe('You are the art critic.\n\nBe brief.')
    expect(view.user).toBe('Is this the harbour?\n[image 1]\nAnd this?\n[image 2]')
    expect(view.output).toBe('Reply with the text only: no preamble, no notes, no code fence.')
    expect(view.messages).toBeUndefined()
    expect((view as { turns?: string }).turns).toBe('single')
  })

  it('a multi-turn task sends system and messages, and no user', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    env!.engine.clientQueue.add(
      { messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'first ask' }, { role: 'assistant', content: 'bad answer' }, { role: 'user', content: 'repair it' }] },
      { job: 'p--vn.analyse--all--r1', role: 'script-analyst', task: 'vn.analyse', book: 'p', unit: 'all' }
    )
    const res = await c.callTool({ name: 'vno_get_task', arguments: {} })
    const view = res.structuredContent as { turns: string; system: string; user?: string; messages?: { role: string; content: string }[] }
    expect(view.turns).toBe('multi')
    expect(view.user).toBeUndefined()
    expect(view.system).toBe('SYS')
    expect(view.messages).toEqual([
      { role: 'user', content: 'first ask' },
      { role: 'assistant', content: 'bad answer' },
      { role: 'user', content: 'repair it' }
    ])
  })

  it('a single-turn task carries its user text once', async () => {
    const s = await start({ client: true })
    const c = await connect(s.url()!)
    const marker = 'UNIQUE-MARKER-' + 'x'.repeat(200)
    env!.engine.clientQueue.add(
      { messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: marker }] },
      { job: 'p--vn.analyse--all--r1', role: 'script-analyst', task: 'vn.analyse', book: 'p', unit: 'all' }
    )
    const res = await c.callTool({ name: 'vno_get_task', arguments: {} })
    const json = JSON.stringify(res.structuredContent)
    expect(json.split(marker)).toHaveLength(2)
    expect(res.structuredContent).toMatchObject({ turns: 'single', user: marker })
    expect((res.structuredContent as { messages?: unknown }).messages).toBeUndefined()
  })
})
