import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../shared/protocol'
import { sendCommand } from '../api'
import { useVn } from '../store/hooks'
import { vnStore } from '../store/store'
import { AssetsTab } from './book/AssetsTab'
import { BuildTab } from './book/BuildTab'
import { EditionsTab } from './book/EditionsTab'
import { LookTab } from './book/LookTab'
import { PipelineTab } from './book/PipelineTab'
import { VoiceTab } from './book/VoiceTab'
import { Pill } from './common'

type Tab = 'pipeline' | 'editions' | 'assets' | 'look' | 'voice' | 'build'
const TABS: { id: Tab; label: string }[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'editions', label: 'Editions' },
  { id: 'assets', label: 'Assets' },
  { id: 'look', label: 'Look' },
  { id: 'voice', label: 'Voice' },
  { id: 'build', label: 'Build' }
]

export function BookPage() {
  const slug = useVn((s) => s.currentSlug)
  const projects = useVn((s) => s.projects)
  const connected = useVn((s) => s.connected)
  const detail = useVn((s) => (slug ? s.details[slug] : undefined))
  const updatedAt = useVn((s) => (slug ? s.projects[slug]?.updatedAt : undefined))
  const total = useVn((s) => (slug ? s.projects[slug]?.assets.total : undefined))
  const [tab, setTab] = useState<Tab>('pipeline')

  // load once, then again (at most every second) when the summary changes
  useEffect(() => {
    if (!slug || !connected) return
    const t = setTimeout(() => sendCommand({ type: 'getProject', slug }), detail ? 1000 : 0)
    return () => clearTimeout(t)
  }, [slug, connected, updatedAt]) // `detail` is read, not a trigger
  useEffect(() => {
    if (slug && connected) sendCommand({ type: 'listAssets', slug })
  }, [slug, connected, total])
  useEffect(() => {
    if (connected) {
      sendCommand({ type: 'listThemes' })
      sendCommand({ type: 'listEngines' })
      sendCommand({ type: 'listCustomWorkflows' })
    }
  }, [connected])

  if (!slug) {
    const list = Object.values(projects)
    return (
      <div className="stack" style={{ maxWidth: 720 }} data-testid="page-book">
        <div className="panel-title">Book</div>
        <div className="dim">Pick a project in the Library to open it here.</div>
        {list.map((p) => (
          <button key={p.slug} onClick={() => vnStore.getState().openProject(p.slug)} style={{ textAlign: 'left' }}>
            {p.title}
          </button>
        ))}
      </div>
    )
  }
  const summary = projects[slug]
  return (
    <div className="stack" style={{ maxWidth: 1200 }} data-testid="page-book">
      <div className="row spread">
        <div className="row">
          <button onClick={() => vnStore.getState().setPage('library')}>Library</button>
          <div className="panel-title">{summary?.title ?? slug}</div>
          {summary && <Pill tone={summary.kind === 'choice' ? 'accent' : 'dim'}>{summary.kind}</Pill>}
          {summary && <Pill>{summary.primaryLang.toUpperCase()} primary</Pill>}
        </div>
        <span className="dim">{slug}</span>
      </div>
      <div className="row subtabs" data-testid="book-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {!detail && <div className="dim">Loading the project...</div>}
      {detail && <TabBody tab={tab} slug={slug} detail={detail} />}
    </div>
  )
}

function TabBody({ tab, slug, detail }: { tab: Tab; slug: string; detail: ProjectDetail }) {
  switch (tab) {
    case 'pipeline':
      return <PipelineTab slug={slug} detail={detail} />
    case 'editions':
      return <EditionsTab slug={slug} detail={detail} />
    case 'assets':
      return <AssetsTab slug={slug} detail={detail} />
    case 'look':
      return <LookTab slug={slug} detail={detail} />
    case 'voice':
      return <VoiceTab slug={slug} detail={detail} />
    case 'build':
      return <BuildTab slug={slug} detail={detail} />
  }
}
