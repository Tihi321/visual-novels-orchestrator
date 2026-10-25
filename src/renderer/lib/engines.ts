import { AUDIO_KINDS, CHIPTUNE_ENGINE } from '../../shared/vn'
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

/** The fields a TTS engine choice reads: both `EngineInfo` (listEngines) and the store's `VoiceEngineView` have them. */
export type TtsEngineInfo = Pick<EngineInfo, 'id' | 'label' | 'task'>

/** A custom audio workflow that declares languages speaks: the others make music. */
const isTtsWorkflow = (w: CustomWorkflowInfo): boolean => w.kind === 'audio' && w.languages.length > 0

/** The custom audio workflows that make music or sound effects, not speech. */
const customMusicWorkflows = (workflows: readonly CustomWorkflowInfo[]): CustomWorkflowInfo[] => workflows.filter((w) => w.kind === 'audio' && !isTtsWorkflow(w))

/**
 * The engines to offer for an asset kind: sprites use an edit engine (they come from the character sheet), the other images a
 * plain generator, and the audio kinds an audio engine filtered by what it makes (`music`; for a sound effect also `sfx`). A TTS
 * engine and a TTS workflow (one that declares languages) are never offered for music or sound. Custom workflows of the right kind
 * are added as `custom:<name>`; the current engine is always offered, so an unknown one is not lost.
 */
export function engineChoices(kind: AssetKind, engines: EngineLists | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  const out: EngineChoice[] = []
  const add = (c: EngineChoice) => {
    if (!out.some((o) => o.id === c.id)) out.push(c)
  }
  const audio = AUDIO_KINDS.has(kind)
  if (engines) {
    if (audio) {
      const takesSfx = kind === 'sfx'
      engines.audio.filter((e) => (takesSfx ? e.task === 'music' || e.task === 'sfx' : e.task === 'music')).forEach((e) => add({ id: e.id, label: e.label }))
    } else if (kind === 'sprite') engines.image.filter((e) => e.edit).forEach((e) => add({ id: e.id, label: e.label }))
    else engines.image.filter((e) => !e.edit).forEach((e) => add({ id: e.id, label: e.label }))
  }
  if (audio) {
    for (const w of customMusicWorkflows(workflows)) add({ id: `custom:${w.name}`, label: `custom: ${w.name}` })
  } else {
    for (const w of workflows) if (w.kind === 'image') add({ id: `custom:${w.name}`, label: `custom: ${w.name}` })
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

/**
 * TTS engine choices for the voice settings: the built-in voice engines in registry order (`task: 'tts'`), then the custom TTS
 * workflows, then the current engine when none of them lists it (so an unknown setting is not silently lost).
 */
export function ttsChoices(engines: readonly TtsEngineInfo[] | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  const out: EngineChoice[] = []
  const add = (c: EngineChoice) => {
    if (!out.some((o) => o.id === c.id)) out.push(c)
  }
  for (const e of engines ?? []) if (e.task === 'tts') add({ id: e.id, label: e.label })
  for (const w of workflows) if (isTtsWorkflow(w)) add({ id: `custom:${w.name}`, label: `custom: ${w.name}` })
  if (current) add({ id: current, label: current })
  return out
}

/**
 * The engines a sound effect can use: the music and sound-effect engines in registry order (MOSS-SoundEffect v2 is the `sfx` one),
 * the custom audio workflows that are not speech, and Chiptune Studio's `compose_sfx`. The Sound card adds `none` itself.
 */
export function sfxChoices(engines: EngineLists | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  const out: EngineChoice[] = []
  const add = (c: EngineChoice) => {
    if (!out.some((o) => o.id === c.id)) out.push(c)
  }
  for (const e of engines?.audio ?? []) if (e.task === 'music' || e.task === 'sfx') add({ id: e.id, label: e.label })
  for (const w of customMusicWorkflows(workflows)) add({ id: `custom:${w.name}`, label: `custom: ${w.name}` })
  add({ id: CHIPTUNE_ENGINE, label: 'Chiptune Studio (compose_sfx)' })
  if (current) add({ id: current, label: current })
  return out
}

/** The engines an ambience can use: the music engines, the custom audio workflows that are not speech, and Chiptune Studio. */
export function ambienceChoices(engines: EngineLists | null, workflows: readonly CustomWorkflowInfo[], current?: string): EngineChoice[] {
  const out: EngineChoice[] = []
  const add = (c: EngineChoice) => {
    if (!out.some((o) => o.id === c.id)) out.push(c)
  }
  for (const e of engines?.audio ?? []) if (e.task === 'music') add({ id: e.id, label: e.label })
  for (const w of customMusicWorkflows(workflows)) add({ id: `custom:${w.name}`, label: `custom: ${w.name}` })
  add({ id: CHIPTUNE_ENGINE, label: 'Chiptune Studio' })
  if (current) add({ id: current, label: current })
  return out
}
