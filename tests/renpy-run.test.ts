import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lint, parseLint } from '../src/engine/game/lint'
import { run } from '../src/engine/game/run'

const REPORT_OK = `\uFEFFRen'Py 8.5.3.26051504 lint report, generated at: Thu Oct 15 14:44:47 2026


Statistics:

The game contains 9 dialogue blocks, containing 46 words and 236 characters,
for an average of 5.1 words and 26 characters per block.

Lint is not a substitute for thorough testing.
`

const REPORT_BAD = `\uFEFFRen'Py 8.5.3.26051504 lint report, generated at: Thu Oct 15 14:44:06 2026

game/ch01.rpy:12 The image 'bg nowhere' is not known.

game/theme.rpy:6 define gui.accent_color already defined at game/gui.rpy:28


Statistics:

The game contains 1 dialogue blocks.
`

describe('parseLint', () => {
  it('a clean report has no messages and keeps the statistics', () => {
    const r = parseLint(REPORT_OK)
    expect(r.messages).toEqual([])
    expect(r.statistics).toContain('9 dialogue blocks')
  })

  it('problems are the lines between the header and the statistics', () => {
    const r = parseLint(REPORT_BAD)
    expect(r.messages).toEqual(["game/ch01.rpy:12 The image 'bg nowhere' is not known.", 'game/theme.rpy:6 define gui.accent_color already defined at game/gui.rpy:28'])
  })
})

describe('native lint and run', () => {
  it('lint on an unbuilt directory reports missing game-data.json', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-lint-empty-'))
    try {
      const res = await lint(emptyDir)
      expect(res.ok).toBe(false)
      expect(res.code).toBe(1)
      expect(res.messages.join(' ')).toContain('game-data.json not found')
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('lint validates a clean game bundle and computes statistics', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-lint-bundle-'))
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '<!DOCTYPE html>')
      fs.writeFileSync(path.join(dir, 'player.js'), '// player')
      fs.writeFileSync(path.join(dir, 'player.css'), '/* css */')
      fs.writeFileSync(
        path.join(dir, 'game-data.json'),
        JSON.stringify({
          title: 'Test Game',
          chapters: [
            {
              number: 1,
              title: 'Chapter 1',
              scenes: [
                {
                  id: 'sc1',
                  beats: [
                    { id: 'b1', type: 'narration', text: 'Once upon a time.' },
                    { id: 'b2', type: 'line', text: 'Hello world.' }
                  ]
                }
              ]
            }
          ]
        })
      )
      const res = await lint(dir)
      expect(res.ok).toBe(true)
      expect(res.code).toBe(0)
      expect(res.messages).toEqual([])
      expect(res.statistics).toContain('The game contains 2 dialogue blocks')
      expect(res.statistics).toContain('6 words and 29 characters')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lint reports missing referenced asset files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-lint-missing-'))
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '')
      fs.writeFileSync(path.join(dir, 'player.js'), '')
      fs.writeFileSync(path.join(dir, 'player.css'), '')
      fs.writeFileSync(
        path.join(dir, 'game-data.json'),
        JSON.stringify({
          title: 'Test Game',
          chapters: [
            {
              number: 1,
              title: 'Chapter 1',
              scenes: [
                {
                  id: 'sc1',
                  bgPath: 'images/bg_missing.webp',
                  beats: [{ id: 'b1', type: 'narration', text: 'Darkness.' }]
                }
              ]
            }
          ]
        })
      )
      const res = await lint(dir)
      expect(res.ok).toBe(false)
      expect(res.messages.join(' ')).toContain('background file missing: images/bg_missing.webp')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('run fails when game is not built and returns URL when built', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-run-'))
    try {
      expect(() => run(dir)).toThrow(/Game not built/)
      fs.writeFileSync(path.join(dir, 'index.html'), '<!DOCTYPE html>')
      const res = run(dir)
      expect(res.url).toMatch(/^file:\/\//)
      expect(res.indexHtml).toBe(path.join(dir, 'index.html'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
