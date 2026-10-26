// PROD-01 service guard: keeps the services the production needs alive.
//   node scripts/service-guard.mjs
// Checks, in order: flow-music-mcp (7462), VN Studio (7459), Scriptorium (7341).
// A down service is started detached (Flow as `node dist/index.js` in its repo, the engines
// with creative-hub\scripts\hub.ps1 start <id> -Force) and the result is logged to
// .claude/temp/prod01/service-guard.log. Meant for a scheduled task every 10 minutes.

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'

const NODE = 'C:\\Users\\Infplane\\AppData\\Roaming\\fnm\\node-versions\\v24.14.0\\installation\\node.exe'
const HUB = 'C:\\projects\\Personal\\creative-hub\\scripts\\hub.ps1'
const FLOW_REPO = 'C:\\projects\\Personal\\flow-music-mcp'
const DIR = '.claude/temp/prod01'
mkdirSync(DIR, { recursive: true })
const log = (m) => appendFileSync(`${DIR}/service-guard.log`, `${new Date().toISOString()} ${m}\n`)

async function alive(port) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(new Error('timeout')), 5000)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'guard', version: '1' } } }),
      signal: ac.signal
    })
    return res.ok || res.status === 406
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

function detached(exe, args, cwd) {
  const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return child.pid
}

const services = [
  {
    id: 'flow-music-mcp',
    port: 7462,
    start: () => detached(NODE, ['dist/index.js'], FLOW_REPO)
  },
  {
    id: 'vn-studio',
    port: 7459,
    start: () => detached('pwsh', ['-NoProfile', '-File', HUB, 'start', 'vn-studio'], 'C:\\projects\\Personal\\creative-hub')
  },
  {
    id: 'scriptorium',
    port: 7341,
    start: () => detached('pwsh', ['-NoProfile', '-File', HUB, 'start', 'scriptorium', '-Force'], 'C:\\projects\\Personal\\creative-hub')
  }
]

for (const s of services) {
  if (await alive(s.port)) continue
  try {
    const pid = s.start()
    log(`${s.id} was down on ${s.port}; started detached (pid ${pid})`)
  } catch (e) {
    log(`${s.id} was down and could not be started: ${e.message}`)
  }
}
