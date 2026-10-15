import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alignEdition } from '../src/engine/vn/align'
import { importBook } from '../src/engine/vn/import'
import { detectLanguage } from '../src/engine/vn/lang'
import { editionSchema } from '../src/shared/vn'

const books = join(__dirname, 'fixtures', 'books')

describe('alignEdition', () => {
  it('aligns the Croatian translation cleanly', async () => {
    const en = await importBook(join(books, 'linear-en'))
    const hr = await importBook(join(books, 'linear-hr'))
    expect(hr.detected.lang).toBe('hr')
    expect(detectLanguage('Kiša bode sivu vodu. Rekao je da će se vratiti.').lang).toBe('hr')

    const { edition, report } = await alignEdition(en.book, join(books, 'linear-hr'), 'hr')
    expect(editionSchema.safeParse(edition).success).toBe(true)
    expect(report.missing).toEqual([])
    expect(report.extra).toEqual([])
    expect(report.warnings).toEqual([])
    expect(report.matched).toBe(Object.keys(en.edition.beats).length)
    expect(Object.keys(edition.beats).sort()).toEqual(Object.keys(en.edition.beats).sort())
    expect(report.nameMap).toEqual({ mara: 'Mara', tomas: 'Tomo' })
    expect(report.placeMap).toEqual({ harbour_wall: 'Lukobran', lighthouse_kitchen: 'Kuhinja svjetionika' })
    expect(edition.lang).toBe('hr')
    expect(edition.title).toBe('Pisma sa svjetionika')
    expect(edition.chapterTitles).toEqual({ 1: 'Zakašnjela lađa', 2: 'Pismo', 3: 'Svjetiljka' })
    expect(edition.beats['ch01.s01.b003']).toBe('Rekao je da će se vratiti prije nego što se svjetiljka upali.')
    expect(edition.beats['ch01.s01.b008']).toBe('Lađa je bila spora. Našao sam nešto na stijenama.')
    expect(edition.characterNames.tomas).toBe('Tomo')
  })

  it('reports exactly the one missing beat', async () => {
    const en = await importBook(join(books, 'linear-en'))
    const { edition, report } = await alignEdition(en.book, join(books, 'linear-hr-missing'), 'hr')
    // MARA (annoyed): You're *late*.
    expect(en.edition.beats['ch01.s01.b007']).toBe("You're *late*.")
    expect(report.missing).toEqual(['ch01.s01.b007'])
    expect(report.extra).toEqual([])
    expect(report.matched).toBe(Object.keys(en.edition.beats).length - 1)
    expect(edition.beats['ch01.s01.b007']).toBeUndefined()
    // the lines after the gap still line up
    expect(edition.beats['ch01.s01.b008']).toBe('Lađa je bila spora. Našao sam nešto na stijenama.')
  })

  it('aligns the other way round (English as the translation of Croatian)', async () => {
    const en = await importBook(join(books, 'linear-hr'))
    // Primary = the Croatian book, "translation" = the English one:
    const { report } = await alignEdition(en.book, join(books, 'linear-en'), 'en')
    expect(report.missing).toEqual([])
    expect(report.nameMap).toEqual({ mara: 'Mara', tomo: 'Tomas' })
  })
})
