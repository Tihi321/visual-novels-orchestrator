import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { ChipTrackPlan } from './chip-plan'
import type { ChiptuneClient } from './chiptune'

export interface ChiptuneTrack {
  /** The audio file name inside the asset folder (`v2.ogg`). */
  file: string
  /** The native song file name (`v2.song`), when it could be saved. */
  songFile?: string
  loopStartSec: number | null
  loopEndSec: number | null
  durationSec: number
  seed: number
  warnings: string[]
}

/**
 * Makes one track with Chiptune Studio: `compose_track` (a calm loop from the plan), `render_audio` (ogg, ending exactly at the loop end),
 * `save_song` (the native song next to it, so "Open in Chiptune Studio" can edit it later). Files are written by the studio at absolute
 * paths in `dir`. Throws a `StudioError` when the studio is down.
 */
export async function makeChiptuneTrack(
  client: ChiptuneClient,
  o: { dir: string; n: number; plan: ChipTrackPlan; seed?: number; name?: string; signal?: AbortSignal }
): Promise<ChiptuneTrack> {
  const dir = path.resolve(o.dir)
  await fs.mkdir(dir, { recursive: true })
  const warnings: string[] = []
  const composed = await client.composeTrack({ mood: o.plan.mood, chip: o.plan.chip, bpm: o.plan.bpm, key: o.plan.key, bars: o.plan.bars, loop: true, seed: o.seed, name: o.name }, o.signal)
  const wanted = path.join(dir, `v${o.n}.ogg`)
  const rendered = await client.renderAudio({ song: composed.songId, path: wanted, format: 'ogg', loops: 1 }, o.signal)
  if (rendered.warning) warnings.push(`Chiptune Studio: ${rendered.warning}`)
  const actual = path.resolve(rendered.path || wanted)
  if (!existsSync(actual)) throw new Error(`Chiptune Studio says it wrote ${actual}, but the file is not there`)
  if (path.dirname(actual) !== dir) {
    // the studio wrote somewhere else (a relative path resolved by the studio): bring it into the asset folder
    const moved = path.join(dir, `v${o.n}${path.extname(actual)}`)
    await fs.copyFile(actual, moved)
    warnings.push(`Chiptune Studio wrote ${actual}: copied into the project`)
    return finish(moved)
  }
  return finish(actual)

  async function finish(audio: string): Promise<ChiptuneTrack> {
    let songFile: string | undefined
    const songPath = path.join(dir, `v${o.n}.song`)
    try {
      const saved = await client.saveSong({ song: composed.songId, path: songPath }, o.signal)
      if (existsSync(path.resolve(saved.path))) songFile = path.basename(path.resolve(saved.path))
    } catch (e) {
      if (o.signal?.aborted) throw e
      warnings.push(`the song file could not be saved (${(e as Error).message}): "Open in Chiptune Studio" will not be available for this version`)
    }
    // the headless session keeps every song it composed: drop this one (best effort, the files stay)
    await client.deleteSong(composed.songId, o.signal).catch(() => undefined)
    return {
      file: path.basename(audio),
      ...(songFile ? { songFile } : {}),
      loopStartSec: rendered.loopStartSec ?? null,
      loopEndSec: rendered.loopEndSec ?? null,
      durationSec: rendered.durationSec,
      seed: composed.seed,
      warnings
    }
  }
}
