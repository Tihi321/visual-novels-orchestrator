// PROD-01 watchdog: keeps the production moving without manual polling.
//
// Scriptorium (7341): when one of the five stalled books is published, start its visual-novel
// adaptation (adapt_book, linear). Scriptorium's fallback chain is DeepSeek first, so the story
// is written by DeepSeek without per-book model overrides.
//
// VN Studio (7459): when a book that was adapted from the five (sourceBook) is published, import
// it, apply the production settings (Flow images, ComfyUI music/ambience, Chiptune SFX, voices
// off, DeepSeek agents, noir theme) and start its pipeline once.
//
// Everything is recorded in .claude/temp/prod01/watch-state.json and watch.log. It never restarts
// a failed step; failures are left for the operator. Run: node scripts/prod-watch.mjs [--interval 90]

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const intervalIdx = process.argv.indexOf('--interval')
const INTERVAL = (intervalIdx >= 0 ? Number(process.argv[intervalIdx + 1]) || 90 : 90) * 1000
const FIVE = ['circuit-breaker', 'echoes-in-the-deep', 'the-salt-line', 'the-silent-signal', 'the-silent-summit']
const STATE_DIR = '.claude/temp/prod01'
const STATE_PATH = `${STATE_DIR}/watch-state.json`
const LOG_PATH = `${STATE_DIR}/watch.log`
const MAX_ERRORS_PER_STEP = 3

mkdirSync(STATE_DIR, { recursive: true })
const state = (() => {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return { adapted: {}, imported: {}, started: {}, errors: {}, knownPublished: [] }
  }
})()
state.adapted ??= {}
state.imported ??= {}
state.started ??= {}
state.errors ??= {}
state.knownPublished ??= []
state.pendingPublished ??= []

function save() {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`
  console.log(line)
  appendFileSync(LOG_PATH, line + '\n')
}

async function mcp(url, tool, args = {}, timeoutS = 120) {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`)
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
  await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prod-watch', version: '1' } } })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const out = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } })
  if (out?.error) throw new Error(out.error.message ?? 'tool error')
  const text = (out?.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  return text ? JSON.parse(text) : null
}
const SR = 'http://127.0.0.1:7341/mcp'
const VN = 'http://127.0.0.1:7459/mcp'

function err(key, e) {
  state.errors[key] = (state.errors[key] ?? 0) + 1
  save()
  log(`ERROR ${key} (${state.errors[key]}/${MAX_ERRORS_PER_STEP}): ${e.message}`)
}
function mayRetry(key) {
  return (state.errors[key] ?? 0) < MAX_ERRORS_PER_STEP
}

const VN_SETTINGS = {
  theme: 'noir',
  art: { provider: 'flow', style: 'illustrated', review: false },
  music: { provider: 'comfy', engine: 'ace-step-v1-instrumental', tracks: 3 },
  sound: { sfxEngine: 'chiptune', ambienceEngine: 'ace-step-v1-instrumental' },
  models: {
    director: 'deepseek/deepseek-flash',
    'script-analyst': 'deepseek/deepseek-flash',
    'art-director': 'deepseek/deepseek-flash',
    composer: 'deepseek/deepseek-flash',
    'stage-director': 'deepseek/deepseek-flash',
    'voice-director': 'deepseek/deepseek-flash',
    'edition-aligner': 'deepseek/deepseek-flash'
  }
}
// Pipelines start as soon as an adaptation is published.
const AUTOSTART_PIPELINES = true

