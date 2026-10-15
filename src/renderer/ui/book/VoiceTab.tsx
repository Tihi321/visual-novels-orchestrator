import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../../shared/protocol'
import type { Lang } from '../../../shared/vn'
import { VOICE_CATEGORIES, VOICE_VOCAB, buildDescription, parseDescription } from '../../../shared/voice-vocab'
import type { VoiceCategory } from '../../../shared/voice-vocab'
import { pickFile, sendCommand, updateSettings } from '../../api'
import { isAudioPath } from '../../lib/assets'
import { ttsChoices } from '../../lib/engines'
import { projectAssetUrl } from '../../lib/urls'
import { langName, toggleLang, ttsWorkflows, vibettsSupport, voiceOptions, voiceProgress, voiceSupport } from '../../lib/voice'
import { useVn } from '../../store/hooks'
import { Pill, ProgressBar, useRecentError } from '../common'

type Speaker = { key: string; name: string }

export function VoiceTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const voice = detail.settings.voice
  const speakers: Speaker[] = [{ key: 'narrator', name: 'Narrator' }, ...detail.book.characters.map((c) => ({ key: c.key, name: c.name }))]
  const vibe = voice.provider === 'vibetts'
  return (
    <div className="stack" data-testid="tab-voice-body">
      <div className="card">
        <h3>Voice</h3>
        <label className="inline">
          <input type="checkbox" checked={voice.enabled} onChange={(e) => updateSettings(slug, { voice: { enabled: e.target.checked } })} data-testid="voice-enabled" />
          Generate spoken lines (text to speech). Off by default.
        </label>
        <div className="row" style={{ marginTop: 8 }}>
          <label htmlFor="voice-provider">Voice engine</label>
          <select id="voice-provider" value={voice.provider} disabled={!voice.enabled} onChange={(e) => updateSettings(slug, { voice: { provider: e.target.value as 'vibetts' | 'comfy' } })} data-testid="voice-provider">
            <option value="vibetts">VibeTTS (OmniVoice: English and Croatian)</option>
            <option value="comfy">ComfyUI workflow</option>
          </select>
        </div>
        <div className="dim" style={{ marginTop: 4 }}>
          {vibe
            ? 'Voices are designed from a description and the same voice speaks every edition. VibeTTS must be running with its MCP server on.'
            : 'Voices only exist for languages that have an edition. A character without a reference clip uses the narrator’s.'}
        </div>
      </div>
      {vibe ? <VibeVoice slug={slug} detail={detail} speakers={speakers} /> : <ComfyVoice slug={slug} detail={detail} speakers={speakers} />}
    </div>
  )
}

// ---- VibeTTS ----

