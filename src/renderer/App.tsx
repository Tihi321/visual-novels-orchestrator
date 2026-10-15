import { useVn } from './store/hooks'
import { PAGES, vnStore } from './store/store'
import { AgentsPage } from './ui/AgentsPage'
import { BookPage } from './ui/BookPage'
import { ComfyPage } from './ui/ComfyPage'
import { LibraryPage } from './ui/LibraryPage'
import { ModelsPage } from './ui/ModelsPage'
import { SettingsPage } from './ui/SettingsPage'

export function App() {
  const page = useVn((s) => s.page)
  const connected = useVn((s) => s.connected)
  const warning = useVn((s) => s.warnings[s.warnings.length - 1])
  const spend = useVn((s) => s.spend)
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">VN STUDIO</span>
        <nav className="tabs row">
          {PAGES.map((p) => (
            <button key={p.id} className={page === p.id ? 'on' : ''} onClick={() => vnStore.getState().setPage(p.id)} data-testid={`nav-${p.id}`}>
              {p.label}
            </button>
          ))}
        </nav>
        <span className="dim" style={{ marginLeft: 'auto' }}>
          {connected ? `engine connected · spend today $${spend.today.toFixed(2)}` : 'engine not connected'}
        </span>
      </header>
      {warning && <div className="warnbar">{warning}</div>}
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
