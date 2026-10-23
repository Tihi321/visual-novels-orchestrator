import { useEffect } from 'react'
import type { ProjectDetail } from '../../../shared/protocol'
import type { Lang } from '../../../shared/vn'
import { pickFile, sendCommand, updateSettings } from '../../api'
import { isAudioPath } from '../../lib/assets'
import { ttsChoices } from '../../lib/engines'
import { projectAssetUrl } from '../../lib/urls'
import { langName, toggleLang, ttsWorkflows, vibettsSupport, voiceOptions, voiceProgress, voiceSupport } from '../../lib/voice'
import { useVn } from '../../store/hooks'
import type { VoiceStatusView } from '../../store/vn'
import { Pill, ProgressBar, useRecentError } from '../common'

type Speaker = { key: string; name: string }

export function VoiceTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const voice = detail.settings.voice
  const speakers: Speaker[] = [{ key: 'narrator', name: 'Narrator' }, ...detail.book.characters.map((c) => ({ key: c.key, name: c.name }))]
  const vibe = voice.provider === 'vibetts'
  const flow = voice.provider === 'flow'
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
          <select id="voice-provider" value={voice.provider} disabled={!voice.enabled} onChange={(e) => updateSettings(slug, { voice: { provider: e.target.value as 'vibetts' | 'comfy' | 'flow' } })} data-testid="voice-provider">
            <option value="vibetts">VibeTTS (Kokoro / Supertonic)</option>
            <option value="flow">Google Flow (Gemini voices, free)</option>
            <option value="comfy">ComfyUI workflow</option>
          </select>
        </div>
        <div className="dim" style={{ marginTop: 4 }}>
          {flow
            ? 'Each character has one Gemini voice per edition language (gemini:<Name>), made through flow-music-mcp with a free Google AI Studio key; the language follows the text. Set a voice with vno_voice_set (flow_voices lists them).'
            : vibe
            ? 'Each character has one fixed voice per edition language (Kokoro reads English, Supertonic reads Croatian and 29 more). VibeTTS must be running with its MCP server on.'
            : 'Voices only exist for languages that have an edition. A character without a reference clip uses the narrator’s.'}
        </div>
      </div>
      {flow ? <FlowVoice slug={slug} detail={detail} speakers={speakers} /> : vibe ? <VibeVoice slug={slug} detail={detail} speakers={speakers} /> : <ComfyVoice slug={slug} detail={detail} speakers={speakers} />}
    </div>
  )
}

// ---- Google Flow (Gemini and Windows voices, through flow-music-mcp) ----

