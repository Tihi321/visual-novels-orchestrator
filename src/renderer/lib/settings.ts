import type { ProjectSettingsPatch } from '../../shared/protocol'
import type { ProjectSettings } from '../../shared/vn'

/** The settings after a patch, as the engine merges it (each part is merged, `null` clears an optional field; `theme` is replaced). For the instant UI update. */
export function applySettingsPatch(settings: ProjectSettings, patch: ProjectSettingsPatch): ProjectSettings {
  const art: Record<string, unknown> = { ...settings.art, ...patch.art }
  for (const k of Object.keys(art)) if (art[k] === null) delete art[k]
  return {
    ...settings,
    theme: patch.theme !== undefined ? patch.theme : settings.theme,
    art: art as ProjectSettings['art'],
    music: { ...settings.music, ...patch.music },
    voice: { ...settings.voice, ...patch.voice }
  }
}
