import { useEffect, useState } from 'react'
import type { CustomWorkflowInfo, ProjectDetail } from '../../../shared/protocol'
import type { Lang } from '../../../shared/vn'
import { pickFile, sendCommand, updateSettings } from '../../api'
import { isAudioPath } from '../../lib/assets'
import { ttsChoices } from '../../lib/engines'
import type { TtsEngineInfo } from '../../lib/engines'
import { projectAssetUrl } from '../../lib/urls'
import { langName, toggleLang, ttsEngineLabel, ttsSupport, voiceProgress } from '../../lib/voice'
import type { TtsEngineState } from '../../lib/voice'
import { useVn } from '../../store/hooks'
import { Pill, ProgressBar, useRecentError } from '../common'

type Speaker = { key: string; name: string }

export function VoiceTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const voice = detail.settings.voice
  const speakers: Speaker[] = [{ key: 'narrator', name: 'Narrator' }, ...detail.book.characters.map((c) => ({ key: c.key, name: c.name }))]
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
          <label htmlFor="voice-provider">Voice provider</label>
          <select
            id="voice-provider"
            value={voice.provider}
            disabled={!voice.enabled}
            onChange={(e) => updateSettings(slug, { voice: { provider: e.target.value as 'comfy' | 'flow' } })}
            data-testid="voice-provider"
          >
            <option value="comfy">ComfyUI (local voices, default)</option>
            <option value="flow">Google Flow (cloud, free tier)</option>
          </select>
        </div>
        <div className="dim" style={{ marginTop: 4 }}>
          {flow
            ? 'Each character has one Gemini voice per edition language (gemini:<Name>), made through flow-music-mcp with a free Google AI Studio key; the language follows the text. Set a voice with vno_voice_set (flow_voices lists them).'
            : 'Each language speaks with a local ComfyUI TTS engine (the TTS Audio Suite: OmniVoice by default, Higgs Audio v3 and others). ComfyUI must be running with that suite installed; the clips never leave this machine.'}
        </div>
      </div>
      {flow ? <FlowVoice slug={slug} detail={detail} speakers={speakers} /> : <LocalVoice slug={slug} detail={detail} speakers={speakers} />}
    </div>
  )
}

// ---- local ComfyUI voices (the TTS Audio Suite) ----

