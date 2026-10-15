import { useEffect, useMemo, useState } from 'react'
import type { ProjectDetail } from '../../../shared/protocol'
import { LANGS, type Lang } from '../../../shared/vn'
import { sendCommand } from '../../api'
import { beatIndex, textBeats } from '../../lib/book'
import { langName } from '../../lib/voice'
import { useVn } from '../../store/hooks'
import { PathField, Pill, useRecentError } from '../common'

export function EditionsTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const primary = detail.summary.primaryLang
  const editions = detail.summary.editions
  const others = editions.filter((l) => l !== primary)
  const [lang, setLang] = useState<Lang | null>(others[0] ?? null)
  const editionKey = editions.join(',')
  useEffect(() => {
    if (!lang || !editionKey.split(',').includes(lang)) setLang(editionKey.split(',').find((l) => l !== primary) as Lang | undefined ?? null)
  }, [editionKey, lang, primary])

  return (
    <div className="stack" data-testid="tab-editions-body">
      <div className="card">
        <h3>Editions</h3>
        <div className="row">
          <Pill tone="good">{langName(primary)} (primary)</Pill>
          {others.map((l) => (
            <button key={l} className={lang === l ? 'primary' : ''} onClick={() => setLang(l)} data-testid={`edition-${l}`}>
              {langName(l)}
            </button>
          ))}
          {!others.length && <span className="dim">No translated edition yet.</span>}
        </div>
        <div className="dim" style={{ marginTop: 6 }}>
          Every edition reuses all the assets (backgrounds, sprites, music): only the text differs. There is no machine translation: an edition is a translated book folder.
        </div>
      </div>
      <AddEdition slug={slug} primary={primary} editions={editions} />
      {lang && <EditionDetail slug={slug} lang={lang} detail={detail} />}
    </div>
  )
}

function AddEdition({ slug, primary, editions }: { slug: string; primary: Lang; editions: Lang[] }) {
  const choices = LANGS.filter((l) => l !== primary)
  const [folder, setFolder] = useState('')
  const [lang, setLang] = useState<Lang>(choices[0] ?? 'hr')
  const error = useRecentError(slug, 'addEdition')
  const [sent, setSent] = useState(false)
  return (
    <div className="card" data-testid="add-edition">
      <h3>Add translated edition</h3>
      <div className="stack">
        <PathField value={folder} onChange={setFolder} mode="folder" placeholder="The translated book folder" testId="edition-folder" />
        <div className="row">
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} data-testid="edition-lang">
            {choices.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
                {editions.includes(l) ? ' (replace)' : ''}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!folder.trim() || !choices.length}
            data-testid="edition-add"
            onClick={() => {
              sendCommand({ type: 'addEdition', slug, source: folder.trim(), lang })
              setSent(true)
            }}
          >
            Add edition
          </button>
          {sent && !error && <span className="dim">Queued. The alignment report appears when the job is done.</span>}
        </div>
        {error && <div className="bad-text">{error}</div>}
      </div>
    </div>
  )
}

