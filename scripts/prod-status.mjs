// Compact production status for PROD-01: Scriptorium (7341) and VN Studio (7459).
//   node scripts/prod-status.mjs            both apps
//   node scripts/prod-status.mjs books      Scriptorium only
//   node scripts/prod-status.mjs vn         VN Studio only
// Exit 0; prints JSON-ish text lines. Never throws on a down server (prints DOWN).

const which = process.argv[2] ?? 'all'

async function mcp(url, tool, args = {}, timeoutS = 30) {
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
  await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prod-status', version: '1' } } })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const out = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } })
  if (out?.error) throw new Error(out.error.message ?? 'tool error')
  const content = out?.result?.content ?? []
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  return text ? JSON.parse(text) : null
}

function line(...parts) {
  console.log(parts.join(' '))
}

async function books() {
  line('## Scriptorium')
  try {
    const st = await mcp('http://127.0.0.1:7341/mcp', 'factory_status')
    line(`paused=${st.paused} spendToday=$${st.spend.today.toFixed(4)} month=$${st.spend.month.toFixed(2)}/${st.spend.monthlyCap} capDay=${st.spend.dailyCap}`)
    line(`stages=${JSON.stringify(st.booksByStage)} running=${st.running.length} busy=${st.agents?.busy ?? '?'} blocked=${JSON.stringify(st.blocked).slice(0, 200)}`)
    for (const r of st.running) line(`  running ${r.jobId} (${r.agent})`)
    if (st.embeddings) line(`embeddings ${st.embeddings.provider}/${st.embeddings.model} down=${st.embeddings.down}`)
    const all = await mcp('http://127.0.0.1:7341/mcp', 'list_books', {})
    for (const b of all.filter((x) => ['drafting', 'outline', 'reviewing', 'rewriting', 'rejected', 'failed'].includes(x.stage))) {
      line(`  ${b.slug} stage=${b.stage}${b.paused ? ' PAUSED' : ''} ch=${b.chaptersWritten}/${b.chaptersPlanned} words=${b.words}/${b.targetWords} score=${b.score ?? '-'}`)
    }
    return all
  } catch (e) {
    line(`Scriptorium DOWN/ERR: ${e.message}`)
    return []
  }
}

async function vn() {
  line('## VN Studio')
  try {
    const list = await mcp('http://127.0.0.1:7459/mcp', 'vno_list_projects')
    const projects = list.projects ?? list
    for (const p of projects) {
      if (!['the-local-patch-2'].includes(p.slug) && !p.slug.startsWith('the-') && !p.slug.startsWith('echoes') && !p.slug.startsWith('circuit') && !p.slug.startsWith('windward')) continue
      const st = await mcp('http://127.0.0.1:7459/mcp', 'vno_status', { slug: p.slug })
      const steps = st.pipeline?.steps ?? {}
      const build = steps.build?.status ?? 'idle'
      const gen = steps.generate
      const lint = steps.lint?.status ?? 'idle'
      line(`  ${p.slug}: build=${build} lint=${lint} jobs=${JSON.stringify(st.jobs)} failed=${st.failed?.length ?? 0}`)
      if (gen) line(`    generate=${gen.status} ${gen.done ?? 0}/${gen.total ?? 0} ${(gen.message ?? '').slice(0, 90)}`)
      if (st.failed?.length) line(`    FAILED ${JSON.stringify(st.failed).slice(0, 400)}`)
    }
    return projects
  } catch (e) {
    line(`VN Studio DOWN/ERR: ${e.message}`)
    return []
  }
}

if (which === 'books' || which === 'all') await books()
if (which === 'vn' || which === 'all') await vn()
