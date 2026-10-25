import { useEffect } from 'react'
import { sendCommand } from '../api'
import { langName } from '../lib/voice'
import { useVn } from '../store/hooks'
import { Pill } from './common'

/** One generator app as a status card: reachable or not, what it does for a project, and how to start it. */
function GeneratorCard({ id, name, role, ok, detail, hint }: { id: string; name: string; role: string; ok: boolean | null; detail: string; hint: string }) {
  return (
    <div className="card" data-testid={`gen-${id}`} style={{ minWidth: 220, flex: 1 }}>
      <div className="row spread">
        <b>{name}</b>
        <Pill tone={ok === null ? 'dim' : ok ? 'good' : 'bad'} testId={`gen-${id}-status`}>
          {ok === null ? 'checking' : ok ? 'running' : 'not running'}
        </Pill>
      </div>
      <div className="dim">{role}</div>
      {detail && <div className="dim ellipsis" title={detail}>{detail}</div>}
      {ok === false && (
        <div className="warn" data-testid={`gen-${id}-hint`} style={{ marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

/** A short tag for what an engine makes (`voice` for speech, `effect` for a sound effect). */
const taskLabel = (task: 'music' | 'tts' | 'sfx'): string => (task === 'tts' ? 'voice' : task === 'sfx' ? 'effect' : 'music')

/** The language coverage of an engine, for its row: `any language`, `12 languages`, or null (no language input). */
function languageHint(languages: string[] | '*'): string | null {
  if (languages === '*') return 'any language'
  return languages.length > 0 ? `${languages.length} language${languages.length === 1 ? '' : 's'}` : null
}

export function ComfyPage() {
  const comfy = useVn((s) => s.comfy)
  const voice = useVn((s) => s.voiceStatus)
  const studios = useVn((s) => s.studios)
  const engines = useVn((s) => s.engines)
  const workflows = useVn((s) => s.workflows)
  const freed = useVn((s) => s.freed)
  const connected = useVn((s) => s.connected)
  const refresh = () => {
    sendCommand({ type: 'comfyStatus' })
    sendCommand({ type: 'listEngines' })
    sendCommand({ type: 'listCustomWorkflows' })
    sendCommand({ type: 'voiceStatus' })
    sendCommand({ type: 'studiosStatus' })
  }
  useEffect(() => {
    if (connected) refresh()
  }, [connected])

  const lanes = comfy?.lanes ?? []
  const reachable = lanes.filter((l) => l.reachable).length
  const ready = comfy?.engines.filter((e) => e.ready).length ?? 0
  const pixel = studios?.find((s) => s.id === 'pixel')
  const chiptune = studios?.find((s) => s.id === 'chiptune')
  return (
    <div className="stack" style={{ maxWidth: 960 }} data-testid="page-comfy">
      <div className="row spread">
        <div className="panel-title">Generators</div>
        <div className="row">
          <button onClick={refresh} data-testid="comfy-refresh">
            Refresh
          </button>
          <button onClick={() => sendCommand({ type: 'comfyFree' })} disabled={!reachable} title="Unloads the models from the video memory of every reachable lane" data-testid="comfy-free">
            Free VRAM
          </button>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'stretch', flexWrap: 'wrap' }} data-testid="generators">
        <GeneratorCard
          id="comfy"
          name="ComfyUI"
          role="Images, music, local voices (TTS Audio Suite) and sound effects"
          ok={comfy ? comfy.ok : null}
          detail={comfy ? `${reachable} of ${lanes.length} lanes, ${ready} engines ready` : ''}
          hint="Start ComfyUI (python main.py), then press Refresh. The lanes are in config/comfy.md."
        />
        <GeneratorCard
          id="pixel"
          name="Pixel Studio"
          role="Pixel art: converts images, or draws small sprites"
          ok={pixel ? pixel.ok : null}
          detail={pixel ? (pixel.ok ? `${pixel.tools} tools at ${pixel.url}` : pixel.url) : ''}
          hint={pixel?.error || 'Start it headless: yarn build && yarn mcp in the Pixel Studio folder'}
        />
        <GeneratorCard
          id="chiptune"
          name="Chiptune Studio"
          role="Chip music: calm loops that play seamlessly"
          ok={chiptune ? chiptune.ok : null}
          detail={chiptune ? (chiptune.ok ? `${chiptune.tools} tools at ${chiptune.url}` : chiptune.url) : ''}
          hint={chiptune?.error || 'Start it headless: yarn build && yarn mcp in the Chiptune Studio folder'}
        />
      </div>

      <div className="card" data-testid="comfy-status">
        <h3>ComfyUI status</h3>
        {!comfy && <div className="dim">Asking the engine...</div>}
        {comfy && (
          <div className="stack">
            <div className="row">
              <Pill tone={comfy.ok ? 'good' : 'bad'}>{comfy.ok ? 'ready' : 'not ready'}</Pill>
              <span className="dim">
                {reachable} of {lanes.length} lanes reachable, {ready} of {comfy.engines.length} engines ready
              </span>
            </div>
            {lanes.map((l) => (
              <div className="row lane" key={l.url} data-testid={`lane-${l.url}`}>
                <Pill tone={l.reachable ? 'good' : 'bad'}>{l.reachable ? 'reachable' : 'unreachable'}</Pill>
                <code>{l.url}</code>
                {l.reachable && (
                  <span className="dim">
                    {l.running} running, {l.pending} pending
                  </span>
                )}
                {!l.reachable && l.error && <span className="warn">{l.error}</span>}
              </div>
            ))}
            {!lanes.length && <div className="warn">No ComfyUI lane is set. Add one in config/comfy.md in the data folder.</div>}
            {freed && (
              <div className="dim" data-testid="comfy-freed">
                Free VRAM: {freed.map((f) => `${f.lane} ${f.ok ? 'freed' : `failed${f.error ? ` (${f.error})` : ''}`}`).join('; ') || 'nothing to free'}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" data-testid="comfy-engines">
        <h3>Engines</h3>
        {comfy && (
          <div className="stack">
            {comfy.engines.map((e) => (
              <div className="row" key={`${e.kind}:${e.id}`} data-testid={`engine-${e.id}`}>
                <Pill tone={e.ready ? 'good' : 'warn'}>{e.ready ? 'ready' : 'missing'}</Pill>
                <b>{e.label}</b>
                <Pill tone="dim">{taskLabel(e.task)}</Pill>
                <span className="dim">
                  {e.id} ({e.kind}
                  {engines?.image.concat(engines.audio).find((x) => x.id === e.id)?.edit ? ', editor' : ''})
                </span>
                {languageHint(e.languages) && <span className="dim">{languageHint(e.languages)}</span>}
                {!e.ready && e.missing.length > 0 && <span className="warn ellipsis" title={e.missing.join('\n')}>{e.missing.length} missing: {e.missing.slice(0, 3).join(', ')}{e.missing.length > 3 ? ', ...' : ''}</span>}
              </div>
            ))}
            {!comfy.engines.length && <div className="dim">No engines known.</div>}
          </div>
        )}
        <div className="dim" style={{ marginTop: 6 }}>
          Which engine a book uses is set per project (Book, Look and Voice tabs). There are no global defaults in the engine yet.
        </div>
      </div>

      <div className="card" data-testid="comfy-voices">
        <h3>Local voices</h3>
        {!voice && <div className="dim">Asking the engine...</div>}
        {voice && (
          <div className="stack">
            {!voice.ok && (
              <div className="warn" data-testid="comfy-voices-error">
                {voice.error}
              </div>
            )}
            <div className="row">
              <Pill tone={voice.ok ? 'good' : 'bad'}>{voice.ok ? 'reachable' : 'not reachable'}</Pill>
              <span className="dim">{voice.comfyUrl || 'config/comfy.md'}</span>
              <span className="dim">default engine: {voice.defaultEngine}</span>
            </div>
            {voice.engines.map((e) => (
              <div className="row" key={e.id} data-testid={`comfy-voice-${e.id}`}>
                <Pill tone={e.ready ? 'good' : 'warn'}>{e.ready ? 'ready' : 'missing'}</Pill>
                <b>{e.label}</b>
                <Pill tone="dim">{taskLabel(e.task)}</Pill>
                {languageHint(e.languages) && <span className="dim">{languageHint(e.languages)}</span>}
                {!e.ready && e.missing.length > 0 && (
                  <span className="warn ellipsis" title={e.missing.join('\n')}>
                    {e.missing.slice(0, 3).join(', ')}
                    {e.missing.length > 3 ? ', ...' : ''}
                  </span>
                )}
              </div>
            ))}
            {voice.ok && !voice.engines.length && <div className="dim">No local TTS or sound-effect engine is installed.</div>}
            {voice.workflows.length > 0 && (
              <div className="dim">Custom TTS workflows: {voice.workflows.map((w) => `${w.name} (${w.languages.map(langName).join(', ')})`).join('; ')}</div>
            )}
            <div className="dim">The Voice tab picks the engine per language; the TTS Audio Suite in ComfyUI provides the models.</div>
          </div>
        )}
      </div>

      <div className="card" data-testid="comfy-bgremoval">
        <h3>Background removal</h3>
        {comfy?.backgroundRemoval.available ? (
          <div className="row">
            <Pill tone="good">available</Pill>
            <span className="dim">{comfy.backgroundRemoval.models.length} model file(s): {comfy.backgroundRemoval.models.join(', ')}</span>
          </div>
        ) : (
          <div className="row">
            <Pill tone="warn">no model</Pill>
            <span className="dim">no model in models/background_removal: sprites use flat-background keying</span>
          </div>
        )}
      </div>

      <div className="card" data-testid="comfy-workflows">
        <h3>Custom workflows</h3>
        <div className="stack">
          {workflows.map((w) => (
            <div className="row" key={w.name}>
              <b>{w.name}</b>
              <Pill>{w.kind}</Pill>
              {w.languages.length > 0 && <span className="dim">speaks {w.languages.map(langName).join(', ')}</span>}
            </div>
          ))}
          {!workflows.length && comfy?.customWorkflows.map((n) => <div key={n}>{n}</div>)}
          {!workflows.length && !comfy?.customWorkflows.length && <div className="dim">None. Put a ComfyUI workflow (.json) and its .map.yaml in the data folder&apos;s workflows/ folder.</div>}
        </div>
      </div>
    </div>
  )
}
