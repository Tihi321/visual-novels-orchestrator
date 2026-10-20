import { useEffect, useState } from 'react'
import type { Lang } from '../../shared/vn'
import { languages } from '../../shared/languages'
import { sendCommand } from '../api'
import { langName } from '../lib/voice'
import { useVn } from '../store/hooks'
import { vnStore } from '../store/store'
import { Modal, Pill, useRecentError } from './common'

/** Confirm the language of a book (detected, with the confidence), then import it. */
export function ImportDialog({ source, onClose }: { source: string; onClose(): void }) {
  const preview = useVn((s) => (s.importPreview?.source === source ? s.importPreview : null))
  const lastImported = useVn((s) => s.lastImported)
  const [lang, setLang] = useState<Lang | null>(null)
  const [run, setRun] = useState(true)
  const [busy, setBusy] = useState(false)
  const error = useRecentError(null, busy ? 'importProject' : 'previewImport')

  useEffect(() => {
    vnStore.getState().clearImport()
    sendCommand({ type: 'previewImport', source })
  }, [source])
  useEffect(() => {
    if (preview && lang === null) setLang(preview.detected.lang)
  }, [preview, lang])
  useEffect(() => {
    if (busy && lastImported) {
      vnStore.getState().clearImport()
      onClose()
      vnStore.getState().openProject(lastImported)
    }
  }, [busy, lastImported, onClose])

  const confidence = preview ? Math.round(preview.detected.confidence * 100) : 0
  const lowConfidence = !!preview && preview.detected.confidence < 0.7
  return (
    <Modal title="Import book" onClose={onClose}>
      {!preview && !error && <div className="dim">Reading the book...</div>}
      {!preview && error && <div className="bad-text">{error}</div>}
      {preview && (
        <>
          <div>
            <b>{preview.title}</b> <span className="dim">{preview.slug}</span>
          </div>
          <div className="row">
            <Pill>{preview.format}</Pill>
            <Pill tone={preview.kind === 'choice' ? 'accent' : 'dim'}>{preview.kind}</Pill>
            <span className="dim">
              {preview.chapters} chapters, {preview.characters} characters, {preview.places} places
            </span>
          </div>
          <div className="dim" style={{ wordBreak: 'break-all' }}>
            {preview.path}
          </div>
          <div className="card" data-testid="import-lang">
            <h3>Language of this book</h3>
            <div className="dim">
              Detected: {langName(preview.detected.lang)} ({confidence}% sure){lowConfidence ? '. Not sure: please check it.' : ''}
            </div>
            <div className="row" style={{ marginTop: 6, gap: 16 }}>
              <select value={lang ?? preview.detected.lang} onChange={(e) => setLang(e.target.value)} data-testid="import-lang-select">
                {languages().map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.native} ({l.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
          {preview.uncertain > 0 && <div className="dim">{preview.uncertain} uncertain items will be settled by the script-analyst.</div>}
          {preview.warnings.length > 0 && (
            <details>
              <summary className="warn">{preview.warnings.length} parser warnings</summary>
              <ul className="log-list">
                {preview.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <label className="inline">
            <input type="checkbox" checked={run} onChange={(e) => setRun(e.target.checked)} />
            Start the pipeline after the import
          </label>
          {error && busy && <div className="bad-text">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={onClose}>Cancel</button>
            <button
              className="primary"
              disabled={!lang || busy}
              data-testid="import-confirm"
              onClick={() => {
                setBusy(true)
                sendCommand({ type: 'importProject', source, lang: lang ?? preview.detected.lang, run })
              }}
            >
              {busy ? 'Importing...' : 'Import'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
