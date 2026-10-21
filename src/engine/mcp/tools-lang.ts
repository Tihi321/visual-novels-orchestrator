import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { dataFolders } from '../vn/project'
import { renameRetry, TMP_MARKER } from '../store/atomic'
import type { VnService } from '../vn/service'
import type { McpOptions, Tool, ToolDef } from './tools'

/** Scripts `vno_fonts_fetch` has a free font for. Han, Thai and the others the build can use from the system are not fetched automatically. */
export const FETCH_SCRIPTS = ['han', 'kana', 'hangul', 'devanagari', 'thai'] as const
export type FetchScript = (typeof FETCH_SCRIPTS)[number]

export interface FontSource {
  /** The font family, for the answer. */
  family: string
  font: string
  ext: 'otf' | 'ttf'
  /** The SIL Open Font License text that goes with it. */
  license: string
}

const CJK = 'https://github.com/notofonts/noto-cjk/raw/main/Sans'
const NOTO = 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts'

/**
 * Noto Sans (SIL Open Font License) per script. Each URL was fetched once by hand (the first bytes are a font header: `OTTO` or a TrueType
 * header) on 2026-10-21. The CJK fonts are about 16 MB each, the others under 1 MB.
 */
export const FONT_SOURCES: Record<FetchScript, FontSource> = {
  han: { family: 'Noto Sans CJK SC', font: `${CJK}/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`, ext: 'otf', license: `${CJK}/LICENSE` },
  kana: { family: 'Noto Sans CJK JP', font: `${CJK}/OTF/Japanese/NotoSansCJKjp-Regular.otf`, ext: 'otf', license: `${CJK}/LICENSE` },
  hangul: { family: 'Noto Sans CJK KR', font: `${CJK}/OTF/Korean/NotoSansCJKkr-Regular.otf`, ext: 'otf', license: `${CJK}/LICENSE` },
  devanagari: {
    family: 'Noto Sans Devanagari',
    font: `${NOTO}/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf`,
    ext: 'ttf',
    license: 'https://github.com/notofonts/devanagari/raw/main/OFL.txt'
  },
  thai: { family: 'Noto Sans Thai', font: `${NOTO}/NotoSansThai/hinted/ttf/NotoSansThai-Regular.ttf`, ext: 'ttf', license: 'https://github.com/notofonts/thai/raw/main/OFL.txt' }
}

async function download(url: string, to: string, doFetch: typeof fetch): Promise<number> {
  const res = await doFetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length === 0) throw new Error(`${url}: empty answer`)
  await fs.mkdir(path.dirname(to), { recursive: true })
  const tmp = `${to}${TMP_MARKER}${randomBytes(4).toString('hex')}`
  await fs.writeFile(tmp, bytes)
  try {
    await renameRetry(tmp, to)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
  return bytes.length
}

/** Downloads the free font of a script into `<fontsDir>/<script>.<ext>`, with its license. Never runs by itself. */
export async function fetchFont(fontsDir: string, script: FetchScript, opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<{ script: FetchScript; family: string; font: string; license: string; bytes: number; skipped: boolean }> {
  const src = FONT_SOURCES[script]
  const font = path.join(fontsDir, `${script}.${src.ext}`)
  const license = path.join(fontsDir, `${script}-OFL.txt`)
  const exists = await fs.stat(font).then(() => true, () => false)
  if (exists && !opts.force) return { script, family: src.family, font, license, bytes: 0, skipped: true }
  const doFetch = opts.fetchImpl ?? fetch
  const bytes = await download(src.font, font, doFetch)
  await download(src.license, license, doFetch)
  return { script, family: src.family, font, license, bytes, skipped: false }
}

/** Language tools: the fonts for scripts the theme font lacks. */
export function langTools(svc: VnService, def: ToolDef, opts: McpOptions): Tool[] {
  return [
    def(
      'vno_fonts_fetch',
      `Download a free font (Noto Sans, SIL Open Font License, with its license text) for a script that no theme font and no Ren'Py font covers, into the fonts folder of the data folder (<data>/fonts/<script>.otf|ttf). The next build uses it for the languages written in that script. Scripts: ${FETCH_SCRIPTS.join(', ')} (han: Chinese, kana: Japanese, hangul: Korean). Cyrillic, Greek, Arabic and Hebrew use DejaVuSans, which ships with Ren'Py. Downloads 1 to 16 MB from GitHub; it never runs by itself. An existing file is kept unless force is true.`,
      z.object({ script: z.enum(FETCH_SCRIPTS).describe('han, kana, hangul, devanagari or thai'), force: z.boolean().optional().describe('Download again even when the file is there') }),
      async (a) => {
        const r = await fetchFont(dataFolders(svc.dataDir).fonts, a.script, { force: a.force, fetchImpl: opts.fetchImpl })
        return { ...r, next: r.skipped ? 'The font was already there (force: true downloads it again).' : 'Build again (vno_build): the languages in this script now use it.' }
      }
    )
  ]
}
