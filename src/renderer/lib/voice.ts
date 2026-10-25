import { languageInfo } from '../../shared/languages'
import type { CustomWorkflowInfo } from '../../shared/protocol'

/** The English name of a language code (the built-in table; a code it does not know is shown as is). */
export function langName(code: string): string {
  return languageInfo(code)?.name ?? code
}

/** The workflow name of an engine id like `custom:chatterbox-multilingual`, else null (a built-in engine). */
export function workflowNameOf(engineId: string | undefined | null): string | null {
  return engineId?.startsWith('custom:') ? engineId.slice('custom:'.length) : null
}

/** The custom workflows that can speak: audio workflows that declare languages (the others make music). */
export function ttsWorkflows(workflows: readonly CustomWorkflowInfo[]): CustomWorkflowInfo[] {
  return workflows.filter((w) => w.kind === 'audio' && w.languages.length > 0)
}

export interface VoiceSupport {
  status: 'ok' | 'unsupported' | 'no-engine' | 'unknown'
  /** Languages the engine reads: the workflow's declared ones, or the built-in engine's codes (empty for `'*'`). */
  supported: string[]
  message: string
}

/** Whether the engine picked for a language can speak it. Mirrors the engine, which skips an undeclared language. */
export function voiceSupport(engineId: string | undefined | null, lang: string, workflows: readonly CustomWorkflowInfo[]): VoiceSupport {
  if (!engineId) return { status: 'no-engine', supported: [], message: `Pick a TTS engine for ${langName(lang)}.` }
  const name = workflowNameOf(engineId)
  const wf = name ? workflows.find((w) => w.name === name && w.kind === 'audio') : undefined
  if (!wf) return { status: 'unknown', supported: [], message: `Engine "${engineId}" is not a known TTS workflow.` }
  const supported = wf.languages
  if (supported.length === 0) return { status: 'ok', supported, message: `"${wf.name}" does not declare languages.` }
  if (!supported.includes(lang)) {
    const list = supported.map(langName).join(', ')
    const extra = lang === 'hr' ? ' Croatian is not supported yet: the clips for it are skipped.' : ''
    return { status: 'unsupported', supported, message: `"${wf.name}" supports ${list}, not ${langName(lang)}.${extra}` }
  }
  return { status: 'ok', supported, message: `"${wf.name}" supports ${supported.map(langName).join(', ')}.` }
}

/** One local voice engine as `voiceStatus` lists it (`VoiceEngineView` has the rest: readiness and missing files). */
export interface TtsEngineState {
  id: string
  label: string
  task: string
  /** The codes it reads, `'*'` for any language. */
  languages: string[] | '*'
  ready: boolean
  missing: string[]
}

/** True when a local voice engine reads a language (`'*'` reads every one). */
export function engineReadsLang(engine: Pick<TtsEngineState, 'languages'>, lang: string): boolean {
  return engine.languages === '*' || engine.languages.includes(lang)
}

/** The list of languages an engine reads, for a message: `any language`, `no language`, or the mapped names. */
function languageListOf(engine: Pick<TtsEngineState, 'languages'>): string {
  if (engine.languages === '*') return 'any language'
  return engine.languages.length ? engine.languages.map(langName).join(', ') : 'no language'
}

/**
 * Whether a local TTS engine (a built-in id, or `custom:<workflow>`) can speak a language, for the Voice tab's per-language row.
 *
 * - A `custom:` id is answered by `voiceSupport` (the workflow's declared languages).
 * - An absent engine id is `no-engine`; an id the list does not know (or the list was never checked) is `unknown`.
 * - An engine that does not read the language is `unsupported` with its codes.
 * - An engine that reads the language but whose ComfyUI nodes are missing stays `ok` (the language is supported), with a warning
 *   message naming the missing nodes: the job would fail, so the Voice tab shows the message next to the supported Pill.
 */
export function ttsSupport(engineId: string | undefined, lang: string, engines: readonly TtsEngineState[] | null, workflows: readonly CustomWorkflowInfo[]): VoiceSupport {
  if (!engineId) return { status: 'no-engine', supported: [], message: `Pick a local TTS engine for ${langName(lang)}.` }
  if (workflowNameOf(engineId)) return voiceSupport(engineId, lang, workflows)
  const engine = engines?.find((e) => e.id === engineId)
  if (!engine) {
    const message =
      engines && engines.length > 0
        ? `Engine "${engineId}" is not an installed local voice engine.`
        : 'The local voice engines could not be checked yet: start ComfyUI with the TTS Audio Suite, then refresh.'
    return { status: 'unknown', supported: [], message }
  }
  if (engine.task !== 'tts') return { status: 'unsupported', supported: [], message: `"${engine.label}" makes sound effects, not speech.` }
  const supported = engine.languages === '*' ? [] : engine.languages
  if (!engineReadsLang(engine, lang)) {
    const extra = lang === 'hr' ? ' Croatian works with OmniVoice (600+ languages) and Higgs Audio v3 (100+).' : ''
    return { status: 'unsupported', supported, message: `"${engine.label}" reads ${languageListOf(engine)}, not ${langName(lang)}.${extra}` }
  }
  if (!engine.ready) {
    const missing = engine.missing.length ? engine.missing.join(', ') : 'the TTS Audio Suite nodes'
    return {
      status: 'ok',
      supported,
      message: `"${engine.label}" reads ${langName(lang)}, but its ComfyUI nodes are missing (${missing}): install the TTS Audio Suite in ComfyUI, or pick another voice engine.`
    }
  }
  return {
    status: 'ok',
    supported,
    message: engine.languages === '*' ? `"${engine.label}" reads any language, ${langName(lang)} included.` : `"${engine.label}" reads ${langName(lang)}.`
  }
}

/** The label of a local voice engine id: the workflow name for `custom:<name>`, else the engine's label, else the id. */
export function ttsEngineLabel(engines: readonly { id: string; label: string }[] | null, id: string): string {
  const workflow = workflowNameOf(id)
  if (workflow) return `custom: ${workflow}`
  return engines?.find((e) => e.id === id)?.label ?? id
}

/** The voice languages that are allowed: only languages that have an edition. */
export function voiceLangChoices(editions: readonly string[]): string[] {
  return [...new Set(editions)]
}

/** A language list to save: the chosen language added or removed, in the order of the editions. */
export function toggleLang<L extends string>(current: readonly L[], lang: L, on: boolean, editions: readonly L[]): L[] {
  const set = new Set(current)
  if (on) set.add(lang)
  else set.delete(lang)
  return editions.filter((l) => set.has(l))
}

/** The message shown for a voice job step (`voice ... 12/40 clips`) and its fraction. */
export function voiceProgress(step: { status: string; message: string; done?: number; total?: number } | undefined): { text: string; fraction: number | null } | null {
  if (!step || step.status !== 'running') return null
  const fraction = step.total ? Math.min(1, (step.done ?? 0) / step.total) : null
  return { text: step.message, fraction }
}