function EditionDetail({ slug, lang, detail }: { slug: string; lang: Lang; detail: ProjectDetail }) {
  const edition = useVn((s) => s.editions[slug]?.[lang])
  const report = useVn((s) => s.alignReports[slug]?.[lang])
  const at = useVn((s) => s.projects[slug]?.updatedAt)
  useEffect(() => {
    sendCommand({ type: 'getEdition', slug, lang })
    sendCommand({ type: 'getAlignReport', slug, lang })
  }, [slug, lang, at])
  const index = useMemo(() => beatIndex(detail.book), [detail.book])

  return (
    <div className="stack">
      <div className="card" data-testid="align-report">
        <h3>Alignment report: {langName(lang)}</h3>
        {report === undefined && <div className="dim">Loading...</div>}
        {report === null && <div className="dim">No report for this edition (it was added without alignment problems, or it is still being aligned).</div>}
        {report && (
          <div className="stack">
            <div className="row">
              <Pill tone="good">{report.matched} matched</Pill>
              <Pill tone={report.missing.length ? 'bad' : 'good'} testId="align-missing">
                {report.missing.length} missing
              </Pill>
              <Pill tone={report.extra.length ? 'warn' : 'good'}>{report.extra.length} extra</Pill>
            </div>
            {report.warnings.map((w, i) => (
              <div className="warn" key={i}>
                {w}
              </div>
            ))}
            {report.missing.length > 0 && (
              <div className="stack">
                <div className="dim">Missing beats: the primary text has no translation here. Type it in.</div>
                {report.missing.slice(0, 40).map((id) => (
                  <BeatEditor key={id} slug={slug} lang={lang} beatId={id} primary={index.get(id)?.text ?? ''} speaker={index.get(id)?.speaker ?? null} current={edition?.beats[id] ?? ''} />
                ))}
                {report.missing.length > 40 && <div className="dim">{report.missing.length - 40} more not shown.</div>}
              </div>
            )}
            {report.extra.length > 0 && (
              <details>
                <summary className="warn">Extra texts ({report.extra.length}): translated text with no beat</summary>
                <ul className="log-list">
                  {report.extra.slice(0, 40).map((x, i) => (
                    <li key={i}>
                      ch {x.chapter} scene {x.scene}: {x.text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {(Object.keys(report.nameMap).length > 0 || Object.keys(report.placeMap).length > 0) && (
              <details>
                <summary className="dim">Names and places matched</summary>
                <ul className="log-list">
                  {Object.entries({ ...report.nameMap, ...report.placeMap }).map(([a, b]) => (
                    <li key={a}>
                      {a} = {b}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
      {edition && <BeatBrowser slug={slug} lang={lang} detail={detail} edition={edition.beats} />}
    </div>
  )
}

/** Any chapter's beats with their translation, to fix a text. */
function BeatBrowser({ slug, lang, detail, edition }: { slug: string; lang: Lang; detail: ProjectDetail; edition: Record<string, string> }) {
  const [chapter, setChapter] = useState<number | null>(null)
  const beats = useMemo(() => (chapter === null ? [] : textBeats({ chapters: detail.book.chapters.filter((c) => c.n === chapter) })), [chapter, detail.book])
  return (
    <div className="card" data-testid="beat-browser">
      <h3>Edit beats of the {langName(lang)} edition</h3>
      <select value={chapter ?? ''} onChange={(e) => setChapter(e.target.value ? Number(e.target.value) : null)} data-testid="beat-chapter">
        <option value="">Pick a chapter...</option>
        {detail.book.chapters.map((c) => (
          <option key={c.n} value={c.n}>
            {c.n}. {c.title}
          </option>
        ))}
      </select>
      <div className="stack" style={{ marginTop: 6 }}>
        {beats.slice(0, 80).map((b) => (
          <BeatEditor key={b.id} slug={slug} lang={lang} beatId={b.id} primary={b.text} speaker={b.speaker} current={edition[b.id] ?? ''} />
        ))}
        {beats.length > 80 && <div className="dim">{beats.length - 80} more beats in this chapter are not shown.</div>}
      </div>
    </div>
  )
}

function BeatEditor({ slug, lang, beatId, primary, speaker, current }: { slug: string; lang: Lang; beatId: string; primary: string; speaker: string | null; current: string }) {
  const [text, setText] = useState(current)
  useEffect(() => setText(current), [current])
  const dirty = text !== current
  return (
    <div className="beat-edit" data-testid={`beat-${beatId}`}>
      <div className="dim">
        {beatId}
        {speaker ? ` ${speaker}:` : ''} {primary}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <textarea style={{ flex: 1 }} rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="primary" disabled={!dirty || !text.trim()} onClick={() => sendCommand({ type: 'updateEditionBeat', slug, lang, beatId, text })}>
          Save
        </button>
      </div>
    </div>
  )
}
