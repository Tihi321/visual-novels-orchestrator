import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { makeSeamlessLoop } from '../src/engine/studios/loop'

const hasFfmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']).status === 0
const dir = mkdtempSync(path.join(os.tmpdir(), 'vno-loop-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** The samples of a 16-bit PCM wav (the `data` chunk). */
function pcm(wav: Buffer): Float64Array {
  const at = wav.indexOf('data')
  const n = wav.readUInt32LE(at + 4)
  const out = new Float64Array(Math.floor(n / 2))
  for (let i = 0; i < out.length; i++) out[i] = wav.readInt16LE(at + 8 + i * 2) / 32768
  return out
}

describe('C10: ComfyUI music loops seamlessly', () => {
  it.skipIf(!hasFfmpeg)('crossfades the fade-out into the start: the seam is no rougher than any other 50 ms step', async () => {
    // a 440 Hz tone with an ACE-Step like fade-out: 12 s, loud at the start, silent at the end
    const src = path.join(dir, 'tone.wav')
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=12:r=44100', '-af', 'volume=4,afade=t=out:st=9:d=3', '-ac', '1', src])
    const loop = await makeSeamlessLoop({ bytes: readFileSync(src), ext: 'wav' })
    expect(loop).not.toBeNull()
    expect(loop!.loopStartSec).toBe(0)
    expect(loop!.loopEndSec).toBeCloseTo(9, 1) // 12 s minus the 3 s crossfade

    const win = Math.round(44100 * 0.05)
    const rmsOf = (x: Float64Array, from: number) => Math.sqrt(x.slice(from, from + win).reduce((a, v) => a + v * v, 0) / win)
    const seamStep = (x: Float64Array) => Math.abs(rmsOf(x, x.length - win) - rmsOf(x, 0))
    const otherSteps = (x: Float64Array) => Array.from({ length: Math.floor(x.length / win) - 1 }, (_v, i) => Math.abs(rmsOf(x, (i + 1) * win) - rmsOf(x, i * win)))

    const before = pcm(readFileSync(src))
    const after = pcm(loop!.bytes)
    expect(seamStep(before)).toBeGreaterThan(0.2) // the raw song jumps from silence to full volume
    expect(seamStep(after)).toBeLessThanOrEqual(Math.max(...otherSteps(after)))
    expect(seamStep(after)).toBeLessThan(0.01)
  })
})
