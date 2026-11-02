import { useVn } from './store/hooks'
import { PAGES, vnStore } from './store/store'
import { AgentsPage } from './ui/AgentsPage'
import { BookPage } from './ui/BookPage'
import { ComfyPage } from './ui/ComfyPage'
import { LibraryPage } from './ui/LibraryPage'
import { ModelsPage } from './ui/ModelsPage'
import { SettingsPage } from './ui/SettingsPage'
import { WarnStrip } from './ui/WarnStrip'

export function App() {
  const page = useVn((s) => s.page)
  const connected = useVn((s) => s.connected)
  const warning = useVn((s) => s.warnings[s.warnings.length - 1])
  const spend = useVn((s) => s.spend)
  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead-brand">VN Studio</span>
        <nav className="masthead-nav">
          {PAGES.map((p) => (
            <button key={p.id} className={page === p.id ? 'on' : ''} onClick={() => vnStore.getState().setPage(p.id)} data-testid={`nav-${p.id}`}>
              {p.label}
            </button>
          ))}
        </nav>
        <span className="masthead-status">
          <span>
            <span className={`masthead-dot${connected ? ' on' : ''}`} aria-hidden="true" />
            {connected ? 'engine connected' : 'engine not connected'}
          </span>
          {connected && <span>Spend today ${spend.today.toFixed(2)}</span>}
        </span>
      </header>
      <WarnStrip text={warning} />
      <main className="page">
        {page === 'library' && <LibraryPage />}
        {page === 'book' && <BookPage />}
        {page === 'models' && <ModelsPage />}
        {page === 'agents' && <AgentsPage />}
        {page === 'comfy' && <ComfyPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
