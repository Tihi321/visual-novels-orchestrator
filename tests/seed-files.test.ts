import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { SEED_HASHES_FILE, seedHash } from '../src/engine/store/seedRefresh'

const SEED = path.resolve(__dirname, '../seed')
// Built from parts: a backslash in a string literal is easy to lose, which is how the form feed got into the seed.
const FIXED = 'flowRepo: ' + ['C:', 'projects', 'Personal', 'flow-music-mcp'].join(path.win32.sep)
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

describe('seed files', () => {
  it('contain no control characters except newline, carriage return and tab (a `\f` in a Windows path is a form feed)', () => {
    const bad: string[] = []
    for (const file of walk(SEED)) {
      const text = fs.readFileSync(file, 'utf8')
      const at = [...text].findIndex((ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127 })
      if (at >= 0) bad.push(`${path.relative(SEED, file)}: U+${[...text][at]!.charCodeAt(0).toString(16).padStart(4, '0')} at ${at}`)
    }
    expect(bad).toEqual([])
  })

  it('an unedited copy of the old studios.md is refreshed with the fixed flowRepo', async () => {
    const data = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '.'), 'vno-seed-'))
    try {
      await initDataFolder(data, SEED)
      const dest = path.join(data, 'config', 'studios.md')
      const seed = fs.readFileSync(dest, 'utf8')
      expect(seed).toContain(FIXED)
      // A data folder made when the seed had the form feed: same file but damaged, with its hash recorded as the seed's.
      const damaged = seed.replace(FIXED, FIXED.slice(0, FIXED.indexOf(path.win32.sep + 'flow')) + String.fromCharCode(12) + 'low-music-mcp')
      fs.writeFileSync(dest, damaged)
      const hashes = JSON.parse(fs.readFileSync(path.join(data, SEED_HASHES_FILE), 'utf8'))
      hashes.files['config/studios.md'] = seedHash(damaged)
      fs.writeFileSync(path.join(data, SEED_HASHES_FILE), JSON.stringify(hashes))
      await initDataFolder(data, SEED)
      expect(fs.readFileSync(dest, 'utf8')).toContain(FIXED)
    } finally {
      fs.rmSync(data, { recursive: true, force: true })
    }
  })
})
