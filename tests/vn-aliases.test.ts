import { describe, expect, it } from 'vitest'
import { emitScripts, translatableStrings } from '../src/engine/renpy/emit'
import { defaultCues } from '../src/engine/renpy/stage'
import { aliasIndex, extractAliases, mergeBibleAliases } from '../src/engine/vn/aliases'
import type { Decision } from '../src/engine/vn/agents/script-analyst'
import { parseBible } from '../src/engine/vn/bible'
import { applyDecisions } from '../src/engine/vn/fixes'
import { buildEdition } from '../src/engine/vn/import'
import { matchCharacter, parseChapterScript } from '../src/engine/vn/script'
import { applyStoryOps, buildBook, storyInputSchema } from '../src/engine/vn/story'
import type { Uncertain } from '../src/engine/vn/script'
import type { VnBook } from '../src/shared/vn'

/** The bible of the Clockless God choice VN, cut down to the people in question. */
const BIBLE = `## Characters
- **Kessler**: Fifty, heavy-set, bald, a grey moustache, a dark overcoat. Narration calls him 'the bald man' until Roux says his name.
- **The bald man**: Heavy-set, bald, a grey moustache and a dark overcoat.
- **Fabien**: Twenty-six, thin, pale, a grey jacket. Narration calls him "the young man in grey".
- **The young man in grey**: Thin, pale, a grey jacket.
- **Dec**: Thirty-four, wiry, dark hair. Declan Hartley from Galway.
- **Declan Hartley**: Wiry, dark hair, from Galway.
- **Inès**: Twenty-nine, a red scarf, a black coat. Zoltán brought her the letter.
- **Zoltán Varga**: Tall, silver hair, a grey suit.
- **Roux**: Anselme Roux, a clockmaker with spectacles and ink on his fingers.
- **Brother Anselme Vey**: A monk in a brown habit with a shaved head.

## Places
- **The workshop**: A cramped room full of clocks.
`

describe('alias extraction', () => {
  it('reads quoted names after calls him, known as, called, nicknamed and the Croatian words, and an Aliases sentence', () => {
    expect(extractAliases("Narration calls him 'the bald man' until later.", 'Kessler')).toEqual(['the bald man'])
    expect(extractAliases('She is known as "Rusty" and also called “the Fox”.', 'Mara')).toEqual(['Rusty', 'the Fox'])
    expect(extractAliases('A boy nicknamed \'Pip\'. Zovu ga "Brko" u selu. Poznat kao \'Stari\'.', 'Ivo')).toEqual(['Pip', 'Brko', 'Stari'])
    expect(extractAliases('Tall. Aliases: the stranger, Mr Grey or the Visitor.', 'Tom')).toEqual(['the stranger', 'Mr Grey', 'the Visitor'])
    expect(extractAliases('Also: Rusty.', 'Mara')).toEqual(['Rusty'])
    // the name itself, and a bare quote, are not aliases
    expect(extractAliases("Called 'Mara' by everyone. She said 'hello'.", 'Mara')).toEqual([])
  })
  it('parseBible keeps the aliases an entry gives', () => {
    const b = parseBible(BIBLE)
    expect(b.characters.find((c) => c.key === 'kessler')!.aliases).toEqual(['the bald man'])
    expect(b.characters.find((c) => c.key === 'fabien')!.aliases).toEqual(['the young man in grey'])
    expect(b.characters.find((c) => c.key === 'dec')!.aliases).toBeUndefined()
  })
})

