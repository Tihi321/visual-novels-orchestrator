import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLAYER_UI_KEYS, UI_STRINGS } from '../src/shared/ui-strings'
import { assertKnownLang, BUILTIN_LANGUAGES, isKnownLang, languageInfo, languages, registerLanguages, resetLanguages } from '../src/shared/languages'
import { LANGS, langSchema, projectSettingsSchema } from '../src/shared/vn'
import { detectLanguage } from '../src/engine/vn/lang'
import { loadLanguageConfig } from '../src/engine/vn/languages-config'
import { languageTable } from '../src/engine/game/build'
import { writeUiStrings } from '../src/engine/game/tl'

afterEach(() => resetLanguages())

const SUPERTONIC = 'en ko ja ar bg cs da de el es et fi fr hi hr hu id it lt lv nl pl pt ro ru sk sl sv tr uk vi'.split(' ')

describe('the language table', () => {
  it('has the 31 Supertonic and 6 Book Translator languages', () => {
    expect(BUILTIN_LANGUAGES).toHaveLength(37)
    expect(LANGS).toHaveLength(37)
    for (const code of SUPERTONIC) expect(languageInfo(code)?.supertonic).toBe(true)
    for (const code of ['sr', 'bs', 'no', 'he', 'fa', 'zh']) expect(isKnownLang(code)).toBe(true)
    expect(languages().filter((l) => l.rtl).map((l) => l.code)).toEqual(['ar', 'he', 'fa'])
  })
  it('has unique Ren’Py identifiers made of lowercase ascii', () => {
    const ids = BUILTIN_LANGUAGES.map((l) => l.renpy)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z_]*$/)
    expect(languageInfo('hr')).toMatchObject({ renpy: 'croatian', native: 'Hrvatski' })
  })
  it('knows what it knows', () => {
    expect(assertKnownLang('de')).toBe('de')
    expect(() => assertKnownLang('xx')).toThrow(/unknown language "xx".*config\/languages\.md/)
  })
  it('registers new languages and overrides built-in ones', () => {
    registerLanguages([
      { code: 'pt-br', name: 'Brazilian Portuguese' },
      { code: 'de', name: 'German', native: 'Deutsch (DE)' }
    ])
    expect(languageInfo('pt-br')).toMatchObject({ renpy: 'brazilian_portuguese', native: 'Brazilian Portuguese', script: 'other' })
    expect(languageInfo('de')?.native).toBe('Deutsch (DE)')
    resetLanguages()
    expect(isKnownLang('pt-br')).toBe(false)
  })
})

