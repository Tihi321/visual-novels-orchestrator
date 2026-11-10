import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * A seamless loop for music made by ComfyUI (ACE-Step): the song ends with its own fade-out and starts from silence, so repeating it clicks or dips.
 * The last `crossfadeSec` are mixed into the start with an equal-power curve and then cut off, so the file's end flows straight into its start:
 * the result is `crossfadeSec` shorter, plays from 0 (`loopStartSec` 0) and loops at its end (`loopEndSec`). Needs ffmpeg (`FFMPEG_PATH`, else on PATH).
 */
export const LOOP_CROSSFADE_SEC = 3
/** A song shorter than this is not looped (the crossfade would eat most of it). */
const MIN_LOOP_SOURCE_SEC = 4

export interface SeamlessLoop {
  bytes: Buffer
  ext: string
  loopStartSec: 0
  loopEndSec: number
  durationSec: number
}

const ffmpegPath = (): string => process.env.FFMPEG_PATH || 'ffmpeg'

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${(stderr || err.message).toString().trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`))
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** The length of an audio file in seconds, read from ffmpeg's own report. */
async function durationOf(file: string): Promise<number> {
  const r = await new Promise<string>((resolve) => execFile(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true, timeout: 60_000 }, (_e, _o, stderr) => resolve(String(stderr))))
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r)
  if (!m) throw new Error('ffmpeg could not read the length of the song')
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** The encoder arguments of an output extension (ogg and mp3 get a good quality; wav and the rest take ffmpeg's default). */
const encoderArgs = (ext: string): string[] => (ext === 'ogg' ? ['-c:a', 'libvorbis', '-q:a', '6'] : ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : [])

/**
 * Crossfades the end of `input` into its start. Returns null when the song is too short to loop. Throws when ffmpeg is missing or fails
 * (the caller keeps the original file and says so).
 */
export async function makeSeamlessLoop(input: { bytes: Buffer; ext: string }, o: { crossfadeSec?: number } = {}): Promise<SeamlessLoop | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vno-loop-'))
  try {
    const src = path.join(dir, `in.${input.ext}`)
    const dst = path.join(dir, `out.${input.ext}`)
    await fs.writeFile(src, input.bytes)
    const total = await durationOf(src)
    if (total < MIN_LOOP_SOURCE_SEC) return null
    const x = Math.min(o.crossfadeSec ?? LOOP_CROSSFADE_SEC, total / 4)
    const cut = total - x
    // tail (the last x seconds) fades out while the start of the song (up to the cut) fades in: equal power (quarter sine both ways)
    const graph = `[0:a]atrim=start=${cut.toFixed(4)},asetpts=PTS-STARTPTS[t];[0:a]atrim=end=${cut.toFixed(4)},asetpts=PTS-STARTPTS[h];[t][h]acrossfade=d=${x.toFixed(4)}:c1=qsin:c2=qsin[o]`
    await run(ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-filter_complex', graph, '-map', '[o]', ...encoderArgs(input.ext), dst])
    const bytes = await fs.readFile(dst)
    const durationSec = Number(cut.toFixed(3))
    return { bytes, ext: input.ext, loopStartSec: 0, loopEndSec: durationSec, durationSec }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