describe('mergeBibleAliases', () => {
  const merged = mergeBibleAliases(parseBible(BIBLE))

  it('merges the three pairs into Kessler, Fabien and Dec, and says why', () => {
    expect(merged.bible.characters.map((c) => c.key)).toEqual(['kessler', 'fabien', 'dec', 'ines', 'zoltan_varga', 'roux', 'brother_anselme_vey'])
    const by = (k: string) => merged.bible.characters.find((c) => c.key === k)!
    expect(by('kessler').aliases).toEqual(['the bald man'])
    expect(by('fabien').aliases).toEqual(['the young man in grey'])
    expect(by('dec').aliases).toEqual(['Declan Hartley'])
    expect(merged.merged).toEqual([
      { alias: 'The bald man', into: 'kessler', reason: "named in Kessler's entry" },
      { alias: 'The young man in grey', into: 'fabien', reason: "named in Fabien's entry" },
      { alias: 'Declan Hartley', into: 'dec', reason: "named in Dec's entry" }
    ])
    // A keeps its own looks
    expect(by('kessler').looks).toMatch(/^Fifty, heavy-set, bald/)
  })
  it('does not merge Zoltán Varga (only "Zoltán" is in Inès’s text) or Brother Anselme Vey (not Anselme Roux)', () => {
    const keys = merged.bible.characters.map((c) => c.key)
    expect(keys).toContain('zoltan_varga')
    expect(keys).toContain('brother_anselme_vey')
    expect(merged.merged.map((m) => m.alias)).not.toContain('Zoltán Varga')
    expect(merged.merged.map((m) => m.alias)).not.toContain('Brother Anselme Vey')
  })
  it('an entry whose text starts with the other name as its first sentence is merged ("Dec. 34, from Galway")', () => {
    const b = mergeBibleAliases(parseBible('## Characters\n- **Dec**: Thirty-four, wiry.\n- **Dec Hartley**: Dec. 34, from Galway, wiry.\n'))
    expect(b.bible.characters.map((c) => c.key)).toEqual(['dec'])
    expect(b.merged[0]).toMatchObject({ alias: 'Dec Hartley', into: 'dec', reason: 'its text starts with the name Dec' })
    expect(b.bible.characters[0]!.aliases).toEqual(['Dec Hartley'])
  })
  it('two people who mention each other are not merged', () => {
    const b = mergeBibleAliases(parseBible('## Characters\n- **Mara**: Tall. Her husband Tomas Vane is a fisherman.\n- **Tomas Vane**: Short. Married to Mara.\n'))
    expect(b.bible.characters.map((c) => c.key)).toEqual(['mara', 'tomas_vane'])
    expect(b.merged).toEqual([])
  })
  it('entries that only share looks are reported for the analyst, not merged', () => {
    const b = mergeBibleAliases(parseBible('## Characters\n- **Anselme**: Tall, bald, a grey moustache, a dark coat, black boots.\n- **The notary**: Tall, bald, a grey moustache, a dark coat.\n'))
    expect(b.bible.characters).toHaveLength(2)
    expect(b.merged).toEqual([])
    expect(b.suspects).toHaveLength(1)
    expect(b.suspects[0]).toMatchObject({ alias: expect.objectContaining({ key: 'the_notary' }), of: expect.objectContaining({ key: 'anselme' }) })
  })
})

describe('aliases in the script', () => {
  const bible = mergeBibleAliases(parseBible(BIBLE)).bible
  it('a speaker label that is an alias maps to the character and keeps its words', () => {
    expect(matchCharacter('THE BALD MAN', bible.characters)).toBe('kessler')
    expect(matchCharacter('Declan Hartley', bible.characters)).toBe('dec')
    const p = parseChapterScript('SCENE: The workshop, night\nA room.\nTHE BALD MAN: Where is the key?\nKESSLER (angry): Now you know my name.\n', { chapter: 1, bible })
    const lines = p.scenes[0]!.beats.filter((b) => b.type === 'line')
    expect(lines.map((b) => (b.type === 'line' ? [b.speakerKey, b.speakerLabel] : []))).toEqual([['kessler', 'THE BALD MAN'], ['kessler', 'KESSLER']])
    expect(p.uncertain.filter((u) => u.kind === 'speaker')).toEqual([])
  })
  it('aliasIndex finds the alias of a label, and 0 for the name itself', () => {
    const c = { name: 'Kessler', aliases: ['the bald man', 'the old fox'] }
    expect(aliasIndex(c, 'The Bald Man')).toBe(1)
    expect(aliasIndex(c, 'THE OLD FOX')).toBe(2)
    expect(aliasIndex(c, 'kessler')).toBe(0)
    expect(aliasIndex(c, 'someone else')).toBe(0)
  })
})

