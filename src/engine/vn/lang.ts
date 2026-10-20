import { isKnownLang } from '../../shared/languages'
import type { Lang } from '../../shared/vn'

export interface LangDetection {
  lang: Lang
  /** 0..1: how clearly one language wins, lower for very short samples. */
  confidence: number
  /** Language code -> score (hits per word) of the languages that scored. */
  scores: Record<string, number>
  words: number
  /** The script most of the letters are in (`latin`, `cyrillic`, `han`, ...). */
  script: string
}

const set = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean))

// Function words that mostly belong to one language. Words that are common in a neighbour ("a", "to", "on", "do") are left out.
const WORDS: Record<string, Set<string>> = {
  en: set('the and is of that it you was for with he she they in his her not are this but have had what there be at as from by we my your'),
  de: set('der die das und ist nicht ein eine ich du er sie es wir ihr mit auf für von den dem zu war hat aber auch wie noch sich'),
  fr: set('le la les des est une un et que qui pas dans pour je tu il elle nous vous ils sur avec mais ce cette être au aux'),
  es: set('el los las una que por con para no se su al lo como más pero sus ya muy está del'),
  it: set('il lo gli le un una è e che di non per con sono ha ho ma come più anche questo nel della del dei'),
  pt: set('os uma que não para com por mais mas como foi você ele ela seu sua já ao são tem'),
  nl: set('de het een en van ik je dat is niet zijn op te met voor maar ook er aan was hij ze dit wat'),
  pl: set('nie się że jest jak ale tak czy już był była było tylko jego jej przez bardzo mnie ten'),
  cs: set('je se na to že ale jako byl byla bylo byly jsem jsou jsi už tak jen nebo když'),
  sk: set('sa je na to že ale ako bol bola bolo som si sú už tak len alebo keď však ktorý'),
  sl: set('je da se na to ki ali kot bil bila bilo sem si so že tako le ker pa ni od kaj tudi'),
  hr: set('je i se da u na što šta nije su ali kao za od ne si smo ste sa ima bio bila bilo mi ti ga ju mu joj nas vas ovo ono taj ta koji koja kako kad kada već samo još jer pa ni nego'),
  hu: set('az és hogy nem egy van volt meg már csak mint ezt akkor vagy még fel'),
  ro: set('și în la nu un că cu pe este sunt era dar să se mai din pentru foarte într'),
  sv: set('och att det som är på för med inte jag han hon den var har men så till från'),
  da: set('og at det er til på for med ikke jeg han hun den var har men så af fra også hvad noget nu efter været os mig dig sig blevet'),
  no: set('og at det er til på for med ikke jeg han hun den var har men så av fra også hva noe nå etter vært blitt mye oss meg deg seg'),
  fi: set('ja on ei että hän oli mutta kun niin ole minä sinä tai vain kuin myös mitä'),
  et: set('et see oli aga kui nii mina sina nad või ainult juba mis ka'),
  lt: set('ir kad yra tai kaip bet jis buvo tik jau arba aš tu mes jūs'),
  lv: set('un ka ir nav tas kā bet viņš viņa mēs jūs viņi bija tikai jau vai man tu es'),
  tr: set('ve bir bu için ile ben sen ama çok daha gibi değil var yok kadar'),
  id: set('yang dan di ke dari ini itu dengan untuk tidak akan pada adalah saya kamu dia kami mereka ada juga'),
  vi: set('và là của có không một những được cho với này trong tôi bạn anh ấy chúng đã như'),
  ru: set('и в не на что он я с как это она но они мы вы его был было все так уже или есть только'),
  uk: set('і в не на що він я з як це вона але вони ми ви його був було все так вже або є тільки та'),
  bg: set('и в не на че той аз с как това тя но те ние вие го беше всичко така вече или има само се да'),
  sr: set('и у не на да је се су ово како али они ми ви га био била све тако већ или има само ће'),
  fa: set('است این که را با از به در برای او من تو ما هم یک بود شد نیز'),
  ar: set('في من على إلى أن هذا هذه ما لا كان كانت هو هي عن مع لم قد ثم')
}

/** The Latin-script languages that are told apart by words and letters. */
const LATIN = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'sl', 'hr', 'hu', 'ro', 'sv', 'da', 'no', 'fi', 'et', 'lt', 'lv', 'tr', 'id', 'vi']

// Letters that point at a language (a letter several languages use counts for each of them).
const MARKS: Record<string, string> = {
  de: 'äöüß',
  fr: 'àâçéèêëîïôûùüÿœ',
  es: 'ñ¿¡áéíóúü',
  it: 'àèéìòù',
  pt: 'ãõçáâêéíóôú',
  pl: 'ąćęłńóśźż',
  cs: 'áčďéěíňóřšťúůýž',
  sk: 'áäčďéíĺľňóôŕšťúýž',
  sl: 'čšž',
  hr: 'čćđšž',
  hu: 'áéíóöőúüű',
  ro: 'ăâîșțşţ',
  sv: 'åäö',
  da: 'æøå',
  no: 'æøå',
  fi: 'äöå',
  et: 'õäöüšž',
  lt: 'ąčęėįšųūž',
  lv: 'āčēģīķļņšūž',
  tr: 'çğıöşü',
  vi: 'ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ'
}

