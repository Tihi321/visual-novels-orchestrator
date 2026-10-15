import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBible } from '../src/engine/vn/bible'
import { importBook } from '../src/engine/vn/import'
import { isDirectionLabel, parseChapterScript } from '../src/engine/vn/script'

const bible = parseBible('## Characters\n- **Mara**: a sailor\n\n## Places\n- **Harbour**: a pier\n')

describe('screenplay directions are not speakers', () => {
  it('recognises the direction labels', () => {
    for (const l of ['CUT TO', 'SMASH CUT TO', 'FADE IN', 'FADE OUT', 'FADE TO BLACK', 'DISSOLVE TO', 'INT.', 'EXT.', 'INT. KITCHEN - DAY', 'REZ', 'PRIJELAZ', 'PRIJELAZ NA']) {
      expect(isDirectionLabel(l), l).toBe(true)
    }
    for (const l of ['MARA', 'INTERN', 'GRUMBLE', 'NIB']) expect(isDirectionLabel(l), l).toBe(false)
  })

  it('keeps the text after the label as narration and flags no unknown speaker', () => {
    const body = ['SCENE: Harbour, dusk. A pier.', 'MARA (calm): Hello.', 'SMASH CUT TO: Mara drops the rope.', 'FADE OUT.', 'CUT TO:', 'PRIJELAZ NA: Mara ode.'].join('\n')
    const r = parseChapterScript(body, { chapter: 1, bible })
    const beats = r.scenes[0]!.beats
    expect(beats.map((b) => b.type)).toEqual(['line', 'narration', 'narration'])
    expect(beats[1]).toMatchObject({ type: 'narration', text: 'Mara drops the rope.' })
    expect(beats[2]).toMatchObject({ type: 'narration', text: 'Mara ode.' })
    expect(r.uncertain.filter((u) => u.kind === 'speaker')).toEqual([])
  })

  it('the soother fixture no longer has SMASH CUT TO as a speaker', async () => {
    const r = await importBook(path.resolve(__dirname, 'fixtures/books/soother'))
    const labels = r.book.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats.flatMap((b) => (b.type === 'line' ? [b.speakerLabel] : []))))
    expect(labels).not.toContain('SMASH CUT TO')
    expect(r.book.warnings.join(' ')).not.toContain('SMASH CUT TO')
    const ch7 = r.book.chapters.find((c) => c.n === 7)!
    const narrated = ch7.scenes.flatMap((s) => s.beats).some((b) => b.type === 'narration' && b.text.startsWith('Grumble sets the blue soother'))
    expect(narrated).toBe(true)
  })
})