function VibeVoice({ slug, detail, speakers }: { slug: string; detail: ProjectDetail; speakers: Speaker[] }) {
  const voice = detail.settings.voice
  const editions = detail.summary.editions
  const status = useVn((s) => s.vibetts)
  const step = useVn((s) => s.progress[slug]?.voice ?? detail.summary.pipeline?.steps.voice)
  const run = voiceProgress(step)
  const errPlan = useRecentError(slug, 'planVoices')
  const errGen = useRecentError(slug, 'generateVoice')
  useEffect(() => {
    if (voice.enabled) sendCommand({ type: 'voiceStatus' })
  }, [voice.enabled])
  return (
    <>
      <div className="card" data-testid="voice-vibetts">
        <h3>VibeTTS</h3>
        <div className="row">
          {status === null ? <Pill tone="dim">not checked</Pill> : status.ok ? <Pill tone="good" testId="vibetts-status">reachable</Pill> : <Pill tone="bad" testId="vibetts-status">not reachable</Pill>}
          <span className="dim">{status?.url ?? 'http://127.0.0.1:7723/mcp'}</span>
          <button onClick={() => sendCommand({ type: 'voiceStatus' })} data-testid="vibetts-refresh">
            Check again
          </button>
          {status?.ok && <span className="dim">{status.voices.filter((v) => v.id.startsWith('omni:')).length} voice(s)</span>}
        </div>
        {status && !status.ok && (
          <div className="warn" data-testid="vibetts-error" style={{ marginTop: 6 }}>
            {status.error}
          </div>
        )}
        {status?.ok && !status.omniInstalled && <div className="warn">OmniVoice is not installed in VibeTTS (Settings &gt; OmniVoice): voices cannot be created.</div>}
      </div>

      <div className="card" data-testid="voice-langs">
        <h3>Languages</h3>
        <div className="stack">
          {editions.map((lang) => {
            const on = voice.langs.includes(lang)
            const support = vibettsSupport(lang)
            return (
              <div key={lang} className="row voice-lang" data-testid={`voice-lang-${lang}`}>
                <label className="inline" style={{ width: 120 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!voice.enabled}
                    onChange={(e) => updateSettings(slug, { voice: { langs: toggleLang(voice.langs, lang, e.target.checked, editions) } })}
                    data-testid={`voice-lang-on-${lang}`}
                  />
                  {langName(lang)}
                </label>
                <Pill tone={support.status === 'ok' ? 'good' : 'warn'} title={support.message} testId={`voice-support-${lang}`}>
                  {support.status === 'ok' ? 'supported' : 'not supported'}
                </Pill>
                <span className="dim">{support.message}</span>
                <button disabled={!voice.enabled || !on} onClick={() => sendCommand({ type: 'generateVoice', slug, lang })} data-testid={`voice-gen-${lang}`}>
                  Generate {lang.toUpperCase()}
                </button>
              </div>
            )
          })}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={!voice.enabled} onClick={() => sendCommand({ type: 'planVoices', slug })} data-testid="voice-plan">
            Plan voices
          </button>
          <button className="primary" disabled={!voice.enabled} onClick={() => sendCommand({ type: 'generateVoice', slug })} data-testid="voice-generate">
            Generate voice
          </button>
          <span className="dim">Plan creates a voice per character from the bible. Clips of text that did not change are skipped; a stopped run continues where it was.</span>
        </div>
        {run && (
          <div style={{ marginTop: 6 }} data-testid="voice-progress">
            <div className="dim">{run.text}</div>
            <ProgressBar fraction={run.fraction} />
          </div>
        )}
        {errPlan && <div className="bad-text">{errPlan}</div>}
        {errGen && <div className="bad-text">{errGen}</div>}
      </div>

      <div className="card" data-testid="voice-speakers">
        <h3>Voices</h3>
        {!voice.enabled && <div className="dim">Turn voice on to choose voices.</div>}
        {voice.enabled && (
          <div className="stack">
            {speakers.map((s) => (
              <SpeakerRow key={s.key} slug={slug} speaker={s} detail={detail} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function SpeakerRow({ slug, speaker, detail }: { slug: string; speaker: Speaker; detail: ProjectDetail }) {
  const voice = detail.settings.voice
  const status = useVn((s) => s.vibetts)
  const preview = useVn((s) => s.voicePreviews[`${slug}:${speaker.key}`])
  const errDesign = useRecentError(slug, 'designVoice')
  const errPreview = useRecentError(slug, 'previewVoice')
  const err = errDesign ?? errPreview
  const current = voice.voices[speaker.key]
  const options = voiceOptions(status?.voices ?? [], current)
  const info = status?.voices.find((v) => v.id === current)
  const [open, setOpen] = useState(false)
  const [parts, setParts] = useState<Partial<Record<VoiceCategory, string>>>(() => parseDescription(preview?.description || info?.description || ''))
  const [seed, setSeed] = useState<number>(preview?.seed ?? 1)
  const lang: Lang = detail.settings.primaryLang
  const design = (nextSeed: number) => {
    setSeed(nextSeed)
    sendCommand({ type: 'designVoice', slug, speakerKey: speaker.key, description: buildDescription(parts), seed: nextSeed, lang })
  }
  return (
    <div className="stack voice-speaker" data-testid={`voice-speaker-${speaker.key}`}>
      <div className="row">
        <b style={{ width: 150 }}>{speaker.name}</b>
        <select
          value={current ?? ''}
          onChange={(e) => {
            const next = { ...voice.voices }
            if (e.target.value) next[speaker.key] = e.target.value
            else delete next[speaker.key]
            updateSettings(slug, { voice: { voices: next } })
          }}
          data-testid={`voice-select-${speaker.key}`}
        >
          <option value="">{speaker.key === 'narrator' ? '(no voice: plan or design one)' : '(narrator’s voice)'}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button disabled={!current || !status?.ok} onClick={() => current && sendCommand({ type: 'previewVoice', slug, speakerKey: speaker.key, voice: current, lang })} data-testid={`voice-preview-${speaker.key}`}>
          Listen
        </button>
        <button onClick={() => setOpen(!open)} data-testid={`voice-design-${speaker.key}`}>
          {open ? 'Close' : 'Design voice...'}
        </button>
        {preview && isAudioPath(preview.file) && <audio controls preload="none" src={projectAssetUrl(slug, preview.file, preview.rev)} data-testid={`voice-audio-${speaker.key}`} />}
      </div>
      {info?.description && !open && <div className="dim">{info.description}</div>}
      {open && (
        <div className="row voice-designer" data-testid={`voice-designer-${speaker.key}`}>
          {VOICE_CATEGORIES.map((c) => (
            <label key={c} className="inline">
              {c}
              <select value={parts[c] ?? ''} onChange={(e) => setParts({ ...parts, [c]: e.target.value })} data-testid={`voice-word-${speaker.key}-${c}`}>
                <option value="">(any)</option>
                {VOICE_VOCAB[c].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="inline">
            seed
            <input type="number" min={0} max={2147483647} style={{ width: 100 }} value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} data-testid={`voice-seed-${speaker.key}`} />
          </label>
          <button className="primary" disabled={!status?.ok} onClick={() => design(seed)} data-testid={`voice-create-${speaker.key}`}>
            Create and listen
          </button>
          <button disabled={!status?.ok} onClick={() => design(Math.floor(Math.random() * 1_000_000))} data-testid={`voice-another-${speaker.key}`}>
            Try another
          </button>
        </div>
      )}
      {err && <div className="bad-text">{err}</div>}
    </div>
  )
}

// ---- ComfyUI workflow (the other provider) ----

function ComfyVoice({ slug, detail, speakers }: { slug: string; detail: ProjectDetail; speakers: Speaker[] }) {
  const voice = detail.settings.voice
  const editions = detail.summary.editions
  const workflows = useVn((s) => s.workflows)
  const tts = ttsWorkflows(workflows)
  const error = useRecentError(slug, 'generateVoice')
  return (
    <>
      <div className="card" data-testid="voice-langs">
        <h3>Languages and engines</h3>
        {!tts.length && (
          <div className="warn" data-testid="voice-no-tts">
            No TTS workflow is installed. Add a custom workflow with a language mapping (for example Chatterbox) in the data folder&apos;s workflows/ folder.
          </div>
        )}
        <div className="stack">
          {editions.map((lang) => {
            const on = voice.langs.includes(lang)
            const engine = voice.engines[lang] ?? ''
            const support = voiceSupport(engine, lang, workflows)
            const tone = support.status === 'ok' ? 'good' : support.status === 'no-engine' ? 'dim' : 'warn'
            return (
              <div key={lang} className="row voice-lang" data-testid={`voice-lang-${lang}`}>
                <label className="inline" style={{ width: 120 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!voice.enabled}
                    onChange={(e) => updateSettings(slug, { voice: { langs: toggleLang(voice.langs, lang, e.target.checked, editions) } })}
                    data-testid={`voice-lang-on-${lang}`}
                  />
                  {langName(lang)}
                </label>
                <select
                  value={engine}
                  disabled={!voice.enabled}
                  onChange={(e) => updateSettings(slug, { voice: { engines: { ...voice.engines, [lang]: e.target.value } } })}
                  data-testid={`voice-engine-${lang}`}
                >
                  <option value="">(pick a TTS engine)</option>
                  {ttsChoices(workflows, engine || undefined).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <Pill tone={tone} title={support.message} testId={`voice-support-${lang}`}>
                  {support.status === 'ok' ? 'supported' : support.status === 'unsupported' ? 'not supported' : support.status === 'unknown' ? 'unknown engine' : 'no engine'}
                </Pill>
                <span className={support.status === 'unsupported' ? 'warn' : 'dim'}>{support.message}</span>
                <button disabled={!voice.enabled || !on} onClick={() => sendCommand({ type: 'generateVoice', slug, lang })} data-testid={`voice-gen-${lang}`}>
                  Generate {lang.toUpperCase()}
                </button>
              </div>
            )
          })}
        </div>
        {tts.length > 0 && (
          <div className="dim" style={{ marginTop: 6 }}>
            Installed TTS workflows: {tts.map((w) => `${w.name} (${w.languages.map(langName).join(', ')})`).join('; ')}
            {!tts.some((w) => w.languages.includes('hr')) ? '. Croatian is not supported yet by any of them.' : ''}
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!voice.enabled} onClick={() => sendCommand({ type: 'generateVoice', slug })} data-testid="voice-generate">
            Generate voice
          </button>
          <span className="dim">Clips of text that did not change are skipped.</span>
        </div>
        {error && <div className="bad-text">{error}</div>}
      </div>

      <div className="card" data-testid="voice-refs">
        <h3>Voice references</h3>
        {!voice.enabled && <div className="dim">Turn voice on to give characters reference clips.</div>}
        {voice.enabled && (
          <div className="stack">
            {speakers.map((c) => (
              <VoiceRefRow key={c.key} slug={slug} charKey={c.key} name={c.name} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function VoiceRefRow({ slug, charKey, name }: { slug: string; charKey: string; name: string }) {
  const asset = useVn((s) => s.assets[slug]?.[`voice_${charKey}`])
  const rev = useVn((s) => s.assetRev[`${slug}:voice_${charKey}`] ?? 0)
  const file = asset?.fileRel
  return (
    <div className="row voice-ref" data-testid={`voice-ref-${charKey}`}>
      <b style={{ width: 150 }}>{name}</b>
      {file && isAudioPath(file) ? <audio controls preload="none" src={projectAssetUrl(slug, file, rev)} /> : <span className="dim">no reference clip{charKey === 'narrator' ? '' : ' (uses the narrator’s)'}</span>}
      {asset?.source === 'custom' && <Pill tone="accent">uploaded</Pill>}
      <button
        onClick={() =>
          void pickFile(`Voice reference for ${name}`, 'audio').then((f) => {
            if (f) sendCommand({ type: 'setVoiceRef', slug, charKey, file: f })
          })
        }
        data-testid={`voice-upload-${charKey}`}
      >
        Upload clip...
      </button>
    </div>
  )
}
