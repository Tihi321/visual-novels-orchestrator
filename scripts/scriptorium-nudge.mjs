// Scriptorium nudge: restarts the engine when its scheduler goes idle with work left.
//   node scripts/scriptorium-nudge.mjs
// A stall looks like: factory_status.running empty while the queue has jobs or while books are
// in reviewing/rewriting/publishing/outlining/drafting/humanizing. Checked twice 20 s apart,
// then `hub.ps1 stop scriptorium -Force` + `start scriptorium -Force` are run. Log: nudge.log.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SR = 'http://127.0.0.1:7341/mcp'
const HUB = 'C:\\projects\\Personal\\creative-hub\\scripts\\hub.ps1'
const JOBS = join(process.env.USERPROFILE, 'Scriptorium', 'jobs', 'queued')
const DIR = '.claude/temp/prod01'
const ACTIVE = ['reviewing', 'rewriting', 'publishing', 'outlining', 'drafting', 'humanizing']
mkdirSync(DIR, { recursive: true })
const log = (m) => appendFileSync(join(DIR, 'nudge.log'), `${new Date().toISOString()} ${m}\n`)

async function mcp(tool, args = {}, timeoutS = 30) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  const post = async (body) => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutS * 1000)
    try {
      const res = await fetch(SR, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal })
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
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
    } finally {
      clearTimeout(t)
    }
  }
  await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nudge', version: '1' } } })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const out = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } })
  if (out?.error) throw new Error(out.error.message ?? 'tool error')
  const text = (out?.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  return text ? JSON.parse(text) : null
}

async function snapshot() {
  const st = await mcp('factory_status')
  let queued = 0
  try {
    queued = readdirSync(JOBS).filter((n) => n.endsWith('.md')).length
  } catch {
    /* no queue folder */
  }
  const active = Object.entries(st.booksByStage ?? {}).filter(([k]) => ACTIVE.includes(k)).reduce((n, [, v]) => n + v, 0)
  return { running: st.running?.length ?? 0, queued, active, paused: st.paused }
}

function restart(why) {
  log(`restart: ${why}`)
  try {
    execFileSync('pwsh', ['-NoProfile', '-File', HUB, 'stop', 'scriptorium', '-Force'], { stdio: 'ignore' })
    execFileSync('pwsh', ['-NoProfile', '-File', HUB, 'start', 'scriptorium', '-Force'], { stdio: 'ignore', timeout: 180000 })
    log('restart: done')
  } catch (e) {
    log(`restart failed: ${e.message}`)
  }
}

try {
  const a = await snapshot()
  if (a.paused) {
    log(`paused; nothing to do (running=${a.running} queued=${a.queued} active=${a.active})`)
    process.exit(0)
  }
  if (a.running === 0 && (a.queued > 0 || a.active > 0)) {
    await new Promise((r) => setTimeout(r, 20000))
    const b = await snapshot()
    if (b.running === 0 && (b.queued > 0 || b.active > 0)) restart(`idle with work: running=${b.running} queued=${b.queued} active=${b.active}`)
    else log(`transient idle; recovered (running=${b.running})`)
  }
} catch (e) {
  log(`check failed: ${e.message}`)
}