describe('UI strings of the built-in languages', () => {
  const hrAll = Object.keys(UI_STRINGS.hr!)
  const hr = hrAll.slice(0, 49) // the core strings every language has; Croatian goes on with the help-screen ones
  const others = BUILTIN_LANGUAGES.filter((l) => l.code !== 'en')

  it('every built-in language except English has a table, and English has none', () => {
    expect(others).toHaveLength(36)
    for (const l of others) expect(l.ui, l.code).toBeTruthy()
    expect(languageInfo('en')?.ui).toBeUndefined()
    expect(Object.keys(UI_STRINGS).sort()).toEqual(others.map((l) => l.code).sort())
  })
  it('every player UI key is in the Croatian table, whose 49 core keys are still the template ones', () => {
    const missing = PLAYER_UI_KEYS.find((key) => !(key in UI_STRINGS.hr!))
    expect(missing, `the Croatian table has no "${missing}"`).toBeUndefined()
    // the 49 core keys come first, in the template's order: the same keys the other tables have
    expect(hr).toHaveLength(49)
    expect(Object.keys(UI_STRINGS.hr!).slice(0, 49)).toEqual(Object.keys(UI_STRINGS.de!))
    expect(hr[48]).toBe('Are you sure you want to skip to the next choice?')
  })
  it('each table has exactly the 49 core keys of the Croatian one, which are the template strings', () => {
    expect(hr).toHaveLength(49)
    expect(hrAll.length).toBeGreaterThan(49)
    for (const k of ['Language', 'The End', 'Start again', 'Back to main menu', 'Page {}']) expect(hr).toContain(k)
    for (const l of others) expect(Object.keys(l.ui!), l.code).toEqual(l.code === 'hr' ? hrAll : hr)
  })
  it('keeps the placeholders and line breaks, and nothing that would break a Ren’Py string', () => {
    const BREAK = '\\n' // a backslash and an n, as in the template source
    for (const l of others) {
      for (const [src, dst] of Object.entries(l.ui!).slice(0, 49)) {
        const at = `${l.code}: ${src}`
        expect(dst.trim(), at).not.toBe('')
        expect(dst.includes('{}'), at).toBe(src.includes('{}'))
        expect(dst.split(BREAK).length, at).toBe(src.split(BREAK).length)
        expect(dst.replace('{}', '').replaceAll(BREAK, ''), at).not.toMatch(/["[\]{}%\\]/)
      }
    }
  })
  it('the Croatian help-screen strings keep tags and line breaks and break no Ren’Py string', () => {
    const tags = (t: string): string[] => t.match(/\{[^}]*\}/g) ?? []
    for (const [src, dst] of Object.entries(UI_STRINGS.hr!).slice(49)) {
      expect(dst.trim(), src).not.toBe('')
      expect(tags(dst), src).toEqual(tags(src))
      expect(dst.split('\\n').length, src).toBe(src.split('\\n').length)
      expect(dst, src).not.toMatch(/["[\]%]/)
    }
  })
  it('is written in the script of the language (checked for the non-Latin ones)', () => {
    const sample = (code: string): string => Object.values(languageInfo(code)!.ui!).join(' ')
    expect(sample('ru')).toMatch(/[а-яё]/i)
    expect(sample('sr')).toMatch(/[а-шћђџљњ]/i)
    expect(sample('el')).toMatch(/[α-ω]/i)
    expect(sample('ja')).toMatch(/[ぁ-んァ-ン]/)
    expect(sample('ko')).toMatch(/[가-힣]/)
    expect(sample('zh')).toMatch(/[一-龥]/)
    expect(sample('ar')).toMatch(/[ا-ي]/)
    expect(sample('he')).toMatch(/[א-ת]/)
    expect(sample('hi')).toMatch(/[अ-ह]/)
  })
  it('config/languages.md merges into a built-in language: ui key by key, other fields replace', () => {
    registerLanguages([{ code: 'de', name: 'German', native: 'Deutsch (CH)', ui: { Start: 'Los' } }])
    const de = languageInfo('de')!
    expect(de.native).toBe('Deutsch (CH)')
    expect(de.renpy).toBe('german')
    expect(de.script).toBe('latin')
    expect(de.supertonic).toBe(true)
    expect(de.ui!.Start).toBe('Los')
    expect(de.ui!.Load).toBe('Laden')
    expect(Object.keys(de.ui!)).toEqual(hr)
  })
  it('a language entry from the config file keeps the built-in table', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-lang-'))
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'config', 'languages.md'), '---\nkind: languages\nlanguages:\n  - code: fr\n    name: French\n    ui:\n      Quit: Fermer\n---\nbody\n')
    await loadLanguageConfig(dir)
    expect(languageInfo('fr')?.ui?.Quit).toBe('Fermer')
    expect(languageInfo('fr')?.ui?.Start).toBe('Commencer')
  })
})

describe('language codes in the project files', () => {
  it('accepts a code of any known or custom language, not junk', () => {
    expect(langSchema.safeParse('pt-br').success).toBe(true)
    expect(langSchema.safeParse('Croatian').success).toBe(false)
    expect(langSchema.safeParse('e').success).toBe(false)
  })
  it('keeps a legacy Supertonic voice for en and hr only', () => {
    const s = projectSettingsSchema.parse({ slug: 'a', source: '', primaryLang: 'hr', voice: { voices: { mara: 'supertonic:F1', ivo: 'af_heart' } } })
    expect(s.voice.voices.mara).toEqual({ en: 'supertonic:F1', hr: 'supertonic:F1' })
    expect(s.voice.voices.ivo).toEqual({ en: 'af_heart' })
  })
})

describe('config/languages.md', () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'vno-lang-'))
  const write = (dir: string, text: string): void => {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'config', 'languages.md'), text)
  }

  it('adds a language with a UI table', async () => {
    const dir = tmp()
    write(dir, '---\nkind: languages\nlanguages:\n  - code: pt-br\n    name: Brazilian Portuguese\n    ui:\n      Start: Iniciar\n---\nbody\n')
    await loadLanguageConfig(dir)
    expect(languageInfo('pt-br')?.ui).toEqual({ Start: 'Iniciar' })
    expect(languageTable('pt-br', ['pt-br', 'en']).defaultLanguage).toBe('"brazilian_portuguese"')
  })
  it('ignores a bad file and says so', async () => {
    const dir = tmp()
    write(dir, '---\nkind: languages\nlanguages:\n  - code: X\n    name: ""\n---\n')
    const log: string[] = []
    await loadLanguageConfig(dir, (m) => log.push(m))
    expect(languages()).toHaveLength(37)
    expect(log[0]).toMatch(/not valid/)
  })
  it('is fine without the file', async () => {
    await loadLanguageConfig(tmp())
    expect(languages()).toHaveLength(37)
  })
  it('the seed file is valid and adds nothing', async () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, 'config'))
    fs.copyFileSync(path.resolve('seed/config/languages.md'), path.join(dir, 'config', 'languages.md'))
    const log: string[] = []
    await loadLanguageConfig(dir, (m) => log.push(m))
    expect(log).toEqual([])
    expect(languages()).toHaveLength(37)
  })
})

