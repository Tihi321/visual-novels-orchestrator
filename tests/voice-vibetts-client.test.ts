import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { NOT_RUNNING_HINT, VibeTtsError, createVibeTtsClient, parseRpcBody } from '../src/engine/voice/vibetts'

interface Seen {
  method: string
  body: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
  headers: http.IncomingHttpHeaders
}

/** A tiny in-process MCP server: JSON answers, or SSE when `sse` is set. `tools` maps a tool name to its result. */
async function fakeServer(opts: { sse?: boolean; tools?: Record<string, (args: Record<string, unknown>) => { isError?: boolean; structured?: unknown; text?: string }>; delayMs?: number; status?: number }) {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString()))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Seen['body'] & { id?: number }
      seen.push({ method: req.method ?? '', body, headers: req.headers })
      const reply = () => {
        if (opts.status) {
          res.writeHead(opts.status).end('nope')
          return
        }
        if (body.id === undefined) {
          res.writeHead(202).end()
          return
        }
        let result: unknown
        if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }
        else {
          const out = opts.tools?.[body.params?.name ?? '']?.(body.params?.arguments ?? {})
          if (!out) {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Unknown tool' } }))
            return
          }
          result = { content: [{ type: 'text', text: out.text ?? JSON.stringify(out.structured ?? {}) }], ...(out.structured !== undefined ? { structuredContent: out.structured } : {}), isError: !!out.isError }
        }
        const msg = JSON.stringify({ jsonrpc: '2.0', id: body.id, result })
        if (opts.sse) res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`: hello\n\nevent: message\ndata: ${msg}\n\n`)
        else res.writeHead(200, { 'Content-Type': 'application/json' }).end(msg)
      }
      if (opts.delayMs) setTimeout(reply, opts.delayMs)
      else reply()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  return { url, seen, close: () => new Promise<void>((r) => server.close(() => r())) }
}

let closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})
async function serve(opts: Parameters<typeof fakeServer>[0]) {
  const s = await fakeServer(opts)
  closers.push(s.close)
  return s
}

describe('VibeTTS MCP client', () => {
  it('initializes once, then calls tools and reads the structured result', async () => {
    const s = await serve({ tools: { list_voices: () => ({ structured: { voices: [{ id: 'omni:petra', kind: 'description' }], omnivoice_installed: true } }) } })
    const c = createVibeTtsClient({ url: s.url })
    const a = await c.listVoices()
    await c.listVoices()
    expect(a.voices[0]!.id).toBe('omni:petra')
    const methods = s.seen.map((x) => x.body.method)
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call'])
    expect(s.seen[0]!.headers.accept).toContain('text/event-stream')
    expect(s.seen[2]!.headers['mcp-protocol-version']).toBe('2025-06-18')
  })

  it('sends the tool arguments (create_voice, synthesize_batch) and returns the rows', async () => {
    const s = await serve({
      tools: {
        create_voice: (a) => ({ structured: { voice: `omni:${String(a.name)}`, name: a.name, description: a.description, seed: a.seed, lang: a.lang } }),
        synthesize_batch: (a) => ({ structured: { results: (a.items as { output: string }[]).map((i) => ({ output: i.output, duration_s: 1.5, ok: true, error: null })), ok_count: 2 } })
      }
    })
    const c = createVibeTtsClient({ url: s.url })
    const v = await c.createVoice({ name: 'petra', description: 'female, teenager', seed: 5, lang: 'en' })
    expect(v).toMatchObject({ voice: 'omni:petra', seed: 5 })
    const r = await c.synthesizeBatch([{ text: 'Hi.', output: 'C:/x/a.mp3', voice: 'omni:petra', lang: 'hr' }, { text: 'Yo.', output: 'C:/x/b.mp3' }], { overwrite: true })
    expect(r.results.map((x) => x.ok)).toEqual([true, true])
    const call = s.seen.at(-1)!.body.params!
    expect(call.name).toBe('synthesize_batch')
    expect(call.arguments).toMatchObject({ overwrite: true, items: [{ lang: 'hr', voice: 'omni:petra' }, {}] })
  })

  it('reads an SSE answer', async () => {
    const s = await serve({ sse: true, tools: { list_voices: () => ({ structured: { voices: [] } }) } })
    expect((await createVibeTtsClient({ url: s.url }).listVoices()).voices).toEqual([])
  })

  it('parses JSON, batches and SSE bodies by id', () => {
    expect(parseRpcBody('{"jsonrpc":"2.0","id":3,"result":1}', 'application/json', 3)?.result).toBe(1)
    expect(parseRpcBody('[{"id":1,"result":1},{"id":2,"result":2}]', 'application/json', 2)?.result).toBe(2)
    expect(parseRpcBody('event: message\ndata: {"id":4,"result":"x"}\n\n', 'text/event-stream', 4)?.result).toBe('x')
    expect(parseRpcBody('data: {"id":9}\n\n', 'text/event-stream', 4)).toBeNull()
    expect(parseRpcBody('not json', 'application/json', 1)).toBeNull()
  })

  it('turns a tool error into a VibeTtsError with its text', async () => {
    const s = await serve({ tools: { create_voice: () => ({ isError: true, text: "A voice named 'petra' already exists" }) } })
    const c = createVibeTtsClient({ url: s.url })
    const e = await c.createVoice({ name: 'petra' }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(VibeTtsError)
    expect((e as VibeTtsError).kind).toBe('tool')
    expect((e as VibeTtsError).message).toContain('already exists')
  })

  it('says clearly that VibeTTS is not running when nothing answers, and tries again later', async () => {
    const s = await serve({ tools: { list_voices: () => ({ structured: { voices: [] } }) } })
    const port = new URL(s.url).port
    await s.close()
    closers = []
    const c = createVibeTtsClient({ url: `http://127.0.0.1:${port}/mcp`, timeoutMs: 2000 })
    const e = await c.listVoices().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(VibeTtsError)
    expect((e as VibeTtsError).kind).toBe('unreachable')
    expect((e as VibeTtsError).message).toBe(NOT_RUNNING_HINT)
    expect(NOT_RUNNING_HINT).toContain('python -m vibetts --mcp-only')
    expect(NOT_RUNNING_HINT).toContain('Settings > Agents (MCP)')
  })

  it('times out and reports HTTP errors', async () => {
    const slow = await serve({ delayMs: 400, tools: {} })
    const e1 = await createVibeTtsClient({ url: slow.url, timeoutMs: 100 }).listVoices().catch((x: unknown) => x)
    expect((e1 as VibeTtsError).kind).toBe('timeout')
    const bad = await serve({ status: 403 })
    const e2 = await createVibeTtsClient({ url: bad.url }).listVoices().catch((x: unknown) => x)
    expect((e2 as VibeTtsError).kind).toBe('http')
    expect((e2 as VibeTtsError).message).toContain('403')
  })

  it('stops when the signal aborts', async () => {
    const slow = await serve({ delayMs: 500, tools: {} })
    const ctl = new AbortController()
    const p = createVibeTtsClient({ url: slow.url, timeoutMs: 5000 }).listVoices(ctl.signal)
    setTimeout(() => ctl.abort(), 50)
    expect(((await p.catch((x: unknown) => x)) as VibeTtsError).kind).toBe('aborted')
  })
})
