import type { CustomWorkflowInfo } from '../../shared/protocol'

export const LANG_NAMES: Record<string, string> = { en: 'English', hr: 'Croatian' }

export function langName(code: string): string {
  return LANG_NAMES[code] ?? code
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
  /** Languages the workflow declares. */
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

/** The languages VibeTTS (OmniVoice) speaks. */
export const VIBETTS_LANGS = ['en', 'hr'] as const

/** What the Voice tab says about a language for the VibeTTS provider (Croatian works: only the ComfyUI workflows lack it). */
export function vibettsSupport(lang: string): VoiceSupport {
  const ok = (VIBETTS_LANGS as readonly string[]).includes(lang)
  return ok
    ? { status: 'ok', supported: [...VIBETTS_LANGS], message: `VibeTTS speaks ${VIBETTS_LANGS.map(langName).join(' and ')}; the same voice is used for every language.` }
    : { status: 'unsupported', supported: [...VIBETTS_LANGS], message: `VibeTTS does not speak ${langName(lang)}.` }
}

export interface VoiceOption {
  id: string
  label: string
}

/** The voices a speaker can be given: the OmniVoice presets of VibeTTS, plus the current one when VibeTTS no longer lists it. */
export function voiceOptions(voices: readonly { id: string; kind: string; description: string }[], current: string | undefined): VoiceOption[] {
  const out: VoiceOption[] = voices
    .filter((v) => v.id.startsWith('omni:'))
    .map((v) => ({ id: v.id, label: v.description ? `${v.id.slice(5)} (${v.description})` : v.id.slice(5) }))
  if (current && !out.some((o) => o.id === current)) out.push({ id: current, label: `${current} (not in VibeTTS)` })
  return out
}

/** The message shown for a voice job step (`voice ... 12/40 clips`) and its fraction. */
export function voiceProgress(step: { status: string; message: string; done?: number; total?: number } | undefined): { text: string; fraction: number | null } | null {
  if (!step || step.status !== 'running') return null
  const fraction = step.total ? Math.min(1, (step.done ?? 0) / step.total) : null
  return { text: step.message, fraction }
}