function FlowVoice({ slug, detail, speakers }: { slug: string; detail: ProjectDetail; speakers: Speaker[] }) {
  const voice = detail.settings.voice
  const editions = detail.summary.editions
  const langs: Lang[] = voice.langs.length ? voice.langs : [detail.settings.primaryLang]
  const step = useVn((s) => s.progress[slug]?.voice ?? detail.summary.pipeline?.steps.voice)
  const run = voiceProgress(step)
  const errPlan = useRecentError(slug, 'planVoices')
  const errGen = useRecentError(slug, 'generateVoice')
  return (
    <>
      <div className="card" data-testid="voice-flow">
        <h3>Google Flow</h3>
        <div className="dim">flow-music-mcp must be running (hub.ps1 start flow-music-mcp); its status is on the Generators page. Languages need an edition.</div>
        <div className="stack" style={{ marginTop: 6 }}>
          {editions.map((lang) => (
            <label key={lang} className="inline" data-testid={`voice-lang-${lang}`}>
              <input type="checkbox" checked={voice.langs.includes(lang)} disabled={!voice.enabled} onChange={(e) => updateSettings(slug, { voice: { langs: toggleLang(voice.langs, lang, e.target.checked, editions) } })} data-testid={`voice-lang-on-${lang}`} />
              {langName(lang)}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={!voice.enabled} onClick={() => sendCommand({ type: 'planVoices', slug })} data-testid="voice-plan">
            Plan voices
          </button>
          <button className="primary" disabled={!voice.enabled} onClick={() => sendCommand({ type: 'generateVoice', slug })} data-testid="voice-generate">
            Generate voice
          </button>
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
        {!voice.enabled && <div className="dim">Turn voice on to plan voices.</div>}
        {voice.enabled && (
          <div className="stack">
            {speakers.map((s) => (
              <div key={s.key} className="row" data-testid={`voice-speaker-${s.key}`}>
                <b style={{ width: 150 }}>{s.name}</b>
                <span className="dim">{langs.map((l) => `${l.toUpperCase()}: ${voice.voices[s.key]?.[l] ?? '(not planned)'}`).join('   ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ---- VibeTTS ----

function VibeVoice({ slug, detail, speakers }: { slug: string; detail: ProjectDetail; speakers: Speaker[] }) {
  const voice = detail.settings.voice
  const editions = detail.summary.editions
  const status = useVn((s) => s.vibetts)
  const englishEngine = voice.englishEngine ?? 'kokoro'
  const needsSupertonic = (voice.langs.length ? voice.langs : [detail.settings.primaryLang]).some((l) => l !== 'en')
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
          {status?.ok && <span className="dim">{status.voices.length} voice(s)</span>}
        </div>
        {status && !status.ok && (
          <div className="warn" data-testid="vibetts-error" style={{ marginTop: 6 }}>
            {status.error}
          </div>
        )}
        {status?.ok && !status.supertonicInstalled && (
          <div className="warn" data-testid="vibetts-no-supertonic">
            Supertonic is not installed in VibeTTS (Settings &gt; Supertonic, about 400 MB): {needsSupertonic ? 'Croatian and the other languages cannot be spoken until it is.' : 'only English (Kokoro) is available.'}
          </div>
        )}
        <div className="row" style={{ marginTop: 6 }}>
          <label htmlFor="voice-english-engine">English voices</label>
          <select
            id="voice-english-engine"
            value={englishEngine}
            disabled={!voice.enabled}
            onChange={(e) => updateSettings(slug, { voice: { englishEngine: e.target.value as 'kokoro' | 'supertonic' } })}
            data-testid="voice-english-engine"
          >
            <option value="kokoro">Kokoro</option>
            <option value="supertonic">Supertonic</option>
          </select>
          <span className="dim">Other languages always use Supertonic. After a change, plan the voices again.</span>
        </div>
      </div>

      <div className="card" data-testid="voice-langs">
        <h3>Languages</h3>
        <div className="stack">
          {editions.map((lang) => {
            const on = voice.langs.includes(lang)
            const support = vibettsSupport(status, lang, englishEngine)
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
                <Pill tone={support.status === 'ok' ? 'good' : support.status === 'unknown' ? 'dim' : 'warn'} title={support.message} testId={`voice-support-${lang}`}>
                  {support.status === 'ok' ? 'supported' : support.status === 'unknown' ? 'unknown' : 'not supported'}
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
          <span className="dim">Plan assigns a voice per character and language from the bible. Clips of text that did not change are skipped; a stopped run continues where it was.</span>
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
  const langs: Lang[] = voice.langs.length ? voice.langs : [detail.settings.primaryLang]
  const errSet = useRecentError(slug, 'setVoice')
  const errPreview = useRecentError(slug, 'previewVoice')
  const err = errSet ?? errPreview
  return (
    <div className="stack voice-speaker" data-testid={`voice-speaker-${speaker.key}`}>
      {langs.map((lang, i) => (
        <LangVoice key={lang} slug={slug} speaker={speaker} lang={lang} first={i === 0} detail={detail} status={status} />
      ))}
      {err && <div className="bad-text">{err}</div>}
    </div>
  )
}

function LangVoice({ slug, speaker, lang, first, detail, status }: { slug: string; speaker: Speaker; lang: Lang; first: boolean; detail: ProjectDetail; status: VoiceStatusView | null }) {
  const voice = detail.settings.voice
  const preview = useVn((s) => s.voicePreviews[`${slug}:${speaker.key}:${lang}`])
  const current = voice.voices[speaker.key]?.[lang]
  const options = voiceOptions(status, lang, voice.englishEngine ?? 'kokoro', current)
  return (
    <div className="row" data-testid={`voice-row-${speaker.key}-${lang}`}>
      <b style={{ width: 150 }}>{first ? speaker.name : ''}</b>
      <span className="dim" style={{ width: 28 }}>
        {lang.toUpperCase()}
      </span>
      <select value={current ?? ''} onChange={(e) => e.target.value && sendCommand({ type: 'setVoice', slug, speakerKey: speaker.key, lang, voice: e.target.value })} disabled={!status?.ok && !current} data-testid={`voice-select-${speaker.key}-${lang}`}>
        <option value="" disabled>
          {speaker.key === 'narrator' ? '(no voice: plan voices)' : '(narrator’s voice: plan voices)'}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button disabled={!current || !status?.ok} onClick={() => current && sendCommand({ type: 'previewVoice', slug, speakerKey: speaker.key, voice: current, lang })} data-testid={`voice-preview-${speaker.key}-${lang}`}>
        Listen
      </button>
      {preview && isAudioPath(preview.file) && <audio controls preload="none" src={projectAssetUrl(slug, preview.file, preview.rev)} data-testid={`voice-audio-${speaker.key}-${lang}`} />}
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
