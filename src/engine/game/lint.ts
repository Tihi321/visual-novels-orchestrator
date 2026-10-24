import fs from 'node:fs'
import path from 'node:path'
import type { GameData } from './emit'

/**
 * Native game linter and statistics reporter for the Visual Novel Web Engine.
 */

export interface LintResult {
  ok: boolean
  messages: string[]
  statistics: string
  output: string
  code: number | null
}

export function parseLint(output: string): { statistics: string; messages: string[] } {
  const text = output.charCodeAt(0) === 0xfeff ? output.slice(1) : output
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^Statistics:/i.test(l.trim()))
  const head = start >= 0 ? lines.slice(0, start) : lines
  const statistics = start >= 0 ? lines.slice(start).join('\n').trim() : ''
  const messages = head
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '' && !/^Ren'Py .* lint report/i.test(l.trim()) && !/^VNO .* lint report/i.test(l.trim()))
  return { statistics, messages }
}

/**
 * Native linter for visual novel projects.
 * Inspects game-data.json and validates files, scenes, choices, puzzles, and assets.
 */
export async function lint(gameDir: string, _opts: { sdkPath?: string; timeoutMs?: number } = {}): Promise<LintResult> {
  const messages: string[] = []

  // Locate game-data.json (either directly in gameDir or in gameDir/game)
  let baseDir = gameDir
  let dataPath = path.join(gameDir, 'game-data.json')
  if (!fs.existsSync(dataPath) && fs.existsSync(path.join(gameDir, 'game', 'game-data.json'))) {
    baseDir = path.join(gameDir, 'game')
    dataPath = path.join(baseDir, 'game-data.json')
  }

  if (!fs.existsSync(dataPath)) {
    messages.push(`game-data.json not found in ${gameDir}`)
    return {
      ok: false,
      messages,
      statistics: '',
      output: messages.join('\n'),
      code: 1
    }
  }

  // Check essential runtime bundle files
  const requiredFiles = ['index.html', 'player.js', 'player.css', 'game-data.json']
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(baseDir, f))) {
      messages.push(`Required file missing: ${f}`)
    }
  }

  let data: GameData
  try {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  } catch (e) {
    messages.push(`Failed to parse game-data.json: ${(e as Error).message}`)
    return {
      ok: false,
      messages,
      statistics: '',
      output: messages.join('\n'),
      code: 1
    }
  }

  const chapterNumbers = new Set(data.chapters.map((c) => c.number))
  let dialogueBlocks = 0
  let wordCount = 0
  let charCount = 0
  let menuCount = 0
  const referencedImages = new Set<string>()

  // Validate chapters, scenes and beats
  for (const ch of data.chapters) {
    if ((!ch.scenes || ch.scenes.length === 0) && (!ch.choices || ch.choices.length === 0) && !ch.ending) {
      messages.push(`Chapter ${ch.number} (${ch.title}) has no scenes, choices, or ending`)
    }

    if (ch.choices && ch.choices.length > 0) {
      menuCount++
      for (const choice of ch.choices) {
        if (!chapterNumbers.has(choice.targetChapterId)) {
          messages.push(`Chapter ${ch.number}: choice "${choice.text}" targets non-existent chapter ${choice.targetChapterId}`)
        }
      }
    }

    for (const sc of ch.scenes ?? []) {
      if (sc.bgPath) {
        referencedImages.add(sc.bgPath)
        const fullBgPath = path.join(baseDir, sc.bgPath)
        if (!fs.existsSync(fullBgPath)) {
          messages.push(`Scene ${sc.id}: background file missing: ${sc.bgPath}`)
        }
      }

      for (const b of sc.beats ?? []) {
        if (b.type === 'line' || b.type === 'narration') {
          dialogueBlocks++
          const text = b.text ?? ''
          charCount += text.length
          const words = text.trim() ? text.trim().split(/\s+/).length : 0
          wordCount += words
        }

        if (b.type === 'puzzle') {
          if (!b.puzzleKey || !data.puzzles?.[b.puzzleKey]) {
            messages.push(`Beat ${b.id}: references unknown puzzle key: ${b.puzzleKey}`)
          }
        }
      }
    }
  }

  // Validate characters & sprites
  for (const [charKey, char] of Object.entries(data.characters ?? {})) {
    for (const [expr, relPath] of Object.entries(char.sprites ?? {})) {
      referencedImages.add(relPath)
      const fullPath = path.join(baseDir, relPath)
      if (!fs.existsSync(fullPath)) {
        messages.push(`Character ${charKey} expression ${expr}: sprite file missing: ${relPath}`)
      }
    }
  }

  // Validate CGs
  for (const [cgKey, cg] of Object.entries(data.cgs ?? {})) {
    referencedImages.add(cg.path)
    const fullPath = path.join(baseDir, cg.path)
    if (!fs.existsSync(fullPath)) {
      messages.push(`CG ${cgKey}: image file missing: ${cg.path}`)
    }
  }

  // Validate Audio
  for (const [musicKey, item] of Object.entries(data.audio?.music ?? {})) {
    const fullPath = path.join(baseDir, item.path)
    if (!fs.existsSync(fullPath)) {
      messages.push(`Music track ${musicKey}: audio file missing: ${item.path}`)
    }
  }

  for (const [sfxKey, relPath] of Object.entries(data.audio?.sfx ?? {})) {
    const fullPath = path.join(baseDir, relPath)
    if (!fs.existsSync(fullPath)) {
      messages.push(`Sound effect ${sfxKey}: audio file missing: ${relPath}`)
    }
  }

  for (const [ambKey, relPath] of Object.entries(data.audio?.ambience ?? {})) {
    const fullPath = path.join(baseDir, relPath)
    if (!fs.existsSync(fullPath)) {
      messages.push(`Ambience track ${ambKey}: audio file missing: ${relPath}`)
    }
  }

  // Compute Statistics
  const avgWords = dialogueBlocks > 0 ? (wordCount / dialogueBlocks).toFixed(1) : '0.0'
  const avgChars = dialogueBlocks > 0 ? (charCount / dialogueBlocks).toFixed(1) : '0.0'
  const imageCount = referencedImages.size
  const chapterCount = data.chapters.length

  const tlDir = path.join(baseDir, 'tl')
  const tlStats: string[] = []
  if (fs.existsSync(tlDir)) {
    for (const entry of fs.readdirSync(tlDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        tlStats.push(`The ${entry.name} translation contains ${dialogueBlocks} dialogue blocks.`)
      }
    }
  }

  let statistics = `Statistics:\n\nThe game contains ${dialogueBlocks} dialogue blocks, containing ${wordCount} words and ${charCount} characters, for an average of ${avgWords} words and ${avgChars} characters per block.\nThe game contains ${menuCount} menus, ${imageCount} images, and ${chapterCount} chapters.`
  if (tlStats.length > 0) {
    statistics += `\n\n${tlStats.join('\n')}`
  }

  const output = messages.length > 0 ? `${messages.join('\n')}\n\n${statistics}` : statistics
  const ok = messages.length === 0

  return {
    ok,
    messages,
    statistics,
    output,
    code: ok ? 0 : 1
  }
}