async function stepScriptorium() {
  let books
  try {
    books = await mcp(SR, 'list_books', {})
  } catch (e) {
    log(`Scriptorium unreachable: ${e.message}`)
    return
  }
  // remember the published set the first time, so only books published from now on are inspected
  const publishedNow = books.filter((b) => b.stage === 'published').map((b) => b.slug)
  if (state.knownPublished.length === 0) {
    state.knownPublished = publishedNow
    save()
    log(`baseline published: ${publishedNow.length} books; watching the five for publication`)
  }
  for (const name of FIVE) {
    const b = books.find((x) => x.slug === name)
    if (!b || b.stage !== 'published' || state.adapted[name] || !mayRetry(`adapt:${name}`)) continue
    try {
      const r = await mcp(SR, 'adapt_book', { book: name, format: 'visual-novel' }, 300)
      const story = r?.story ?? r?.slug ?? JSON.stringify(r).slice(0, 120)
      state.adapted[name] = { story, at: new Date().toISOString() }
      save()
      log(`ADAPTED ${name} -> story ${story}`)
    } catch (e) {
      err(`adapt:${name}`, e)
    }
  }
  // new published books: find the adaptations by their sourceBook
  const fresh = publishedNow.filter((slug) => !state.knownPublished.includes(slug))
  for (const slug of fresh) {
    let g
    try {
      g = await mcp(SR, 'get_book', { book: slug }, 60)
    } catch (e) {
      log(`get_book ${slug} failed: ${e.message}`)
      continue
    }
    const src = g?.sourceBook?.slug ?? g?.sourceBook ?? null
    if (src && FIVE.includes(src) && !state.imported[src]) {
      state.pendingPublished.push({ source: src, book: slug })
      log(`adaptation published: ${slug} (source ${src})`)
    }
    state.knownPublished.push(slug)
  }
  save()
}

async function stepVn() {
  if (!state.pendingPublished.length) return
  let projects
  try {
    projects = (await mcp(VN, 'vno_list_projects', {})).projects ?? []
  } catch (e) {
    log(`VN Studio unreachable: ${e.message}`)
    return
  }
  for (const { source, book } of [...state.pendingPublished]) {
    if (state.imported[source] || !mayRetry(`import:${source}`)) continue
    const existing = projects.find((p) => p.source && p.source.replace(/\\/g, '/').endsWith(`/books/${book}`))
    let slug = existing?.slug
    try {
      if (!slug) {
        const r = await mcp(VN, 'vno_import', { source: book }, 600)
        slug = r?.slug
        log(`IMPORTED ${book} -> project ${slug}`)
      }
      if (!slug) throw new Error('import returned no slug')
      await mcp(VN, 'vno_update_settings', { slug, ...VN_SETTINGS }, 300)
      log(`settings applied to ${slug}`)
      state.imported[source] = { project: slug, at: new Date().toISOString() }
      save()
    } catch (e) {
      err(`import:${source}`, e)
    }
  }
  // start the pipeline once per imported project (only when AUTOSTART_PIPELINES is on)
  if (!AUTOSTART_PIPELINES) {
    for (const [source, info] of Object.entries(state.imported)) {
      if (!state.started[source]) log(`configured ${info.project} (pipeline deferred)`)
    }
    return
  }
  for (const [source, info] of Object.entries(state.imported)) {
    if (state.started[source] || !mayRetry(`start:${source}`)) continue
    try {
      const st = await mcp(VN, 'vno_status', { slug: info.project })
      if ((st.jobs?.running ?? 0) > 0 || (st.jobs?.queued ?? 0) > 0) {
        log(`${info.project} already has jobs; marking started`)
        state.started[source] = { at: new Date().toISOString(), note: 'jobs present' }
        save()
        continue
      }
      const r = await mcp(VN, 'vno_run_pipeline', { slug: info.project }, 300)
      state.started[source] = { at: new Date().toISOString(), job: r?.job ?? null }
      save()
      log(`PIPELINE STARTED ${info.project} (${r?.job ?? 'no job id'})`)
    } catch (e) {
      err(`start:${source}`, e)
    }
  }
}

log(`watchdog start; interval ${INTERVAL / 1000}s; adapted=${Object.keys(state.adapted).length} imported=${Object.keys(state.imported).length} started=${Object.keys(state.started).length}`)
if (process.argv.includes('--once')) {
  await stepScriptorium()
  await stepVn()
  save()
  log('one-shot run done')
  process.exit(0)
}
for (;;) {
  await stepScriptorium()
  await stepVn()
  save()
  await new Promise((r) => setTimeout(r, INTERVAL))
}
