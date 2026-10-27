// PROD-01 wait: watch the five books until they publish, without polling by hand.
//
//   node scripts/prod-wait.mjs [--minutes 60] [--interval 60]
//
// Prints one line per stage change (and every 15 minutes as a heartbeat), and exits 0 when all
// five are published, 1 when a book needs the operator (rejected or failed), 2 on timeout.
// The exit status is the notification: run it as a background job and read the output.
import { appendFileSync, mkdirSync } from 'node:fs'

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 ? Number(process.argv[i + 1]) || d : d
}
const MINUTES = arg('minutes', 60)
const INTERVAL = arg('interval', 60)
const FIVE = ['circuit-breaker', 'echoes-in-the-deep', 'the-salt-line', 'the-silent-signal', 'the-silent-summit']
const DIR = '.claude/temp/prod01'
mkdirSync(DIR, { recursive: true })
const log = (m) => {
  const line = `${new Date().toISOString()} ${m}`
  console.log(line)
  appendFileSync(`${DIR}/wait.log`, line + '\n')
}

async function mcp(url, tool, args = {}, timeoutS = 60) {
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
  await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prod-wait', version: '1' } } })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const out = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } })
  if (out?.error) throw new Error(out.error.message ?? 'tool error')
  const content = out?.result?.content ?? []
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  return text ? JSON.parse(text) : null
}

const SR = 'http://127.0.0.1:7341/mcp'
const last = new Map()
const deadline = Date.now() + MINUTES * 60_000
let beat = 0
log(`wait start: five books, ${MINUTES} min, every ${INTERVAL} s`)

for (;;) {
  let books
  try {
    books = await mcp(SR, 'list_books', {})
  } catch (e) {
    log(`Scriptorium unreachable: ${e.message}`)
    books = null
  }
  if (books) {
    const five = books.filter((b) => FIVE.includes(b.slug))
    const done = []
    for (const b of five) {
      const mark = `${b.stage} ${b.chaptersWritten}/${b.chaptersPlanned} ${b.words}w${b.paused ? ' PAUSED' : ''}`
      if (last.get(b.slug) !== mark) {
        log(`${b.slug}: ${mark}${b.score ? ` score=${b.score}` : ''}`)
        last.set(b.slug, mark)
      }
      if (b.stage === 'published') done.push(b.slug)
      if (b.stage === 'rejected' || b.stage === 'failed') {
        log(`${b.slug} needs the operator (${b.stage}): ${(b.reasons ?? []).join(' | ').slice(0, 300)}`)
        process.exit(1)
      }
    }
    if (done.length === FIVE.length) {
      log('all five published')
      process.exit(0)
    }
    if (Date.now() > deadline) {
      log(`timed out; published ${done.length}/5`)
      process.exit(2)
    }
    if (++beat % 15 === 0) log(`heartbeat: ${five.map((b) => `${b.slug}=${b.stage}`).join(' ')}`)
  }
  await new Promise((r) => setTimeout(r, INTERVAL * 1000))
}
