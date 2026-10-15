import { useEffect, useState } from 'react'
import type { ProjectDetail, ThemeInfo } from '../../../shared/protocol'
import { updateSettings } from '../../api'
import { editorChoices, generatorChoices, musicChoices } from '../../lib/engines'
import { useVn } from '../../store/hooks'
import { Pill } from '../common'

export function LookTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const settings = detail.settings
  return (
    <div className="stack" data-testid="tab-look-body">
      <ArtCard slug={slug} detail={detail} />
      <ThemeCard slug={slug} theme={settings.theme} resolved={detail.resolvedTheme} />
      <MusicCard slug={slug} detail={detail} />
    </div>
  )
}

function Select({ value, options, onChange, testId }: { value: string; options: { id: string; label: string }[]; onChange(v: string): void; testId?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function ArtCard({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const art = detail.settings.art
  const engines = useVn((s) => s.engines)
  const workflows = useVn((s) => s.workflows)
  const models = useVn((s) => s.models)
  const hasVision = models.some((m) => m.enabled && m.vision)
  const saved = art.stylePrompt ?? ''
  const [stylePrompt, setStylePrompt] = useState(saved)
  useEffect(() => setStylePrompt(saved), [saved])
  const pixel = art.style === 'pixel'
  const palettes = engines?.palettes ?? []
  return (
    <div className="card" data-testid="look-art">
      <h3>Art</h3>
      <div className="form-grid">
        <label className="dim">Style</label>
        <div className="row">
          {(['illustrated', 'pixel'] as const).map((st) => (
            <label key={st} className="inline">
              <input type="radio" name="art-style" checked={art.style === st} onChange={() => updateSettings(slug, { art: { style: st } })} data-testid={`art-style-${st}`} />
              {st}
            </label>
          ))}
        </div>
        {pixel && (
          <>
            <label className="dim">Palette</label>
            <Select
              value={art.palette ?? ''}
              options={[{ id: '', label: 'Default' }, ...palettes.map((p) => ({ id: p, label: p })), ...(art.palette && !palettes.includes(art.palette) ? [{ id: art.palette, label: art.palette }] : [])]}
              onChange={(v) => updateSettings(slug, { art: { palette: v || null } })}
              testId="art-palette"
            />
          </>
        )}
        <label className="dim">Generator engine</label>
        <Select value={art.generator} options={generatorChoices(engines, workflows, art.generator)} onChange={(v) => updateSettings(slug, { art: { generator: v } })} testId="art-generator" />
        <label className="dim">Editor engine</label>
        <Select value={art.editor} options={editorChoices(engines, workflows, art.editor)} onChange={(v) => updateSettings(slug, { art: { editor: v } })} testId="art-editor" />
        <label className="dim">Background removal</label>
        <Select
          value={art.bgRemoval}
          options={[
            { id: 'birefnet', label: 'BiRefNet' },
            { id: 'qwen-edit', label: 'Qwen edit + BiRefNet' },
            { id: 'key', label: 'Flat key' }
          ]}
          onChange={(v) => updateSettings(slug, { art: { bgRemoval: v as 'birefnet' | 'qwen-edit' | 'key' } })}
          testId="art-bg-removal"
        />
        <label className="dim">Style prompt</label>
        <div className="stack">
          <textarea
            rows={3}
            value={stylePrompt}
            placeholder="Empty: the default style for the book's format, genre and art mode."
            onChange={(e) => setStylePrompt(e.target.value)}
            data-testid="art-style-prompt"
          />
          <div className="row">
            <button disabled={stylePrompt === saved} onClick={() => updateSettings(slug, { art: { stylePrompt: stylePrompt.trim() } })} data-testid="art-style-prompt-save">
              Save style prompt
            </button>
            <span className="dim">Used in front of every image prompt, the next time prompts are planned or assets generated.</span>
          </div>
        </div>
        <label className="dim">Art review</label>
        <div className="stack">
          <label className="inline">
            <input type="checkbox" checked={art.review} onChange={(e) => updateSettings(slug, { art: { review: e.target.checked } })} data-testid="art-review" />
            The art-critic reviews every generated image
          </label>
          {art.review && !hasVision && (
            <div className="warn" data-testid="art-review-warn">
              No vision model is enabled, so the art-critic cannot review. Enable one on the Models page (a model with vision), or turn the review off.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MusicCard({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const music = detail.settings.music
  const engines = useVn((s) => s.engines)
  const workflows = useVn((s) => s.workflows)
  const [tracks, setTracks] = useState(String(music.tracks))
  useEffect(() => setTracks(String(music.tracks)), [music.tracks])
  const commit = () => {
    const n = Math.max(0, Math.min(20, Math.round(Number(tracks))))
    if (Number.isFinite(n) && n !== music.tracks) updateSettings(slug, { music: { tracks: n } })
    else setTracks(String(music.tracks))
  }
  return (
    <div className="card" data-testid="look-music">
      <h3>Music</h3>
      <div className="form-grid">
        <label className="dim">Engine</label>
        <Select value={music.engine} options={musicChoices(engines, workflows, music.engine)} onChange={(v) => updateSettings(slug, { music: { engine: v } })} testId="music-engine" />
        <label className="dim">Tracks</label>
        <input type="number" min={0} max={20} style={{ width: 80 }} value={tracks} onChange={(e) => setTracks(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} data-testid="music-tracks" />
      </div>
    </div>
  )
}

function ThemeCard({ slug, theme, resolved }: { slug: string; theme: string | null; resolved: string }) {
  const themes = useVn((s) => s.themes)
  const [hover, setHover] = useState<string | null>(null)
  const shown = themes.find((t) => t.name === (hover ?? theme ?? resolved)) ?? null
  return (
    <div className="card" data-testid="look-theme">
      <h3>Theme</h3>
      <div className="theme-body">
        <div className="stack" style={{ minWidth: 230 }}>
          <button className={theme === null ? 'primary theme-opt' : 'theme-opt'} onClick={() => updateSettings(slug, { theme: null })} onMouseEnter={() => setHover(resolved)} onMouseLeave={() => setHover(null)} data-testid="theme-auto">
            <b>Auto</b> <span className="dim">picks {resolved}</span>
          </button>
          {themes.map((t) => (
            <button
              key={t.name}
              className={theme === t.name ? 'primary theme-opt' : 'theme-opt'}
              onClick={() => updateSettings(slug, { theme: t.name })}
              onMouseEnter={() => setHover(t.name)}
              onMouseLeave={() => setHover(null)}
              data-testid={`theme-${t.name}`}
            >
              <b>{t.label}</b> {t.pixel && <Pill>pixel</Pill>} {t.light && <Pill>light</Pill>}
              <div className="dim">{t.description}</div>
            </button>
          ))}
          {!themes.length && <div className="dim">Loading themes...</div>}
        </div>
        <div>{shown ? <ThemePreview theme={shown} /> : <div className="dim">No preview.</div>}</div>
      </div>
    </div>
  )
}

/** A mock textbox with a name tag and two choices, drawn with the theme's own preview CSS (1920x1080, scaled down). */
function ThemePreview({ theme }: { theme: ThemeInfo }) {
  const scale = 0.28
  return (
    <div data-testid="theme-preview">
      <style>{theme.previewCss}</style>
      <div className="preview-frame" style={{ width: 1920 * scale, height: 1080 * scale }}>
        <div style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
          <div className="vnp-stage">
            <div className="vnp-menu">
              <div className="vnp-choice">Follow the soother</div>
              <div className="vnp-choice">Stay in the garden</div>
            </div>
            <div className="vnp-textbox">
              <div className="vnp-name">Petra</div>
              <div className="vnp-text">Look, the sky is green today! Do you think the clouds are made of fluff?</div>
            </div>
          </div>
        </div>
      </div>
      <div className="dim" style={{ marginTop: 4 }}>
        {theme.label}: {theme.description}
      </div>
    </div>
  )
}