// Serbian and Bosnian Latin read like Croatian: they win only on their own words, else the group is Croatian.
const SR_WORDS = set('mleko dete lepo reč vreme sećam lepa deca hteo reka ćerka')
const BS_WORDS = set('hiljada hiljadu sedmica historija tačno ko hljeb kahva')
const HR_ONLY = set('mlijeko dijete lijepo riječ vrijeme sjećam djeca htio rijeka kći tko tisuća točno kruh')

const SCRIPTS: [string, RegExp][] = [
  ['latin', /\p{Script=Latin}/gu],
  ['cyrillic', /\p{Script=Cyrillic}/gu],
  ['greek', /\p{Script=Greek}/gu],
  ['arabic', /\p{Script=Arabic}/gu],
  ['hebrew', /\p{Script=Hebrew}/gu],
  ['devanagari', /\p{Script=Devanagari}/gu],
  ['han', /\p{Script=Han}/gu],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ['hangul', /\p{Script=Hangul}/gu],
  ['thai', /\p{Script=Thai}/gu]
]

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0
/** In how many of the lists a word is: a word that several languages share (`je`, `se`) counts much less in each. */
const SHARED_WORDS: Map<string, number> = new Map()
for (const list of Object.values(WORDS)) for (const w of list) SHARED_WORDS.set(w, (SHARED_WORDS.get(w) ?? 0) + 1)
const hits = (words: string[], list: Set<string> | undefined): number =>
  list ? words.reduce((n, w) => n + (list.has(w) ? 1 / (SHARED_WORDS.get(w) ?? 1) ** 2 : 0), 0) : 0
/** How many languages use each marker letter: a letter that many share counts much less for any one of them. */
const SHARED: Map<string, number> = new Map()
for (const chars of Object.values(MARKS)) for (const c of new Set(chars)) SHARED.set(c, (SHARED.get(c) ?? 0) + 1)

/** The marker letters of a language in the text, each worth 2 divided by the square of the number of languages that use it. */
const marks = (text: string, chars: string): number => {
  let n = 0
  for (const c of text) if (chars.includes(c)) n += 2 / (SHARED.get(c) ?? 1) ** 2
  return n
}

/**
 * Deterministic language detection from the script, function words and letters. Only languages in the registry can win.
 * Croatian, Bosnian and Serbian in Latin script are one group that answers `hr` unless Serbian or Bosnian words win.
 */
export function detectLanguage(text: string): LangDetection {
  const lower = text.toLowerCase()
  const words = lower.match(/\p{L}+/gu) ?? []
  const n = Math.max(words.length, 1)
  const perScript = SCRIPTS.map(([name, re]) => [name, count(text, re)] as const)
  const [script, top] = perScript.reduce((a, b) => (b[1] > a[1] ? b : a), ['latin', 0] as readonly [string, number])
  const num = (name: string): number => perScript.find((s) => s[0] === name)![1]

  let raw: Record<string, number> = {}
  if (top === 0) raw = {}
  else if (script === 'han' || script === 'kana') raw = num('kana') > 0 ? { ja: 1 } : { zh: 1 }
  else if (script === 'hangul') raw = { ko: 1 }
  else if (script === 'hebrew') raw = { he: 1 }
  else if (script === 'devanagari') raw = { hi: 1 }
  else if (script === 'greek') raw = { el: 1 }
  else if (script === 'arabic') {
    // Persian has its own letters and words; Arabic wins a tie
    raw = { ar: hits(words, WORDS.ar) + 3 * count(text, /[يك]/g) + 0.5, fa: hits(words, WORDS.fa) + 3 * count(text, /[پچژگیک]/g) }
  } else if (script === 'cyrillic') {
    const ruOnly = count(text, /[ыэё]/gu)
    raw = {
      ru: hits(words, WORDS.ru) + 3 * ruOnly,
      uk: hits(words, WORDS.uk) + 3 * count(text, /[іїєґ]/gu),
      bg: ruOnly ? 0 : hits(words, WORDS.bg) + 3 * count(text, /ъ/gu),
      sr: hits(words, WORDS.sr) + 3 * count(text, /[ђћџљњј]/gu)
    }
  } else if (script === 'latin') {
    for (const code of LATIN) raw[code] = hits(words, WORDS[code]) + marks(lower, MARKS[code] ?? '')
    const group = raw.hr ?? 0
    raw.sr = group + hits(words, SR_WORDS)
    raw.bs = group + hits(words, BS_WORDS)
    raw.hr = group + hits(words, HR_ONLY)
  }

  const scores: Record<string, number> = {}
  for (const [code, v] of Object.entries(raw)) if (v > 0 && isKnownLang(code)) scores[code] = Math.round((v / n) * 1000) / 1000
  // a tie goes to Croatian, then to the language listed first
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || (a[0] === 'hr' ? -1 : b[0] === 'hr' ? 1 : 0))
  const best = ranked[0]?.[1] ?? 0
  // the runner-up of a Croatian/Bosnian/Serbian winner is the best language outside that group
  const inGroup = (code: string | undefined): boolean => code === 'hr' || code === 'bs' || code === 'sr'
  const second = (inGroup(ranked[0]?.[0]) ? ranked.slice(1).find((r) => !inGroup(r[0])) : ranked[1])?.[1] ?? 0
  const margin = best + second === 0 ? 0 : (best - second) / (best + second)
  const confidence = Math.round(margin * Math.min(1, words.length / 25) * 1000) / 1000
  return { lang: ranked[0]?.[0] ?? 'en', confidence, scores, words: words.length, script }
}
