// Minimal MCP Streamable-HTTP client for the local engines (Scriptorium 7341, VN Studio 7459,
// flow-music-mcp 7462, ...). No dependencies; Node 24 fetch.
//
//   node scripts/mcp-call.mjs --url http://127.0.0.1:7459/mcp --tool vno_status --args '{"slug":"x"}'
//   node scripts/mcp-call.mjs --url ... --method tools/list
//   node scripts/mcp-call.mjs ... --args @args.json --timeout 900
//
// Prints the tool's text content. Exit 0 ok, 2 tool error, 3 transport error.

import { readFileSync } from 'node:fs'

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return true
  return v
}

const url = String(arg('url', 'http://127.0.0.1:7459/mcp'))
const tool = arg('tool', null)
const method = String(arg('method', tool ? 'tools/call' : 'tools/list'))
const rawArgs = arg('args', '{}')
const timeoutS = Number(arg('timeout', '180'))
const quiet = !!arg('quiet', false)

function parseArgs(value) {
  if (typeof value !== 'string') return {}
  const text = value.startsWith('@') ? readFileSync(value.slice(1), 'utf8') : value
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch (e) {
    console.error(`bad --args JSON: ${e.message}`)
    process.exit(3)
  }
}

const toolArgs = parseArgs(rawArgs)
let sessionId = null

async function rpc(body, { notification = false } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18'
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`timed out after ${timeoutS}s`)), timeoutS * 1000)
  let res
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const ctype = res.headers.get('content-type') || ''
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 2000)}`)
  if (notification) return null
  if (ctype.includes('text/event-stream')) {
    // Last data: line that carries a JSON-RPC message with our id.
    const lines = text.split(/\r?\n/)
    let last = null
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      try {
        const msg = JSON.parse(payload)
        if (msg && (msg.id !== undefined || msg.method)) last = msg
      } catch {
        /* keep the previous */
      }
    }
    if (!last) throw new Error(`no JSON-RPC message in SSE: ${text.slice(0, 500)}`)
    return last
  }
  return text.trim() ? JSON.parse(text) : null
}

try {
  const init = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-vno-agent', version: '1.0' } }
  })
  if (!quiet && init?.result?.serverInfo) {
    console.error(`[mcp] ${init.result.serverInfo.name} ${init.result.serverInfo.version ?? ''}`.trim())
  }
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { notification: true })

  const call =
    method === 'tools/call'
      ? { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: toolArgs } }
      : { jsonrpc: '2.0', id: 2, method, params: method === 'tools/list' ? {} : toolArgs }
  const out = await rpc(call)
  if (out?.error) {
    console.error(`[mcp] ${out.error.message ?? JSON.stringify(out.error)}`)
    process.exit(2)
  }
  const result = out?.result
  if (!result) {
    console.log(JSON.stringify(out))
    process.exit(0)
  }
  if (result.content) {
    for (const c of result.content) {
      if (c.type === 'text') console.log(c.text)
      else console.log(JSON.stringify(c))
    }
  } else {
    console.log(JSON.stringify(result, null, 2))
  }
  if (result.isError) process.exit(2)
} catch (e) {
  console.error(`[mcp] ${e?.message ?? e}`)
  process.exit(3)
}
