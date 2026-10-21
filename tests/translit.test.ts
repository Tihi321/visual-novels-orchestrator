import { describe, expect, it } from 'vitest'
import { asciiSlug, normText, slugKey } from '../src/engine/vn/ids'
import { projectSlug } from '../src/engine/vn/project'
import { slugify } from '../src/engine/renpy/escape'
import { transliterate } from '../src/shared/translit'

const slug = (s: string): string => asciiSlug(s, { sep: '-', fallback: 'book' })

describe('transliterate', () => {
  it('Cyrillic: Russian, Ukrainian, Serbian', () => {
    expect(slug('Война и мир')).toBe('voina-i-mir')
    expect(slug('Щука, Жук, Чехов, Цой, Юля, Яна')).toBe('shchuka-zhuk-chekhov-tsoi-yulya-yana')
    expect(slug('Київ Ґанок Їжак Єва')).toBe('kiyiv-ganok-yizhak-yeva')
    expect(slug('Ђорђе Љубица Њега Ћирилица Џем')).toBe('djordje-ljubitsa-njega-cirilitsa-dzem')
  })
  it('Greek, with the accents and the polytonic letters', () => {
    expect(slug('Ὀδύσσεια')).toBe('odysseia')
    expect(slug('Ελλάδα')).toBe('ellada')
    expect(slug('Θεός, Χάος, Ψυχή')).toBe('theos-chaos-psychi')
    expect(slug('Ούτος')).toBe('outos')
  })
  it('Armenian and Georgian', () => {
    expect(slug('Հայաստան')).toBe('hayastan')
    expect(slug('საქართველო')).toBe('sakartvelo')
  })
  it('Hebrew and Arabic (consonants), Persian letters', () => {
    expect(slug('שלום')).toBe('shlvm')
    expect(slug('محمد')).toBe('mhmd')
    expect(slug('پارسی')).toBe('parsy')
  })
  it('Devanagari: the virama drops the inherent a', () => {
    expect(slug('नमस्ते')).toBe('namaste')
    expect(slug('हिन्दी')).toBe('hindii')
    expect(slug('क्षमा')).toBe('kshamaa')
  })
  it('Hiragana and Katakana in Hepburn: small ya, small tsu, the long mark', () => {
    expect(slug('さくら')).toBe('sakura')
    expect(slug('きゃりー')).toBe('kyari')
    expect(slug('しゃしん')).toBe('shashin')
    expect(slug('ざっし')).toBe('zasshi')
    expect(slug('まっちゃ')).toBe('matcha')
    expect(slug('ラーメン')).toBe('ramen')
    expect(slug('トーキョー')).toBe('tokyo')
    expect(slug('ファイル')).toBe('fairu')
  })
  it('Hangul: Revised Romanization from the syllables', () => {
    expect(slug('한국어')).toBe('hangugeo')
    expect(slug('서울')).toBe('seoul')
    expect(slug('안녕하세요')).toBe('annyeonghaseyo')
  })
  it('counts the letters it cannot write: Han and Thai', () => {
    expect(transliterate('红楼梦')).toMatchObject({ latin: '', dropped: 3 })
    expect(transliterate('สวัสดี').dropped).toBeGreaterThan(0)
    expect(transliterate('東京 Tokyo')).toMatchObject({ latin: ' Tokyo', dropped: 2 })
    expect(transliterate('Plain ASCII, 42!')).toEqual({ latin: 'Plain ASCII, 42!', dropped: 0 })
    // punctuation and symbols are not letters
    expect(transliterate('「…」')).toMatchObject({ dropped: 0 })
  })
  it('keeps Latin letters, and writes the ones that do not decompose', () => {
    expect(slug('Šime Đurđević')).toBe('sime-durdevic')
    expect(slug('Łódź Ørsted Straße Æon')).toBe('lodz-orsted-strasse-aeon')
  })
})

describe('slugs and keys', () => {
  it('Han-only text gets a short hash, the same for the same text and another for another text', () => {
    const a = projectSlug('红楼梦')
    expect(a).toMatch(/^book-[0-9a-f]{6}$/)
    expect(projectSlug('红楼梦')).toBe(a)
    expect(projectSlug('西游记')).not.toBe(a)
    expect(projectSlug('東京 Tokyo')).toMatch(/^tokyo-[0-9a-f]{6}$/)
    expect(projectSlug('Тихий Дон')).toBe('tikhii-don')
  })
  it('mixed text keeps its Latin part, transliterates the rest, and hashes only when something was dropped', () => {
    expect(projectSlug('Hello Мир')).toBe('hello-mir')
    expect(projectSlug('Hello 世界')).toMatch(/^hello-[0-9a-f]{6}$/)
    expect(projectSlug('The Lighthouse Letters')).toBe('the-lighthouse-letters')
    expect(projectSlug('')).toBe('book')
  })
  it('a long title is cut and still fits a slug of 60 characters with the hash', () => {
    expect(projectSlug('a'.repeat(100))).toBe('a'.repeat(60))
    const long = projectSlug('红'.repeat(5) + 'b'.repeat(100))
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long).toMatch(/-[0-9a-f]{6}$/)
  })
  it('character keys: ASCII, starting with a letter', () => {
    expect(slugKey('Наташа')).toBe('natasha')
    expect(slugKey('Пьер')).toBe('per')
    expect(slugKey('Mara')).toBe('mara')
    expect(slugKey('Petra’s House')).toBe('petra_s_house')
    expect(slugKey('7th Floor')).toBe('x_7th_floor')
    expect(slugKey('小林')).toMatch(/^x_[0-9a-f]{6}$/)
    expect(slugKey('')).toBe('x')
    expect(slugKey('Ο Γιάννης')).toBe('o_giannis')
  })
  it('Ren’Py identifiers stay ASCII', () => {
    expect(slugify('Mr. Šarić')).toBe('mr_saric')
    expect(slugify('Наташа Ростова')).toBe('natasha_rostova')
    expect(slugify('東京')).toMatch(/^x_[0-9a-f]{6}$/)
    for (const s of ['Наташа', '한국어', 'ひらがな', 'नमस्ते', 'Ελλάδα']) expect(slugify(s)).toMatch(/^[a-z0-9_]+$/)
  })
})

describe('normText', () => {
  it('keeps the letters and digits of every script, and separates words at punctuation', () => {
    expect(normText('Наташа  Ростова!')).toBe('наташа ростова')
    expect(normText('Ὀδύσσεια')).toBe('οδυσσεια')
    expect(normText('Šime Đurđević')).toBe('sime durdevic')
    expect(normText('  Mr. Brown, 3rd  ')).toBe('mr brown 3rd')
    expect(normText('한국어 の 話')).toBe('한국어 の 話')
    expect(normText('नमस्ते दुनिया')).toBe('नमस्ते दुनिया')
  })
  it('matches a name written with different case, accents or punctuation', () => {
    expect(normText('ПЬЕР')).toBe(normText('Пьер.'))
    expect(normText('Ёлка')).toBe(normText('елка'))
  })
})
