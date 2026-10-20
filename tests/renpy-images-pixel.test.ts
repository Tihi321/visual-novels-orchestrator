import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { buildImages } from '../src/engine/renpy/images'
import type { VnBook } from '../src/shared/vn'

let dir = ''
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

/** A 4x2 image with two flat colours, split down the middle. */
async function smallImage(file: string): Promise<void> {
  const red = [255, 0, 0]
  const blue = [0, 0, 255]
  const raw = Buffer.from([...red, ...red, ...blue, ...blue, ...red, ...red, ...blue, ...blue])
  await writeFile(file, await sharp(raw, { raw: { width: 4, height: 2, channels: 3 } }).png().toBuffer())
}

async function colours(file: string): Promise<Set<string>> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const set = new Set<string>()
  for (let i = 0; i < data.length; i += info.channels) set.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
  return set
}

describe('buildImages kernel', () => {
  for (const pixel of [true, false]) {
    it(`${pixel ? 'a pixel project keeps only the cover and background colours' : 'other projects blend them (default kernel)'}`, async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'vno-img-'))
      const img = path.join(dir, 'small.png')
      await smallImage(img)
      const sub = path.join(dir, 'game')
      const book = { title: 'T', characters: [] } as unknown as VnBook
      await buildImages({ gameSubdir: sub, book, used: { backgrounds: ['bg_hall_any'], sprites: [] }, resolveAsset: () => img, resolution: { w: 64, h: 36 }, format: 'png', warnings: [], pixel })
      const menu = await colours(path.join(sub, 'gui', 'main_menu.png'))
      const bg = await colours(path.join(sub, 'images', 'bg hall_any.png'))
      if (pixel) {
        expect([...menu].sort()).toEqual(['0,0,255', '255,0,0'])
        expect([...bg].sort()).toEqual(['0,0,255', '255,0,0'])
      } else {
        expect(menu.size).toBeGreaterThan(2)
      }
    })
  }
})
