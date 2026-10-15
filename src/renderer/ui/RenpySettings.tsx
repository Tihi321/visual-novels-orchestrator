import { useEffect, useState } from 'react'
import { openFolder, pickFolder, sendCommand } from '../api'
import { useVn } from '../store/hooks'
import { Pill } from './common'

/** The Ren'Py SDK folder, game resolution and image format (config/renpy.md). A missing SDK is a warning, not an error. */
export function RenpySettings() {
  const cfg = useVn((s) => s.renpy)
  const connected = useVn((s) => s.connected)
  const [sdk, setSdk] = useState<string | null>(null)
  const [resolution, setResolution] = useState<string | null>(null)
  useEffect(() => {
    if (connected) sendCommand({ type: 'getRenpyConfig' })
  }, [connected])
  // filled from the engine; a later answer (after a save) does not undo what you type
  useEffect(() => {
    if (cfg && sdk === null) setSdk(cfg.sdkPath)
    if (cfg && resolution === null) setResolution(cfg.resolution)
  }, [cfg, sdk, resolution])

  const saveSdk = (value: string | null = sdk) => {
    if (cfg && value && value.trim() !== cfg.sdkPath) sendCommand({ type: 'saveRenpyConfig', sdkPath: value.trim() })
  }
  const saveResolution = () => {
    if (cfg && resolution && resolution.trim() !== cfg.resolution) sendCommand({ type: 'saveRenpyConfig', resolution: resolution.trim() })
  }
  return (
    <div className="stack" data-testid="renpy-settings">
      <label>Ren&apos;Py SDK folder</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          style={{ flex: 1, minWidth: 0 }}
          value={sdk ?? ''}
          placeholder="the folder with renpy.exe"
          onChange={(e) => setSdk(e.target.value)}
          onBlur={() => saveSdk()}
          onKeyDown={(e) => e.key === 'Enter' && saveSdk()}
          data-testid="set-renpySdk"
        />
        <button
          onClick={() =>
            void pickFolder("Ren'Py SDK folder").then((p) => {
              if (p) {
                setSdk(p)
                saveSdk(p)
              }
            })
          }
        >
          Browse...
        </button>
      </div>
      <div className="row">
        {cfg && <Pill tone={cfg.sdkFound ? 'good' : 'warn'} testId="renpy-found">{cfg.sdkFound ? 'SDK found' : 'SDK not found'}</Pill>}
        {cfg?.warning && (
          <span className="warn" data-testid="renpy-warning">
            {cfg.warning}
          </span>
        )}
        {cfg?.envOverride && <span className="dim">The VNO_RENPY_SDK variable is set and wins over this path.</span>}
      </div>
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
      <div className="dim">Saved to config/renpy.md. The engine reads it when a build starts. The Ren&apos;Py template is made for 1920x1080.</div>
    </div>
  )
}
