import { useEffect, useMemo, useState } from 'react'
import { computeStageAtBeat, resolveSceneAudio } from '../../lib/stage-preview'
import { expressionsOf, isPictureBook } from '../../../shared/vn'
import type { AssetView, ProjectDetail, SceneTransitionView, StageSlotView } from '../../../shared/protocol'
import type { VnBeat } from '../../../shared/vn'
import { sendCommand } from '../../api'
import { projectAssetUrl } from '../../lib/urls'
import { useVn } from '../../store/hooks'
import { Pill, useRecentError } from '../common'

const SLOTS: StageSlotView[] = ['left', 'center', 'right']
const TRANSITIONS: SceneTransitionView[] = ['dissolve', 'fade', 'none']
const TIME_PRESETS = ['', 'day', 'night', 'dawn', 'dusk']
const SOURCE_LABELS: Record<'cue' | 'story' | 'chapter', string> = { cue: 'scene cue', story: 'story', chapter: 'chapter' }

function resolveSpriteAsset(
  assets: Record<string, AssetView> | undefined,
  charKey: string,
  expression: string
): AssetView | undefined {
  if (!assets) return undefined
  return (
    assets[`sprite_${charKey}_${expression}`] ??
    assets[`sprite_${charKey}_neutral`] ??
    assets[`sheet_${charKey}`]
  )
}

