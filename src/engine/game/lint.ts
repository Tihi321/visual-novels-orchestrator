import fs from 'node:fs'
import path from 'node:path'
import type { GameData } from './emit'

/**
 * Native game linter and statistics reporter for the Visual Novel Web Engine.
 */

export interface LintResult {
  ok: boolean
  messages: string[]
  /** Non-fatal findings (a picture-book page without text, sprite or CG entries left over in a picture book). */
  warnings: string[]
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
  const warnings: string[] = []

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
      warnings,
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
      warnings,
      statistics: '',
      output: messages.join('\n'),
      code: 1
    }
  }

  // A picture book is a page per scene (missing presentation, as in an old game-data.json, is a visual novel)
  const pictureBook = data.presentation === 'picture-book'

  const chapterNumbers = new Set(data.chapters.map((c) => c.number))
  let dialogueBlocks = 0
  let wordCount = 0
  let charCount = 0
  let menuCount = 0
  let pageCount = 0
  let spriteEntries = 0
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

      let pageTextBeats = 0
      let pageImageCue = false
      for (const b of sc.beats ?? []) {
        if (b.type === 'line' || b.type === 'narration') {
          dialogueBlocks++
          const text = b.text ?? ''
          if (text.trim()) pageTextBeats++
          charCount += text.length
          const words = text.trim() ? text.trim().split(/\s+/).length : 0
          wordCount += words
        }

        if (b.type === 'puzzle') {
          if (!b.puzzleKey || !data.puzzles?.[b.puzzleKey]) {
            messages.push(`Beat ${b.id}: references unknown puzzle key: ${b.puzzleKey}`)
          }
        }
        // a CG or insert cue is visual-novel machinery: a picture book shows the scene in its page image
        if (pictureBook && b.stage && b.stage.cg) pageImageCue = true
      }

      if (pictureBook) {
        pageCount++
        // a page without an illustration (no background picture at all) is an error: nothing can be shown
        if (!sc.bgPath) messages.push(`Page ${sc.id}: no illustration (the page has no picture)`)
        if (!pageTextBeats) warnings.push(`Page ${sc.id}: no text (a picture-only page)`)
        if (pageImageCue) {
          warnings.push(`Page ${sc.id}: shows a CG or insert cue, which a picture book does not use`)
        }
      }
    }
  }

  // Validate characters & sprites
  for (const [charKey, char] of Object.entries(data.characters ?? {})) {
    for (const [expr, relPath] of Object.entries(char.sprites ?? {})) {
      spriteEntries++
      if (pictureBook) continue
      referencedImages.add(relPath)
      const fullPath = path.join(baseDir, relPath)
      if (!fs.existsSync(fullPath)) {
        messages.push(`Character ${charKey} expression ${expr}: sprite file missing: ${relPath}`)
      }
    }
  }
  if (pictureBook && spriteEntries > 0) warnings.push(`The game has ${spriteEntries} sprite(s): a picture book draws its characters into the page image and shows no sprites`)
  if (pictureBook && Object.keys(data.cgs ?? {}).length > 0) {
    warnings.push(`The game has ${Object.keys(data.cgs).length} CG(s): a picture book has one image per page and no CG layer`)
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

  let statistics = pictureBook
    ? `Statistics:\n\nThe game contains ${pageCount} pages, containing ${wordCount} words and ${charCount} characters, for an average of ${avgWords} words and ${avgChars} characters per page.\nThe game contains ${menuCount} menus and ${imageCount} images.`
    : `Statistics:\n\nThe game contains ${dialogueBlocks} dialogue blocks, containing ${wordCount} words and ${charCount} characters, for an average of ${avgWords} words and ${avgChars} characters per block.\nThe game contains ${menuCount} menus, ${imageCount} images, and ${chapterCount} chapters.`
  if (tlStats.length > 0) {
    statistics += `\n\n${tlStats.join('\n')}`
  }

  const findings = [...messages, ...warnings.map((w) => `warning: ${w}`)]
  const output = findings.length > 0 ? `${findings.join('\n')}\n\n${statistics}` : statistics
  const ok = messages.length === 0

  return {
    ok,
    messages,
    warnings,
    statistics,
    output,
    code: ok ? 0 : 1
  }
}