describe('aliases in the story JSON', () => {
  const make = (): VnBook =>
    buildBook(
      storyInputSchema.parse({
        title: 'The Clock',
        characters: [{ name: 'Kessler', looks: 'a heavy bald man in a dark overcoat', aliases: ['the bald man', 'Kessler'] }, { name: 'Roux', looks: 'a clockmaker' }],
        places: [{ name: 'Workshop', looks: 'a room of clocks' }],
        chapters: [
          {
            title: 'Night',
            scenes: [
              {
                place: 'workshop',
                beats: [
                  { cast: ['kessler', 'roux'] },
                  { speaker: 'the bald man', text: 'Where is the key?' },
                  { speaker: 'Roux', text: 'Mr Kessler, please.' },
                  { speaker: 'Kessler', text: 'Now you know.' }
                ]
              }
            ]
          }
        ]
      }),
      { slug: 'clock', lang: 'en' }
    ).book

  it('keeps aliases (not the name itself), maps a line spoken under one to the character and keeps its label', () => {
    const book = make()
    expect(book.characters[0]!.aliases).toEqual(['the bald man'])
    expect(book.characters[1]!.aliases).toBeUndefined()
    const lines = book.chapters[0]!.scenes[0]!.beats.filter((b) => b.type === 'line')
    expect(lines.map((b) => (b.type === 'line' ? [b.speakerKey, b.speakerLabel] : []))).toEqual([['kessler', 'the bald man'], ['roux', 'Roux'], ['kessler', 'Kessler']])
  })

  it('character.set aliases round-trips: set, replace, clear with null; a rename keeps an alias label', () => {
    const book = make()
    const set = applyStoryOps(book, [{ op: 'character.set', key: 'kessler', aliases: ['the bald man', 'the old fox'] }]).book
    expect(set.characters[0]!.aliases).toEqual(['the bald man', 'the old fox'])
    const renamed = applyStoryOps(set, [{ op: 'character.set', key: 'kessler', name: 'Hans Kessler' }]).book
    const labels = renamed.chapters[0]!.scenes[0]!.beats.flatMap((b) => (b.type === 'line' && b.speakerKey === 'kessler' ? [b.speakerLabel] : []))
    expect(labels).toEqual(['the bald man', 'Hans Kessler'])
    const speaker = applyStoryOps(renamed, [{ op: 'beat.update', beatId: 'ch01.s01.b003', speaker: 'the old fox' }]).book
    expect(speaker.chapters[0]!.scenes[0]!.beats[2]).toMatchObject({ speakerKey: 'kessler', speakerLabel: 'the old fox' })
    const cleared = applyStoryOps(renamed, [{ op: 'character.set', key: 'kessler', aliases: null }]).book
    expect(cleared.characters[0]!.aliases).toBeUndefined()
    // the name itself is not an alias
    expect(applyStoryOps(set, [{ op: 'character.set', key: 'kessler', aliases: ['kessler', 'the fox'] }]).book.characters[0]!.aliases).toEqual(['the fox'])
  })

  it('the emitted game has a Character for the alias, with the same sprite, and the say uses it', () => {
    const book = make()
    const edition = buildEdition('en', book.title, book.chapters, book.characters)
    const out = emitScripts({ book, editions: [edition], cues: defaultCues(book) })
    const characters = out.files['characters.rpy']!
    expect(characters).toContain('define kessler = Character(_("Kessler")')
    expect(characters).toContain('define kessler__a1 = Character(_("the bald man"), kind=kessler)')
    const ch = out.files['ch01.rpy']!
    expect(ch).toContain('kessler__a1 "Where is the key?"')
    expect(ch).toContain('kessler "Now you know."')
    // the sprite tag is the character's: nothing was shown for the alias
    expect(ch).not.toContain('kessler__a1 neutral')
    // the alias name is translatable, under <key>#<n>
    const strings = translatableStrings(book, {})
    expect(strings.some((s) => s.what === 'alias 1 of kessler' && s.old === 'the bald man')).toBe(true)
    const fr = { ...edition, lang: 'fr', characterNames: { ...edition.characterNames, 'kessler#1': "l'homme chauve" } }
    expect(strings.find((s) => s.what === 'alias 1 of kessler')!.pick(fr)).toBe("l'homme chauve")
    // an alias nobody speaks under gets nothing
    expect(characters).not.toContain('__a2')
  })
})

describe('the script-analyst merges look-alike entries (aliasOf)', () => {
  const book = (): VnBook =>
    buildBook(
      storyInputSchema.parse({
        title: 'T',
        characters: [{ name: 'Anselme', looks: 'a tall bald man with a grey moustache' }, { name: 'The notary', looks: 'a tall bald man with a grey moustache' }],
        places: [{ name: 'Hall' }],
        chapters: [{ title: 'C', scenes: [{ place: 'hall', beats: [{ cast: ['anselme', 'the_notary'] }, { speaker: 'The notary', text: 'Sign here.' }, { speaker: 'Anselme', text: 'No.' }] }] }]
      }),
      { slug: 't', lang: 'en' }
    ).book
  const item: Uncertain = { kind: 'alias', chapter: 0, sceneId: '', text: 'The notary', reason: 'described with the same words', charKey: 'anselme' }
  const decision = (aliasOf: string | null): Decision => ({ index: 0, placeKey: null, newPlace: null, time: null, charKey: null, newCharacter: null, expression: null, isDirection: false, aliasOf })

  it('merges the entry into the named character: speakers and cast follow, the label stays', () => {
    const b = book()
    const ed = buildEdition('en', b.title, b.chapters, b.characters)
    const r = applyDecisions(b, ed, [item], [decision('anselme')])
    expect(r.applied).toBe(1)
    expect(r.unresolved).toEqual([])
    expect(r.book.characters.map((c) => c.key)).toEqual(['anselme'])
    expect(r.book.characters[0]!.aliases).toEqual(['The notary'])
    const beats = r.book.chapters[0]!.scenes[0]!.beats
    expect(beats[0]).toMatchObject({ type: 'cast', cast: [{ charKey: 'anselme' }] })
    expect(beats[1]).toMatchObject({ speakerKey: 'anselme', speakerLabel: 'The notary' })
    expect(r.edition!.characterNames).toEqual({ anselme: 'Anselme' })
    expect(r.notes[0]).toMatch(/aliases merged: The notary -> anselme/)
  })
  it('different people (aliasOf null) are left alone and the item stays unresolved', () => {
    const b = book()
    const r = applyDecisions(b, undefined, [item], [decision(null)])
    expect(r.applied).toBe(0)
    expect(r.unresolved).toEqual([item])
    expect(r.book.characters).toHaveLength(2)
  })
  it('an unknown key is refused', () => {
    const r = applyDecisions(book(), undefined, [item], [decision('nobody')])
    expect(r.applied).toBe(0)
    expect(r.book.characters).toHaveLength(2)
  })
})