function LocalVoice({ slug, detail, speakers }: { slug: string; detail: ProjectDetail; speakers: Speaker[] }) {
  const voice = detail.settings.voice
  const editions = detail.summary.editions
  const status = useVn((s) => s.voiceStatus)
  const engines = useVn((s) => s.engines)
  const workflows = useVn((s) => s.workflows)
  const step = useVn((s) => s.progress[slug]?.voice ?? detail.summary.pipeline?.steps.voice)
  const run = voiceProgress(step)
  const errPlan = useRecentError(slug, 'planVoices')
  const errGen = useRecentError(slug, 'generateVoice')
  // the engine list for the pickers: the voice status carries readiness, listEngines the same ids before it answers
  const choices = status?.engines ?? engines?.audio ?? null
  // only voiceStatus says whether a TTS engine's nodes are installed
  const ttsEngines: readonly TtsEngineState[] | null = status?.engines ?? null
  const defaultEngine = ttsEngines?.find((e) => e.id === voice.engine)
  const ttsReady = (ttsEngines ?? []).some((e) => e.task === 'tts' && e.ready) || workflows.some((w) => w.kind === 'audio' && w.languages.length > 0)
  useEffect(() => {
    sendCommand({ type: 'voiceStatus' })
    sendCommand({ type: 'listEngines' })
    sendCommand({ type: 'listCustomWorkflows' })
  }, [voice.enabled])
  return (
    <>
      <div className="card" data-testid="voice-langs">
        <h3>Languages and engines</h3>
        {status && !status.ok && (
          <div className="warn" data-testid="voice-status-error" style={{ marginBottom: 6 }}>
            {status.error}
          </div>
        )}
        {status?.ok && !ttsReady && (
          <div className="warn" data-testid="voice-no-tts" style={{ marginBottom: 6 }}>
            No local voice engine is ready: install the TTS Audio Suite (OmniVoice, Higgs Audio v3 ...) in ComfyUI, or add a custom TTS workflow in the data folder&apos;s workflows/ folder.
          </div>
        )}
        {defaultEngine && !defaultEngine.ready && (
          <div className="warn" data-testid="voice-engine-missing" style={{ marginBottom: 6 }}>
            {defaultEngine.label}: {defaultEngine.missing.length ? defaultEngine.missing.join(', ') : 'the ComfyUI nodes are missing'}. Install the TTS Audio Suite, or pick another engine.
          </div>
        )}
        <div className="row">
          <label htmlFor="voice-default-engine">Default engine</label>
          <select
            id="voice-default-engine"
            value={voice.engine}
            disabled={!voice.enabled}
            onChange={(e) => updateSettings(slug, { voice: { engine: e.target.value } })}
            data-testid="voice-default-engine"
          >
            {ttsChoices(choices, workflows, voice.engine).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="dim">Every language without its own engine uses it. OmniVoice and Higgs Audio v3 read Croatian.</span>
        </div>
        <div className="stack" style={{ marginTop: 8 }}>
          {editions.map((lang) => (
            <LocalLangRow key={lang} slug={slug} lang={lang} detail={detail} choices={choices} ttsEngines={ttsEngines} workflows={workflows} />
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={!voice.enabled} onClick={() => sendCommand({ type: 'planVoices', slug })} data-testid="voice-plan">
            Plan voices
          </button>
          <button className="primary" disabled={!voice.enabled} onClick={() => sendCommand({ type: 'generateVoice', slug })} data-testid="voice-generate">
            Generate voice
          </button>
          <button disabled={!voice.enabled} onClick={() => sendCommand({ type: 'generateVoice', slug, force: true })} data-testid="voice-regenerate">
            Regenerate all
          </button>
        </div>
        <div className="dim" style={{ marginTop: 4 }}>
          Plan assigns a delivery style and a fitting engine per language from the bible. Clips of text that did not change are skipped; Regenerate makes them again.
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
        {!voice.enabled && <div className="dim">Turn voice on to give characters a reference clip, a style and a transcript.</div>}
        {voice.enabled && (
          <div className="stack">
            {speakers.map((s) => (
              <LocalSpeaker key={s.key} slug={slug} speaker={s} detail={detail} ttsEngines={ttsEngines} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function LocalLangRow({
  slug,
  lang,
  detail,
  choices,
  ttsEngines,
  workflows
}: {
  slug: string
  lang: Lang
  detail: ProjectDetail
  choices: readonly TtsEngineInfo[] | null
  ttsEngines: readonly TtsEngineState[] | null
  workflows: readonly CustomWorkflowInfo[]
}) {
  const voice = detail.settings.voice
  const editions = detail.summary.editions
  const on = voice.langs.includes(lang)
  const override = voice.engines[lang] ?? ''
  const resolved = override || voice.engine
  const info = ttsEngines?.find((e) => e.id === resolved)
  const support = ttsSupport(resolved, lang, ttsEngines, workflows)
  const tone = support.status === 'ok' ? (info && !info.ready ? 'warn' : 'good') : support.status === 'unknown' ? 'dim' : 'warn'
  const setEngine = (engineId: string) => {
    const next = { ...voice.engines }
    if (engineId) next[lang] = engineId
    else delete next[lang]
    updateSettings(slug, { voice: { engines: next } })
  }
  return (
    <div className="row voice-lang" data-testid={`voice-lang-${lang}`}>
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
      <select value={override} disabled={!voice.enabled} onChange={(e) => setEngine(e.target.value)} data-testid={`voice-engine-${lang}`}>
        <option value="">(default: {ttsEngineLabel(choices, voice.engine)})</option>
        {ttsChoices(choices, workflows, override || undefined).map((c) => (
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
      <button disabled={!voice.enabled || !on} onClick={() => sendCommand({ type: 'generateVoice', slug, lang, force: true })} data-testid={`voice-regen-${lang}`}>
        Regenerate {lang.toUpperCase()}
      </button>
    </div>
  )
}

function LocalSpeaker({ slug, speaker, detail, ttsEngines }: { slug: string; speaker: Speaker; detail: ProjectDetail; ttsEngines: readonly TtsEngineState[] | null }) {
  const voice = detail.settings.voice
  const langs: Lang[] = voice.langs.length ? voice.langs : [detail.settings.primaryLang]
  const asset = useVn((s) => s.assets[slug]?.[`voice_${speaker.key}`])
  const rev = useVn((s) => s.assetRev[`${slug}:voice_${speaker.key}`] ?? 0)
  const file = asset?.fileRel
  const savedStyle = voice.styles[speaker.key] ?? ''
  const savedText = voice.refTexts[speaker.key] ?? ''
  const [style, setStyle] = useState(savedStyle)
  const [refText, setRefText] = useState(savedText)
  useEffect(() => setStyle(savedStyle), [savedStyle])
  useEffect(() => setRefText(savedText), [savedText])
  const saveStyle = () => {
    if (style !== savedStyle) updateSettings(slug, { voice: { styles: { ...voice.styles, [speaker.key]: style } } })
  }
  const saveRefText = () => {
    if (refText !== savedText) updateSettings(slug, { voice: { refTexts: { ...voice.refTexts, [speaker.key]: refText } } })
  }
  const errRef = useRecentError(slug, 'setVoiceRef')
  const errPreview = useRecentError(slug, 'previewVoice')
  return (
    <div className="stack voice-speaker" data-testid={`voice-speaker-${speaker.key}`}>
      <div className="row">
        <b style={{ width: 150 }}>{speaker.name}</b>
        <input
          style={{ flex: 1, minWidth: 200 }}
          value={style}
          placeholder="Delivery style (for example: warm, slow, cheerful)"
          onChange={(e) => setStyle(e.target.value)}
          onBlur={saveStyle}
          onKeyDown={(e) => e.key === 'Enter' && saveStyle()}
          data-testid={`voice-style-${speaker.key}`}
        />
      </div>
      <div className="row" data-testid={`voice-ref-${speaker.key}`}>
        <span className="dim" style={{ width: 150 }}>
          Reference clip
        </span>
        {file && isAudioPath(file) ? (
          <audio controls preload="none" src={projectAssetUrl(slug, file, rev)} data-testid={`voice-ref-audio-${speaker.key}`} />
        ) : (
          <span className="dim">none{speaker.key === 'narrator' ? '' : ' (the narrator’s clip is used instead)'}</span>
        )}
        {asset?.source === 'custom' && <Pill tone="accent">uploaded</Pill>}
        <button
          onClick={() =>
            void pickFile(`Voice reference for ${speaker.name}`, 'audio').then((f) => {
              if (f) sendCommand({ type: 'setVoiceRef', slug, charKey: speaker.key, file: f })
            })
          }
          data-testid={`voice-upload-${speaker.key}`}
        >
          Upload clip...
        </button>
      </div>
      <div className="row">
        <span className="dim" style={{ width: 150 }}>
          Transcript
        </span>
        <input
          style={{ flex: 1, minWidth: 200 }}
          value={refText}
          placeholder="The words spoken in the reference clip"
          onChange={(e) => setRefText(e.target.value)}
          onBlur={saveRefText}
          onKeyDown={(e) => e.key === 'Enter' && saveRefText()}
          data-testid={`voice-reftext-${speaker.key}`}
        />
        <span className="dim">Cloning needs it: F5-TTS requires it, OmniVoice and Qwen3-TTS match the voice better with it.</span>
      </div>
      <div className="stack">
        {langs.map((lang) => (
          <SpeakerLangRow key={lang} slug={slug} speaker={speaker} lang={lang} detail={detail} ttsEngines={ttsEngines} />
        ))}
      </div>
      {errRef && <div className="bad-text">{errRef}</div>}
      {errPreview && <div className="bad-text">{errPreview}</div>}
    </div>
  )
}

function SpeakerLangRow({ slug, speaker, lang, detail, ttsEngines }: { slug: string; speaker: Speaker; lang: Lang; detail: ProjectDetail; ttsEngines: readonly TtsEngineState[] | null }) {
  const voice = detail.settings.voice
  const preview = useVn((s) => s.voicePreviews[`${slug}:${speaker.key}:${lang}`])
  const effective = voice.engines[lang] ?? voice.engine
  return (
    <div className="row" data-testid={`voice-row-${speaker.key}-${lang}`}>
      <span className="dim" style={{ width: 28 }}>
        {lang.toUpperCase()}
      </span>
      <span className="dim" style={{ minWidth: 180 }}>
        {ttsEngineLabel(ttsEngines, effective)}
      </span>
      <button onClick={() => sendCommand({ type: 'previewVoice', slug, speakerKey: speaker.key, lang })} data-testid={`voice-preview-${speaker.key}-${lang}`}>
        Listen
      </button>
      <button onClick={() => sendCommand({ type: 'generateVoice', slug, lang, force: true, speakerKey: speaker.key })} data-testid={`voice-regen-${speaker.key}-${lang}`}>
        Regenerate
      </button>
      {preview && isAudioPath(preview.file) && <audio controls preload="none" src={projectAssetUrl(slug, preview.file, preview.rev)} data-testid={`voice-audio-${speaker.key}-${lang}`} />}
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
              <input
                type="checkbox"
                checked={voice.langs.includes(lang)}
                disabled={!voice.enabled}
                onChange={(e) => updateSettings(slug, { voice: { langs: toggleLang(voice.langs, lang, e.target.checked, editions) } })}
                data-testid={`voice-lang-on-${lang}`}
              />
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
              <div key={s.key} className="stack voice-speaker" data-testid={`voice-speaker-${s.key}`}>
                {langs.map((lang, i) => (
                  <FlowLangRow key={lang} slug={slug} speaker={s} lang={lang} first={i === 0} detail={detail} />
                ))}
                {voice.styles[s.key] && <span className="dim">Style: {voice.styles[s.key]}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function FlowLangRow({ slug, speaker, lang, first, detail }: { slug: string; speaker: Speaker; lang: Lang; first: boolean; detail: ProjectDetail }) {
  const voice = detail.settings.voice
  const preview = useVn((s) => s.voicePreviews[`${slug}:${speaker.key}:${lang}`])
  const current = voice.voices[speaker.key]?.[lang]
  const [voiceId, setVoiceId] = useState(current ?? '')
  useEffect(() => setVoiceId(current ?? ''), [current])
  const err = useRecentError(slug, 'setVoice') ?? useRecentError(slug, 'previewVoice')
  return (
    <div className="row" data-testid={`voice-row-${speaker.key}-${lang}`}>
      <b style={{ width: 150 }}>{first ? speaker.name : ''}</b>
      <span className="dim" style={{ width: 28 }}>
        {lang.toUpperCase()}
      </span>
      <input
        style={{ flex: 1, minWidth: 160 }}
        value={voiceId}
        placeholder={speaker.key === 'narrator' ? 'gemini:<Name> (no voice: plan voices)' : 'gemini:<Name> (narrator’s voice when empty)'}
        onChange={(e) => setVoiceId(e.target.value)}
        onBlur={() => voiceId.trim() && voiceId !== current && sendCommand({ type: 'setVoice', slug, speakerKey: speaker.key, lang, voice: voiceId.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && voiceId.trim() && voiceId !== current && sendCommand({ type: 'setVoice', slug, speakerKey: speaker.key, lang, voice: voiceId.trim() })}
        data-testid={`voice-select-${speaker.key}-${lang}`}
      />
      <button disabled={!current} onClick={() => current && sendCommand({ type: 'previewVoice', slug, speakerKey: speaker.key, voice: current, lang })} data-testid={`voice-preview-${speaker.key}-${lang}`}>
        Listen
      </button>
      {preview && isAudioPath(preview.file) && <audio controls preload="none" src={projectAssetUrl(slug, preview.file, preview.rev)} data-testid={`voice-audio-${speaker.key}-${lang}`} />}
      {err && <div className="bad-text">{err}</div>}
    </div>
  )
}