describe('menus of the primary language', () => {
  it('writes the table for a language that has one, and a lone identity entry for one that has not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-ui-'))
    expect(writeUiStrings(dir, 'hr')).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'tl', 'croatian', 'ui.rpy'), 'utf8')).toContain('    new "Jezik"')
    registerLanguages([{ code: 'pt-br', name: 'Brazilian Portuguese' }])
    expect(writeUiStrings(dir, 'pt-br')).toBe(false)
    const pt = fs.readFileSync(path.join(dir, 'tl', 'brazilian_portuguese', 'ui.rpy'), 'utf8')
    expect(pt).toContain('translate brazilian_portuguese strings:')
    expect(pt).toContain('    old "Language"\n    new "Language"')
    expect(writeUiStrings(dir, 'de')).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'tl', 'german', 'ui.rpy'), 'utf8')).toContain('    new "Sprache"')
  })
})

// One or two sentences per built-in language, written for this test.
const SAMPLES: Record<string, string> = {
  en: 'The old man was standing at the window and he was not looking at us, but at the rain that fell on the street.',
  de: 'Der alte Mann stand am Fenster und er sah uns nicht an, sondern den Regen, der auf die Straße fiel. Es war ein langer Tag.',
  fr: 'Le vieil homme était debout près de la fenêtre et il ne nous regardait pas, mais la pluie qui tombait dans la rue.',
  es: 'El viejo estaba de pie junto a la ventana y no nos miraba a nosotros, sino la lluvia que caía sobre la calle. Era muy tarde.',
  it: 'Il vecchio era in piedi vicino alla finestra e non guardava noi, ma la pioggia che cadeva sulla strada. Era già tardi.',
  pt: 'O velho estava de pé perto da janela e não olhava para nós, mas para a chuva que caía na rua. Você já está aqui?',
  nl: 'De oude man stond bij het raam en hij keek niet naar ons, maar naar de regen die op de straat viel. Het was een lange dag.',
  pl: 'Stary człowiek stał przy oknie i nie patrzył na nas, ale na deszcz, który padał na ulicę. To był bardzo długi dzień.',
  cs: 'Starý muž stál u okna a nedíval se na nás, ale na déšť, který padal na ulici. Byl to velmi dlouhý den, když jsme přišli.',
  sk: 'Starý muž stál pri okne a nepozeral sa na nás, ale na dážď, ktorý padal na ulicu. Bol to veľmi dlhý deň, keď sme prišli.',
  sl: 'Stari mož je stal ob oknu in ni gledal nas, ampak dež, ki je padal na ulico. Bil je zelo dolg dan, ker smo prišli pozno.',
  hr: 'Stari čovjek stajao je kraj prozora i nije gledao nas, nego kišu koja je padala na ulicu. Bio je to vrlo dug dan.',
  hu: 'Az öreg ember az ablaknál állt, és nem minket nézett, hanem az esőt, ami az utcára esett. Már nagyon késő volt.',
  ro: 'Bătrânul stătea lângă fereastră și nu se uita la noi, ci la ploaia care cădea pe stradă. Era o zi foarte lungă.',
  sv: 'Den gamle mannen stod vid fönstret och han tittade inte på oss, utan på regnet som föll på gatan. Det var en lång dag.',
  da: 'Den gamle mand stod ved vinduet og han så ikke på os, men på regnen som faldt på gaden. Det var en lang dag, og vi var trætte.',
  no: 'Den gamle mannen sto ved vinduet og han så ikke på oss, men på regnet som falt på gaten. Hva skulle han nå gjøre etter at det var blitt så sent?',
  fi: 'Vanha mies seisoi ikkunan luona eikä hän katsonut meitä, vaan sadetta, joka satoi kadulle. Se oli pitkä päivä, mutta hän oli kotona.',
  et: 'Vana mees seisis akna ääres ja ta ei vaadanud meid, vaid vihma, mis sadas tänavale. See oli väga pikk päev, aga me olime kodus.',
  lt: 'Senas vyras stovėjo prie lango ir jis žiūrėjo ne į mus, bet į lietų, kuris krito ant gatvės. Tai buvo labai ilga diena, bet mes buvome namuose.',
  lv: 'Vecais vīrs stāvēja pie loga un viņš skatījās nevis uz mums, bet uz lietu, kas krita uz ielas. Tā bija ļoti gara diena, bet mēs bijām mājās.',
  tr: 'Yaşlı adam pencerenin yanında duruyordu ve bize değil, sokağa yağan yağmura bakıyordu. Çok uzun bir gündü ama biz evdeydik.',
  id: 'Orang tua itu berdiri di dekat jendela dan dia tidak melihat kami, tetapi hujan yang jatuh di jalan. Itu adalah hari yang panjang.',
  vi: 'Ông già đứng bên cửa sổ và không nhìn chúng tôi, mà nhìn cơn mưa rơi trên phố. Đó là một ngày rất dài.',
  ru: 'Старик стоял у окна и смотрел не на нас, а на дождь, который шёл на улице. Это был очень долгий день, и мы устали.',
  uk: 'Старий стояв біля вікна і дивився не на нас, а на дощ, який падав на вулицю. Це був дуже довгий день, і ми були вдома.',
  bg: 'Старецът стоеше до прозореца и не гледаше към нас, а към дъжда, който валеше на улицата. Беше много дълъг ден и всичко беше тихо.',
  sr: 'Старац је стајао поред прозора и није гледао у нас, него у кишу која је падала на улицу. Био је то веома дуг дан, ћерка је дошла.',
  ar: 'كان الرجل العجوز واقفا عند النافذة ولم يكن ينظر إلينا، بل إلى المطر الذي كان يسقط على الشارع. كان يوما طويلا جدا.',
  fa: 'پیرمرد کنار پنجره ایستاده بود و به ما نگاه نمی‌کرد، بلکه به بارانی که در خیابان می‌بارید. این روز بسیار طولانی بود و او را دید.',
  he: 'הזקן עמד ליד החלון והוא לא הסתכל עלינו, אלא על הגשם שירד על הרחוב. זה היה יום ארוך מאוד.',
  el: 'Ο γέρος στεκόταν δίπλα στο παράθυρο και δεν κοιτούσε εμάς, αλλά τη βροχή που έπεφτε στο δρόμο. Ήταν μια πολύ μεγάλη μέρα.',
  hi: 'बूढ़ा आदमी खिड़की के पास खड़ा था और वह हमें नहीं देख रहा था, बल्कि सड़क पर गिरती बारिश को देख रहा था।',
  ja: '老人は窓のそばに立っていて、私たちではなく、通りに降る雨を見ていた。とても長い一日だった。',
  zh: '老人站在窗边，他没有看我们，而是看着落在街上的雨。那是很长的一天。',
  ko: '노인은 창가에 서 있었고 우리를 보지 않고 거리에 내리는 비를 보고 있었다. 매우 긴 하루였다.'
}

describe('detectLanguage', () => {
  it('has a sample for every built-in language (Bosnian shares the Croatian one)', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...LANGS].filter((l) => l !== 'bs').sort())
  })
  it.each(Object.entries(SAMPLES))('detects %s', (code, text) => {
    const r = detectLanguage(text)
    expect(r.lang).toBe(code)
    expect(r.confidence).toBeGreaterThan(0)
  })
  it('puts Croatian, Bosnian and Serbian Latin in one group that answers hr', () => {
    expect(detectLanguage('Stari čovjek stajao je kraj prozora i nije gledao nas, nego kišu koja je padala na ulicu.').lang).toBe('hr')
  })
  it('tells Serbian and Bosnian from Croatian by their own words', () => {
    expect(detectLanguage('Staro dete je stajalo kraj prozora i nije gledalo nas, nego lepo vreme koje je bilo na ulici. Reč je bila tiha.').lang).toBe('sr')
    expect(detectLanguage('Stari čovjek je stajao kraj prozora, a ko je došao nije znao ni hiljadu stvari koje je tačno rekao. Nije to ono što je bilo.').lang).toBe('bs')
  })
  it('has no confidence for empty text', () => {
    expect(detectLanguage('').confidence).toBe(0)
  })
})
