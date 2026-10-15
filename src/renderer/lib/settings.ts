import type { ProjectSettingsPatch } from '../../shared/protocol'
import type { ProjectSettings } from '../../shared/vn'

function dropNulls<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj }
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k]
  return out as T
}

/** The settings after a patch, as the engine merges it (each part is merged, `null` clears an optional field, `art.pixel` is merged field by field; `theme` is replaced). For the instant UI update. */
export function applySettingsPatch(settings: ProjectSettings, patch: ProjectSettingsPatch): ProjectSettings {
  const art: Record<string, unknown> = dropNulls({ ...settings.art, ...patch.art })
  if (patch.art?.pixel) art.pixel = dropNulls({ ...(settings.art.pixel ?? {}), ...patch.art.pixel })
  return {
    ...settings,
    theme: patch.theme !== undefined ? patch.theme : settings.theme,
    art: art as ProjectSettings['art'],
    music: dropNulls({ ...settings.music, ...patch.music }) as ProjectSettings['music'],
    voice: { ...settings.voice, ...patch.voice }
  }
}
