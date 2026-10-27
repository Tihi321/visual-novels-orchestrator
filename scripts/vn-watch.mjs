// PROD-01 helper: watch VN Studio projects until their pipelines reach build+lint.
//
//   node scripts/vn-watch.mjs --slugs echoes-in-the-deep-2,the-salt-line-2 --minutes 240
//
// Prints a line whenever a project's step statuses change, and exits 0 when every watched
// project has build=done and lint=done, 1 when a step failed (prints which), 2 on timeout.
import { appendFileSync, mkdirSync } from 'node:fs'

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 ? Number(process.argv[i + 1]) || d : d
}
const SLUGS = String(process.argv[process.argv.indexOf('--slugs') + 1] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('--'))
if (!SLUGS.length) {
  console.error('usage: node scripts/vn-watch.mjs --slugs a,b --minutes 240')
  process.exit(2)
}
const MINUTES = arg('minutes', 240)
const INTERVAL = arg('interval', 120)
const DIR = '.claude/temp/prod01'
mkdirSync(DIR, { recursive: true })
const log = (m) => {
  const line = `${new Date().toISOString()} ${m}`
  console.log(line)
  appendFileSync(`${DIR}/vn-watch.log`, line + '\n')
}

async function mcp(tool, args = {}, timeoutS = 120) {
  const url = 'http://127.0.0.1:7459/mcp'
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  let session = null
  const post = async (body) => {
    const h = { ...headers }
    if (session) h['mcp-session-id'] = session
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutS * 1000)
    let res
    try {
      res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body), signal: ac.signal })
    } finally {
      clearTimeout(t)
    }
    const sid = res.headers.get('mcp-session-id')
    if (sid) session = sid
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    if (body.id === undefined) return null
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
      let last = null
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        try {
          last = JSON.parse(line.slice(5).trim())
        } catch {
          /* ignore */
        }
      }
      return last
    }
    return text.trim() ? JSON.parse(text) : null
  }
  await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vn-watch', version: '1' } } })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const out = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } })
  if (out?.error) throw new Error(out.error.message ?? 'tool error')
  const content = out?.result?.content ?? []
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  return text ? JSON.parse(text) : null
}

const last = new Map()
const deadline = Date.now() + MINUTES * 60_000
log(`vn-watch start: ${SLUGS.join(',')} for ${MINUTES} min`)

for (;;) {
  const finished = []
  for (const slug of SLUGS) {
    let st
    try {
      st = await mcp('vno_status', { slug })
    } catch (e) {
      log(`${slug}: status error ${e.message}`)
      continue
    }
    const steps = st.pipeline?.steps ?? {}
    const view = Object.entries(steps)
      .map(([k, v]) => `${k}:${v.status}${v.done !== undefined ? `(${v.done}/${v.total ?? ''})` : ''}`)
      .join(' ')
    const jobs = `jobs q${st.jobs?.queued ?? 0} r${st.jobs?.running ?? 0} f${st.jobs?.failed ?? 0}`
    const mark = `${view} ${jobs}`
    if (last.get(slug) !== mark) {
      log(`${slug}: ${mark}`)
      last.set(slug, mark)
    }
    const failedStep = Object.entries(steps).find(([, v]) => v.status === 'failed')
    if (failedStep) {
      log(`${slug}: STEP FAILED ${failedStep[0]}: ${String(failedStep[1].message ?? '').slice(0, 300)}`)
      process.exit(1)
    }
    if ((st.jobs?.failed ?? 0) > 0) {
      log(`${slug}: ${st.jobs.failed} failed job(s): ${JSON.stringify(st.failed?.[0] ?? null).slice(0, 300)}`)
      process.exit(1)
    }
    if (steps.build?.status === 'done' && steps.lint?.status === 'done') finished.push(slug)
  }
  if (finished.length === SLUGS.length) {
    log(`all watched pipelines finished: ${finished.join(',')}`)
    process.exit(0)
  }
  if (Date.now() > deadline) {
    log(`timed out; finished ${finished.length}/${SLUGS.length}`)
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, INTERVAL * 1000))
}