/** One row of the scene audio card: the effective cue, where it comes from, and a player when it has a file. */
function SceneAudioRow({
  label,
  cue,
  from,
  asset,
  rev,
  slug,
  loop,
  audioKey,
  emptyLabel,
  testId
}: {
  label: string
  cue: string | null
  from: 'cue' | 'story' | 'chapter' | null
  asset: AssetView | undefined
  rev: number
  slug: string
  loop: boolean
  audioKey: string
  emptyLabel: string
  testId: string
}) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }} data-testid={testId}>
      <span className="dim" style={{ width: 78, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ minWidth: 120 }}>
        {cue ? <b>{cue}</b> : <span className="dim">{emptyLabel}</span>}
        {from && (
          <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>
            · {SOURCE_LABELS[from]}
          </span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 220 }}>
        {asset?.fileRel ? (
          <audio
            key={audioKey}
            controls
            preload="none"
            loop={loop}
            src={projectAssetUrl(slug, asset.fileRel, rev)}
            style={{ width: '100%', height: 32 }}
          />
        ) : cue ? (
          <span className="dim" style={{ fontSize: 12 }}>
            no file yet: generate or import it in Assets
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function ScenesTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const { book } = detail
  // a picture book is shown page by page: one illustration with the caption of its scene
  const pictureBook = isPictureBook(book)
  const cuesMap = detail.cues ?? {}
  const assetMap = useVn((s) => s.assets[slug])
  const assetRev = useVn((s) => s.assetRev)
  const cuesError = useRecentError(slug, 'updateSceneCues')
  const storyError = useRecentError(slug, 'updateSceneStory')

  const allScenes = useMemo(
    () =>
      book.chapters.flatMap((ch) =>
        ch.scenes.map((sc) => ({
          chapterN: ch.n,
          chapterTitle: ch.title,
          scene: sc
        }))
      ),
    [book]
  )

  const [selectedSceneId, setSelectedSceneId] = useState<string>(() => allScenes[0]?.scene.id ?? '')
  const [beatIdx, setBeatIdx] = useState<number>(0)
  const [addCharKey, setAddCharKey] = useState<string>('')

  const activeEntry = useMemo(
    () => allScenes.find((x) => x.scene.id === selectedSceneId) ?? allScenes[0] ?? null,
    [allScenes, selectedSceneId]
  )

  const scene = activeEntry?.scene ?? null

  useEffect(() => {
    if (scene && beatIdx >= scene.beats.length) {
      setBeatIdx(Math.max(0, scene.beats.length - 1))
    }
  }, [scene, beatIdx])

  const castsMap = useMemo(() => {
    const out: Record<string, Record<string, StageSlotView>> = {}
    for (const view of Object.values(cuesMap)) {
      for (const [bId, slotMap] of Object.entries(view.casts ?? {})) {
        out[bId] = { ...slotMap }
      }
    }
    return out
  }, [cuesMap])

  const currentBeat: VnBeat | undefined = scene?.beats[beatIdx]
  const stage = useMemo(
    () => (scene ? computeStageAtBeat(scene, castsMap, beatIdx, cuesMap[scene.id]?.beats) : { slots: {}, cg: null, activeSpeaker: null }),
    [scene, castsMap, beatIdx, cuesMap]
  )
  const sceneAudio = useMemo(
    () => (scene ? resolveSceneAudio(book, cuesMap, detail.stageMusic ?? { chapters: {} }, scene.id, beatIdx) : null),
    [book, cuesMap, detail.stageMusic, scene, beatIdx]
  )
  const chapterTrack = useMemo(
    () => (activeEntry ? (detail.stageMusic?.chapters[String(activeEntry.chapterN)] ?? null) : null),
    [activeEntry, detail.stageMusic]
  )

  const charByKey = useMemo(() => new Map(book.characters.map((c) => [c.key, c])), [book.characters])
  const placeByKey = useMemo(() => new Map(book.places.map((p) => [p.key, p])), [book.places])
  const musicIds = useMemo(
    () =>
      Object.values(assetMap ?? {})
        .filter((a) => a.kind === 'music' && !a.orphaned)
        .map((a) => a.id)
        .sort(),
    [assetMap]
  )
  const ambienceSounds = useMemo(() => (book.sounds ?? []).filter((s) => s.kind === 'ambience'), [book.sounds])
  const sfxSounds = useMemo(() => (book.sounds ?? []).filter((s) => s.kind === 'sfx'), [book.sounds])

  if (!scene) {
    return (
      <div className="stack" data-testid="tab-scenes-body">
        <div className="dim">This project has no scenes yet.</div>
      </div>
    )
  }

  const sceneCue = cuesMap[scene.id]
  const transition: SceneTransitionView = sceneCue?.transition ?? 'dissolve'
  const pauseVal = sceneCue?.pause ?? 0

  // The background is the scene's own asset id, exactly as the game builder uses it.
  const bgAssetId = scene.backgroundId || null
  const bgAsset = bgAssetId ? assetMap?.[bgAssetId] : undefined
  const bgUrl = bgAsset?.fileRel ? projectAssetUrl(slug, bgAsset.fileRel, assetRev[`${slug}:${bgAsset.id}`] ?? 0) : null

  // Picture book: the page preview walks the scenes as pages, and its caption is the scene's narration and lines
  const pageIndex = allScenes.findIndex((x) => x.scene.id === scene.id)
  const captionBeats = scene.beats.filter((b) => b.type === 'line' || b.type === 'narration')
  const goToPage = (n: number) => {
    const next = allScenes[n]
    if (!next) return
    setSelectedSceneId(next.scene.id)
    setBeatIdx(0)
  }

  // The CG or insert shown over the stage: a full picture covers it, an insert is shown small in the middle.
  const cgKey = stage.cg
  const cgEntry = cgKey ? book.images?.find((i) => i.key === cgKey) : undefined
  const cgDisplay = cgEntry?.display ?? 'full'
  const cgAsset = cgKey ? assetMap?.[`cg_${cgKey}`] : undefined
  const cgUrl = cgAsset?.fileRel ? projectAssetUrl(slug, cgAsset.fileRel, assetRev[`${slug}:${cgAsset.id}`] ?? 0) : null

  const revOf = (asset: AssetView | undefined): number => (asset ? (assetRev[`${slug}:${asset.id}`] ?? 0) : 0)
  const musicAsset = sceneAudio?.music ? assetMap?.[sceneAudio.music] : undefined
  const ambienceAsset = sceneAudio?.ambience ? assetMap?.[`amb_${sceneAudio.ambience}`] : undefined
  const sfxAsset = sceneAudio?.sfx ? assetMap?.[`sfx_${sceneAudio.sfx}`] : undefined

  const handleCastSlotChange = (beat: Extract<VnBeat, { type: 'cast' }>, charKey: string, targetSlot: StageSlotView) => {
    const existingSlots: Record<string, StageSlotView> = { ...(sceneCue?.casts?.[beat.id] ?? {}) }
    // Ensure all cast members have a baseline slot
    const used = new Set(Object.values(existingSlots))
    for (const c of beat.cast) {
      if (!existingSlots[c.charKey]) {
        const free = SLOTS.find((s) => !used.has(s)) ?? 'center'
        existingSlots[c.charKey] = free
        used.add(free)
      }
    }
    const prevSlot = existingSlots[charKey]
    const occupant = Object.entries(existingSlots).find(([k, s]) => k !== charKey && s === targetSlot)?.[0]
    if (occupant && prevSlot) {
      existingSlots[occupant] = prevSlot
    }
    existingSlots[charKey] = targetSlot
    sendCommand({
      type: 'updateSceneCues',
      slug,
      casts: [{ beatId: beat.id, slots: existingSlots }]
    })
  }

  return (
    <div className="stack" data-testid="tab-scenes-body">
      {(cuesError || storyError) && <div className="bad-text">{cuesError || storyError}</div>}
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        {/* Left Pane: Chapter & Scene Tree */}
        <div
          className="card stack"
          style={{ width: 280, flexShrink: 0, maxHeight: '78vh', overflowY: 'auto', padding: 10, gap: 8 }}
          data-testid="scene-tree"
        >
          {book.chapters.map((ch) => (
            <div key={ch.n} className="stack" style={{ gap: 4 }}>
              <div className="dim" style={{ fontWeight: 600, fontSize: 12 }}>
                Ch {ch.n}: {ch.title}
              </div>
              {ch.scenes.map((sc) => {
                const placeName = sc.placeKey ? placeByKey.get(sc.placeKey)?.name ?? sc.placeKey : '(no place)'
                const isSelected = sc.id === scene.id
                return (
                  <button
                    key={sc.id}
                    className={isSelected ? 'primary' : ''}
                    style={{ textAlign: 'left', fontSize: 12, padding: '6px 8px' }}
                    onClick={() => {
                      setSelectedSceneId(sc.id)
                      setBeatIdx(0)
                    }}
                    data-testid={`scene-item-${sc.id}`}
                  >
                    <div>
                      <b>{sc.id}</b> — {placeName}
                    </div>
                    <div className="dim" style={{ fontSize: 11 }}>
                      {sc.beats.length} beats {sc.time ? `· ${sc.time}` : ''}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Right Pane: Stage Preview + Inspector */}
        <div className="stack" style={{ flex: 1, minWidth: 0, gap: 14 }}>
          {/* A picture book shows its pages, not a stage: one illustration with the caption of its scene */}
          {pictureBook ? (
            <div className="card stack" style={{ gap: 8 }} data-testid="page-preview">
              <div className="row spread">
                <div className="row" style={{ gap: 8 }}>
                  <b>Page preview</b>
                  <Pill>{scene.id}</Pill>
                  <span className="dim">
                    Page {pageIndex + 1} / {allScenes.length}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button disabled={pageIndex <= 0} onClick={() => goToPage(pageIndex - 1)} data-testid="page-prev">
                    Previous page
                  </button>
                  <button disabled={pageIndex < 0 || pageIndex >= allScenes.length - 1} onClick={() => goToPage(pageIndex + 1)} data-testid="page-next">
                    Next page
                  </button>
                </div>
              </div>
              <div
                data-testid="page-illustration"
                style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '16 / 9',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: bgUrl ? `center / contain no-repeat url("${bgUrl}")` : 'linear-gradient(180deg, #1b2234 0%, #0f131d 100%)',
                  border: '1px solid var(--border, #2e3446)'
                }}
              >
                {!bgUrl && (
                  <div
                    data-testid="page-bg-missing"
                    className="dim"
                    style={{ position: 'absolute', top: 10, left: 12, fontSize: 12, background: 'rgba(0,0,0,0.55)', padding: '2px 8px', borderRadius: 4 }}
                  >
                    {bgAssetId ? `${bgAssetId} (no image yet)` : '(no illustration)'}
                  </div>
                )}
              </div>
              <div
                data-testid="page-caption"
                style={{
                  minHeight: 66,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(10, 13, 22, 0.86)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#f2f4f8',
                  fontSize: 14,
                  lineHeight: 1.5
                }}
              >
                {captionBeats.length === 0 && <span className="dim">(no text yet: a picture-only page)</span>}
                {captionBeats.map((b) =>
                  b.type === 'line' ? (
                    <div key={b.id}>
                      <b>{charByKey.get(b.speakerKey ?? '')?.name ?? b.speakerKey}:</b> {b.text}
                    </div>
                  ) : (
                    <div key={b.id}>{b.text}</div>
                  )
                )}
              </div>
            </div>
          ) : (
          // Live Stage Preview Canvas (16:9)
          <div className="card stack" style={{ gap: 8 }}>
            <div className="row spread">
              <div className="row" style={{ gap: 8 }}>
                <b>Stage Preview</b>
                <Pill>{scene.id}</Pill>
                <span className="dim">
                  Beat {beatIdx + 1} / {scene.beats.length}
                </span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  disabled={beatIdx <= 0}
                  onClick={() => setBeatIdx((i) => Math.max(0, i - 1))}
                  data-testid="scene-prev-beat"
                >
                  Prev beat
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, scene.beats.length - 1)}
                  value={beatIdx}
                  onChange={(e) => setBeatIdx(Number(e.target.value))}
                  style={{ width: 120 }}
                  data-testid="scene-beat-scrubber"
                />
                <button
                  disabled={beatIdx >= scene.beats.length - 1}
                  onClick={() => setBeatIdx((i) => Math.min(scene.beats.length - 1, i + 1))}
                  data-testid="scene-next-beat"
                >
                  Next beat
                </button>
              </div>
            </div>

            <div
              data-testid="scene-stage-preview"
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16 / 9',
                borderRadius: 8,
                overflow: 'hidden',
                background: bgUrl
                  ? `center / cover no-repeat url("${bgUrl}")`
                  : 'linear-gradient(180deg, #1b2234 0%, #0f131d 100%)',
                border: '1px solid var(--border, #2e3446)'
              }}
            >
              {!bgUrl && (
                <div
                  data-testid="scene-bg-missing"
                  className="dim"
                  style={{ position: 'absolute', top: 10, left: 12, fontSize: 12, background: 'rgba(0,0,0,0.55)', padding: '2px 8px', borderRadius: 4 }}
                >
                  {bgAssetId ? `${bgAssetId} (no image yet)` : '(no background)'}
                </div>
              )}

              {/* Character Slots */}
              {SLOTS.map((slot) => {
                const occupant = stage.slots[slot]
                if (!occupant) return null
                const leftPct = slot === 'left' ? '22%' : slot === 'center' ? '50%' : '78%'
                const char = charByKey.get(occupant.charKey)
                const spAsset = resolveSpriteAsset(assetMap, occupant.charKey, occupant.expression)
                const spUrl = spAsset?.fileRel
                  ? projectAssetUrl(slug, spAsset.fileRel, assetRev[`${slug}:${spAsset.id}`] ?? 0)
                  : null
                const isDimmed = stage.activeSpeaker !== null && stage.activeSpeaker !== occupant.charKey
                return (
                  <div
                    key={slot}
                    data-testid={`stage-slot-${slot}`}
                    style={{
                      position: 'absolute',
                      bottom: '18%',
                      left: leftPct,
                      transform: 'translateX(-50%)',
                      height: '76%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      opacity: isDimmed ? 0.82 : 1,
                      transition: 'left 0.2s ease, opacity 0.15s ease',
                      pointerEvents: 'none'
                    }}
                  >
                    {spUrl ? (
                      <img
                        src={spUrl}
                        alt={`${occupant.charKey} (${occupant.expression})`}
                        style={{ maxHeight: '100%', width: 'auto', objectFit: 'contain' }}
                      />
                    ) : (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: 'rgba(20, 26, 40, 0.88)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          color: '#e5e9f0',
                          textAlign: 'center',
                          fontSize: 12
                        }}
                      >
                        <div>
                          <b>{char?.name ?? occupant.charKey}</b>
                        </div>
                        <div className="dim" style={{ fontSize: 11 }}>
                          {occupant.expression} · {slot}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* CG / insert overlay: above the characters, below the dialogue box */}
              {cgKey && (
                <div
                  data-testid="scene-cg"
                  style={
                    cgDisplay === 'insert'
                      ? { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }
                      : { position: 'absolute', inset: 0, pointerEvents: 'none' }
                  }
                >
                  {cgUrl ? (
                    <img
                      src={cgUrl}
                      alt={cgKey}
                      style={
                        cgDisplay === 'insert'
                          ? { width: '60%', height: '60%', objectFit: 'contain', filter: 'drop-shadow(0 10px 28px rgba(0,0,0,0.6))' }
                          : { width: '100%', height: '100%', objectFit: 'cover' }
                      }
                    />
                  ) : (
                    <div
                      className="dim"
                      style={{
                        position: 'absolute',
                        top: cgDisplay === 'insert' ? '50%' : 10,
                        right: cgDisplay === 'insert' ? 'auto' : 12,
                        left: cgDisplay === 'insert' ? '50%' : 'auto',
                        transform: cgDisplay === 'insert' ? 'translate(-50%, -50%)' : undefined,
                        fontSize: 12,
                        background: 'rgba(0,0,0,0.55)',
                        padding: '2px 8px',
                        borderRadius: 4
                      }}
                    >
                      {`cg_${cgKey} (no image yet)`}
                    </div>
                  )}
                </div>
              )}

              {/* Dialogue Overlay Box */}
              <div
                className="vnp-textbox"
                style={{
                  position: 'absolute',
                  left: 16,
                  right: 16,
                  bottom: 12,
                  minHeight: 68,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(10, 13, 22, 0.86)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#f2f4f8'
                }}
              >
                {currentBeat?.type === 'line' && (
                  <>
                    <div className="vnp-name" style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#9ec5fe' }}>
                      {charByKey.get(currentBeat.speakerKey ?? '')?.name ?? currentBeat.speakerKey}{' '}
                      <span className="dim" style={{ fontWeight: 400, fontSize: 11 }}>
                        ({currentBeat.expression})
                      </span>
                    </div>
                    <div className="vnp-text" style={{ fontSize: 13 }}>
                      {currentBeat.text}
                    </div>
                  </>
                )}
                {currentBeat?.type === 'narration' && (
                  <div className="vnp-text" style={{ fontSize: 13, fontStyle: 'italic' }}>
                    {currentBeat.text}
                  </div>
                )}
                {currentBeat?.type === 'cast' && (
                  <div className="dim" style={{ fontSize: 12 }}>
                    [Cast change: {currentBeat.cast.map((c) => charByKey.get(c.charKey)?.name ?? c.charKey).join(', ') || 'stage cleared'}]
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Scene Audio: the effective cues at this beat, as the game plays them */}
          {sceneAudio && (
            <div className="card stack" style={{ gap: 8 }} data-testid="scene-audio">
              <div className="row spread">
                <b>Scene audio</b>
                <span className="dim" style={{ fontSize: 12 }}>
                  What the game plays at {scene.id} · beat {beatIdx + 1}
                </span>
              </div>
              <SceneAudioRow
                label="Music"
                cue={sceneAudio.music}
                from={sceneAudio.musicFrom}
                asset={musicAsset}
                rev={revOf(musicAsset)}
                slug={slug}
                loop
                audioKey={`music:${sceneAudio.music ?? 'none'}`}
                emptyLabel={sceneAudio.musicFrom ? '(silence)' : '(none)'}
                testId="scene-audio-music"
              />
              <SceneAudioRow
                label="Ambience"
                cue={sceneAudio.ambience}
                from={sceneAudio.ambienceFrom}
                asset={ambienceAsset}
                rev={revOf(ambienceAsset)}
                slug={slug}
                loop
                audioKey={`ambience:${sceneAudio.ambience ?? 'none'}`}
                emptyLabel={sceneAudio.ambienceFrom ? '(stopped)' : '(none)'}
                testId="scene-audio-ambience"
              />
              <SceneAudioRow
                label="SFX (this beat)"
                cue={sceneAudio.sfx}
                from={sceneAudio.sfxFrom}
                asset={sfxAsset}
                rev={revOf(sfxAsset)}
                slug={slug}
                loop={false}
                audioKey={`${scene.id}:${beatIdx}`}
                emptyLabel="(none)"
                testId="scene-audio-sfx"
              />
            </div>
          )}

          {/* Scene Header Controls */}
          <div className="card stack" style={{ gap: 10 }}>
            <b>
              {pictureBook ? 'Page Settings' : 'Scene Settings'} ({scene.id})
            </b>
            <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <label className="row" style={{ gap: 6 }}>
                <span className="dim">Place</span>
                <select
                  value={scene.placeKey ?? ''}
                  onChange={(e) =>
                    sendCommand({
                      type: 'updateSceneStory',
                      slug,
                      scenes: [{ id: scene.id, placeKey: e.target.value || null }]
                    })
                  }
                  data-testid="scene-place-select"
                >
                  <option value="">(none)</option>
                  {book.places.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                <span className="dim">Time</span>
                <select
                  value={TIME_PRESETS.includes(scene.time ?? '') ? (scene.time ?? '') : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') return
                    sendCommand({
                      type: 'updateSceneStory',
                      slug,
                      scenes: [{ id: scene.id, time: e.target.value || null }]
                    })
                  }}
                  data-testid="scene-time-select"
                >
                  {TIME_PRESETS.map((t) => (
                    <option key={t} value={t}>
                      {t || '(none)'}
                    </option>
                  ))}
                  {!TIME_PRESETS.includes(scene.time ?? '') && <option value="__custom__">{scene.time}</option>}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                <span className="dim">Transition</span>
                <select
                  value={transition}
                  onChange={(e) =>
                    sendCommand({
                      type: 'updateSceneCues',
                      slug,
                      scenes: [{ id: scene.id, transition: e.target.value as SceneTransitionView }]
                    })
                  }
                  data-testid="scene-transition-select"
                >
                  {TRANSITIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                <span className="dim">Pause (s)</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={pauseVal}
                  style={{ width: 70 }}
                  onChange={(e) =>
                    sendCommand({
                      type: 'updateSceneCues',
                      slug,
                      scenes: [{ id: scene.id, pause: Math.max(0, Number(e.target.value) || 0) }]
                    })
                  }
                  data-testid="scene-pause-input"
                />
              </label>

              <label className="row" style={{ gap: 6 }}>
                <span className="dim">Music</span>
                <select
                  value={scene.music === undefined ? '' : scene.music === null ? '__silence__' : scene.music}
                  onChange={(e) => {
                    const val = e.target.value
                    sendCommand({
                      type: 'updateSceneStory',
                      slug,
                      scenes: [{ id: scene.id, music: val === '' ? '' : val === '__silence__' ? null : val }]
                    })
                  }}
                  data-testid="scene-music-select"
                >
                  <option value="">{chapterTrack ? `(chapter default: ${chapterTrack})` : '(chapter default)'}</option>
                  <option value="__silence__">(silence)</option>
                  {musicIds.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                <span className="dim">Ambience</span>
                <select
                  value={scene.ambience ?? ''}
                  onChange={(e) =>
                    sendCommand({
                      type: 'updateSceneStory',
                      slug,
                      scenes: [{ id: scene.id, ambience: e.target.value || null }]
                    })
                  }
                  data-testid="scene-ambience-select"
                >
                  <option value="">(none)</option>
                  {ambienceSounds.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.key}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Selected Beat Inspector */}
          {currentBeat && (
            <div className="card stack" style={{ gap: 10 }} data-testid="beat-inspector">
              <div className="row spread">
                <b>
                  Beat Inspector ({currentBeat.id} · {currentBeat.type})
                </b>
              </div>

              {currentBeat.type === 'cast' ? (
                <div className="stack" style={{ gap: 8 }}>
                  {currentBeat.cast.length === 0 && <div className="dim">No characters on stage in this cast beat.</div>}
                  {currentBeat.cast.map((c) => {
                    const ch = charByKey.get(c.charKey)
                    const curSlot: StageSlotView = sceneCue?.casts?.[currentBeat.id]?.[c.charKey] ?? 'center'
                    return (
                      <div key={c.charKey} className="row spread" style={{ gap: 8 }}>
                        <span>
                          <b>{ch?.name ?? c.charKey}</b> <span className="dim">({c.charKey})</span>
                        </span>
                        <div className="row" style={{ gap: 4 }}>
                          {!pictureBook &&
                            SLOTS.map((slot) => (
                              <button
                                key={slot}
                                className={curSlot === slot ? 'primary' : ''}
                                onClick={() => handleCastSlotChange(currentBeat, c.charKey, slot)}
                                data-testid={`cast-slot-${currentBeat.id}-${c.charKey}-${slot}`}
                              >
                                {slot}
                              </button>
                            ))}
                          <button
                            onClick={() =>
                              sendCommand({
                                type: 'updateSceneStory',
                                slug,
                                beats: [
                                  {
                                    id: currentBeat.id,
                                    cast: currentBeat.cast.filter((x) => x.charKey !== c.charKey).map((x) => x.charKey)
                                  }
                                ]
                              })
                            }
                            data-testid={`cast-remove-${currentBeat.id}-${c.charKey}`}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {currentBeat.cast.length < 3 && (
                    <div className="row" style={{ gap: 6 }}>
                      <select
                        value={addCharKey}
                        onChange={(e) => setAddCharKey(e.target.value)}
                        data-testid="cast-add-select"
                      >
                        <option value="">Add character...</option>
                        {book.characters
                          .filter((c) => !currentBeat.cast.some((x) => x.charKey === c.key))
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name} ({c.key})
                            </option>
                          ))}
                      </select>
                      <button
                        disabled={!addCharKey}
                        onClick={() => {
                          if (!addCharKey) return
                          sendCommand({
                            type: 'updateSceneStory',
                            slug,
                            beats: [
                              {
                                id: currentBeat.id,
                                cast: [...currentBeat.cast.map((x) => x.charKey), addCharKey]
                              }
                            ]
                          })
                          setAddCharKey('')
                        }}
                        data-testid="cast-add-button"
                      >
                        Add to cast
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                  {currentBeat.type === 'line' && (
                    <>
                      <label className="row" style={{ gap: 6 }}>
                        <span className="dim">Speaker</span>
                        <select
                          value={currentBeat.speakerKey ?? ''}
                          onChange={(e) =>
                            sendCommand({
                              type: 'updateSceneStory',
                              slug,
                              beats: [{ id: currentBeat.id, speakerKey: e.target.value }]
                            })
                          }
                          data-testid="beat-speaker-select"
                        >
                          {book.characters.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name} ({c.key})
                            </option>
                          ))}
                        </select>
                      </label>

                      {!pictureBook && (
                        <label className="row" style={{ gap: 6 }}>
                          <span className="dim">Expression</span>
                          <select
                            value={currentBeat.expression}
                            onChange={(e) =>
                              sendCommand({
                                type: 'updateSceneStory',
                                slug,
                                beats: [{ id: currentBeat.id, expression: e.target.value }]
                              })
                            }
                            data-testid="beat-expression-select"
                          >
                            {expressionsOf(book, charByKey.get(currentBeat.speakerKey ?? '')).map((expr) => (
                              <option key={expr} value={expr}>
                                {expr}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </>
                  )}

                  {!pictureBook && (
                    <label className="row" style={{ gap: 6 }}>
                      <span className="dim">CG Image</span>
                      <select
                        value={currentBeat.image ?? ''}
                        onChange={(e) =>
                          sendCommand({
                            type: 'updateSceneStory',
                            slug,
                            beats: [{ id: currentBeat.id, image: e.target.value || null }]
                          })
                        }
                        data-testid="beat-image-select"
                      >
                        <option value="">(none)</option>
                        {(book.images ?? []).map((cg) => (
                          <option key={cg.key} value={cg.key}>
                            {cg.key}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="row" style={{ gap: 6 }}>
                    <span className="dim">SFX</span>
                    <select
                      value={currentBeat.sfx ?? ''}
                      onChange={(e) =>
                        sendCommand({
                          type: 'updateSceneStory',
                          slug,
                          beats: [{ id: currentBeat.id, sfx: e.target.value || null }]
                        })
                      }
                      data-testid="beat-sfx-select"
                    >
                      <option value="">(none)</option>
                      {sfxSounds.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.key}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Scene Beat List */}
          <div className="card stack" style={{ gap: 6, maxHeight: 280, overflowY: 'auto' }} data-testid="scene-beat-list">
            <b>Beats in {scene.id}</b>
            {scene.beats.map((b, i) => {
              const selected = i === beatIdx
              return (
                <button
                  key={b.id}
                  className={selected ? 'primary' : ''}
                  style={{ textAlign: 'left', fontSize: 12, padding: '6px 8px' }}
                  onClick={() => setBeatIdx(i)}
                  data-testid={`scene-beat-${b.id}`}
                >
                  <span className="dim" style={{ marginRight: 8 }}>
                    #{i + 1} [{b.type}]
                  </span>
                  {b.type === 'line' && (
                    <span>
                      <b>{charByKey.get(b.speakerKey ?? '')?.name ?? b.speakerKey}</b> ({b.expression}): {b.text}
                    </span>
                  )}
                  {b.type === 'narration' && <span>{b.text}</span>}
                  {b.type === 'cast' && (
                    <span>Cast: {b.cast.map((c) => charByKey.get(c.charKey)?.name ?? c.charKey).join(', ') || '(empty)'}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
