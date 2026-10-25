import { AUDIO_KINDS } from '../../shared/vn'
import type { AssetKind } from '../../shared/vn'
import type { CustomWorkflowInfo, EngineInfo } from '../../shared/protocol'

export interface EngineChoice {
  id: string
  label: string
}

interface EngineLists {
  image: readonly EngineInfo[]
  audio: readonly EngineInfo[]
}

/**
 * The engines to offer for an asset kind: sprites use an edit engine (they come from the character sheet), the other images a
 * plain generator, the audio kinds (music, sound effects, ambiences) an audio engine. Custom workflows of the right kind are
 * added as `custom:<name>` (a TTS workflow, one that declares languages, is never offered as music); the current engine is always
 * offered, so an unknown one is not lost.
 */
export function engineChoices(kind: AssetKind, engines: EngineLists | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  const out: EngineChoice[] = []
  const add = (c: EngineChoice) => {
    if (!out.some((o) => o.id === c.id)) out.push(c)
  }
  const audio = AUDIO_KINDS.has(kind)
  if (engines) {
    if (audio) engines.audio.filter((e) => !e.edit).forEach((e) => add({ id: e.id, label: e.label }))
    else if (kind === 'sprite') engines.image.filter((e) => e.edit).forEach((e) => add({ id: e.id, label: e.label }))
    else engines.image.filter((e) => !e.edit).forEach((e) => add({ id: e.id, label: e.label }))
  }
  const wfKind = audio ? 'audio' : 'image'
  for (const w of workflows) {
    if (w.kind === wfKind && !(audio && w.languages.length > 0)) add({ id: `custom:${w.name}`, label: `custom: ${w.name}` })
  }
  if (current) add({ id: current, label: current })
  return out
}

/** Generator choices for the project settings (plain image engines + custom image workflows). */
export function generatorChoices(engines: EngineLists | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  return engineChoices('background', engines, workflows, current)
}

export function editorChoices(engines: EngineLists | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  return engineChoices('sprite', engines, workflows, current)
}

export function musicChoices(engines: EngineLists | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  return engineChoices('music', engines, workflows, current)
}

/** TTS engine choices: custom audio workflows that declare languages. */
export function ttsChoices(workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  const out: EngineChoice[] = workflows.filter((w) => w.kind === 'audio' && w.languages.length > 0).map((w) => ({ id: `custom:${w.name}`, label: `custom: ${w.name}` }))
  if (current && !out.some((o) => o.id === current)) out.push({ id: current, label: current })
  return out
}
