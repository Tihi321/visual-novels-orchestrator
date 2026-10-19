import { useEffect, useState } from 'react'
import { getStartWithWindows, pickFolder, sendCommand, setStartWithWindows } from '../api'
import { useVn } from '../store/hooks'
import { McpSettings } from './McpSettings'
import { RenpySettings } from './RenpySettings'

/** Provider key variables the engine usually knows. The engine refuses names that are not in providers.md. */
const KEY_NAMES = ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'STRATA_API_KEY']

export function SettingsPage() {
  const settings = useVn((s) => s.settings)
  const secretsSet = useVn((s) => s.secretsSet)
  const dataDir = useVn((s) => s.dataDir)
  const [scriptoriumData, setScriptoriumData] = useState<string | null>(null)
  const [keyName, setKeyName] = useState(KEY_NAMES[0]!)
  const [keyValue, setKeyValue] = useState('')
  const [login, setLogin] = useState<boolean | null>(null)

  useEffect(() => {
    void getStartWithWindows().then(setLogin)
  }, [])
  // filled once, so a snapshot that arrives while you type does not undo it
  useEffect(() => {
    if (settings && scriptoriumData === null) setScriptoriumData(settings.scriptoriumData)
  }, [settings, scriptoriumData])

  const keySet = secretsSet.includes(keyName)
  const saveScriptorium = () => {
    if (settings && scriptoriumData && scriptoriumData.trim() !== settings.scriptoriumData) sendCommand({ type: 'saveSettings', scriptoriumData: scriptoriumData.trim() })
  }
  return (
    <div className="stack" style={{ maxWidth: 640 }} data-testid="page-settings">
      <div className="panel-title">Settings</div>
      <label>VN Studio data folder</label>
      <input value={dataDir} readOnly data-testid="set-dataDir" />
      <div className="dim">Set with --data or the VNO_DATA environment variable. The default is ~/VisualNovels. Restart to change it.</div>
      <label>Scriptorium data folder</label>
      <input
        value={scriptoriumData ?? ''}
        onChange={(e) => setScriptoriumData(e.target.value)}
        onBlur={saveScriptorium}
        onKeyDown={(e) => e.key === 'Enter' && saveScriptorium()}
        placeholder="~/Scriptorium"
        data-testid="set-scriptoriumData"
      />
      <div className="row">
        <button
          onClick={() =>
            void pickFolder('Scriptorium data folder').then((p) => {
              if (p) {
                setScriptoriumData(p)
                sendCommand({ type: 'saveSettings', scriptoriumData: p })
              }
            })
          }
          data-testid="set-scriptoriumData-browse"
        >
          Browse...
        </button>
        <span className="dim">Where the Library looks for books (its books/ folder).</span>
      </div>
      <RenpySettings />
      <hr />
      <McpSettings />
      <hr />
      <div className="dim">Provider API key (stored in the Windows credential store, never in a file)</div>
      <select value={keyName} onChange={(e) => setKeyName(e.target.value)} data-testid="set-key-name">
        {[...new Set([...KEY_NAMES, ...secretsSet])].map((n) => (
          <option key={n} value={n}>
            {n}
            {secretsSet.includes(n) ? ' (set)' : ''}
          </option>
        ))}
      </select>
      <div className="row">
        <input
          type="password"
          autoComplete="off"
          style={{ flex: 1 }}
          value={keyValue}
          placeholder={keySet ? 'Key is set. Type to replace' : 'Paste the key'}
          onChange={(e) => setKeyValue(e.target.value)}
          data-testid="set-key-value"
        />
        <button
          disabled={!keyValue}
          data-testid="set-key-save"
          onClick={() => {
            sendCommand({ type: 'setSecret', name: keyName, value: keyValue })
            setKeyValue('')
          }}
        >
          Store key
        </button>
      </div>
      <hr />
      <label className="row">
        <input type="checkbox" style={{ width: 'auto' }} checked={login === true} disabled={login === null} data-testid="set-login" onChange={(e) => void setStartWithWindows(e.target.checked).then(setLogin)} />
        Start VN Studio with Windows{login === null ? ' (only in the desktop app)' : ''}
      </label>
    </div>
  )
}
