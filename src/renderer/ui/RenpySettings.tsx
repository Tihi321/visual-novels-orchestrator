import { useEffect, useState } from 'react'
import { openFolder, sendCommand } from '../api'
import { useVn } from '../store/hooks'

/** Game resolution and image format (config/renpy.md). Standalone HTML5 Web VN Engine. */
export function RenpySettings() {
  const cfg = useVn((s) => s.renpy)
  const connected = useVn((s) => s.connected)
  const [resolution, setResolution] = useState<string | null>(null)
  useEffect(() => {
    if (connected) sendCommand({ type: 'getRenpyConfig' })
  }, [connected])
  // filled from the engine; a later answer (after a save) does not undo what you type
  useEffect(() => {
    if (cfg && resolution === null) setResolution(cfg.resolution)
  }, [cfg, resolution])

  const saveResolution = () => {
    if (cfg && resolution && resolution.trim() !== cfg.resolution) sendCommand({ type: 'saveRenpyConfig', resolution: resolution.trim() })
  }
  return (
    <div className="stack" data-testid="renpy-settings">
      <label>Game Engine</label>
      <div className="row">
        <label className="dim">Resolution</label>
        <input
          style={{ width: 120 }}
          value={resolution ?? ''}
          onChange={(e) => setResolution(e.target.value)}
          onBlur={saveResolution}
          onKeyDown={(e) => e.key === 'Enter' && saveResolution()}
          placeholder="1920x1080"
          data-testid="set-renpyResolution"
        />
        <label className="dim">Image format</label>
        <select value={cfg?.imageFormat ?? 'webp'} onChange={(e) => sendCommand({ type: 'saveRenpyConfig', imageFormat: e.target.value as 'webp' | 'png' })} data-testid="set-renpyFormat">
          <option value="webp">webp</option>
          <option value="png">png</option>
        </select>
        <button onClick={() => void openFolder('config')}>Open config folder</button>
      </div>
      <div className="dim">Saved to config/renpy.md. The engine reads it when a build starts. Default resolution is 1920x1080.</div>
    </div>
  )
}
