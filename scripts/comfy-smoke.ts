/**
 * Manual smoke test: generates one small background with z-image-turbo into .claude/temp/comfy-smoke/.
 *
 *   npx tsx scripts/comfy-smoke.ts [engine] [lane]
 *
 * Skips (exit 0) when ComfyUI is not reachable.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createComfyClient, parseComfyConfig, queueState } from '../src/engine/comfy/client'
import { fitBackground } from '../src/engine/assets/postprocess'

const engine = process.argv[2] ?? 'z-image-turbo'
const lane = process.argv[3] ?? process.env.COMFY_LANE ?? 'http://127.0.0.1:8188'
const outDir = path.resolve('.claude', 'temp', 'comfy-smoke')

async function main() {
  try {
    const q = await queueState(lane, 4000)
    console.log(`ComfyUI reachable at ${lane} (running ${q.running}, pending ${q.pending})`)
  } catch (e) {
    console.log(`SKIPPED: ComfyUI not reachable at ${lane}: ${(e as Error).message}`)
    return
  }
  const client = createComfyClient({ config: parseComfyConfig({ lanes: [lane], queuePolicy: 'wait', pollIntervalMs: 1500 }) })
  const started = Date.now()
  const r = await client.generate({
    engine,
    prompt: 'soft watercolour storybook, a quiet harbour at dusk, wooden pier, gulls, warm light, no people, no text',
    width: 832,
    height: 464,
    onProgress: (p) => console.log(`  [${p.stage}] ${p.message}`)
  })
  await mkdir(outDir, { recursive: true })
  const raw = path.join(outDir, `background.${r.ext}`)
  await writeFile(raw, r.bytes)
  const fitted = path.join(outDir, 'background-1280x720.webp')
  await writeFile(fitted, await fitBackground(r.bytes, 1280, 720))
  console.log(`OK ${engine}: ${r.bytes.length} bytes in ${Math.round((Date.now() - started) / 1000)}s, seed ${r.seed}`)
  console.log(`  ${raw}\n  ${fitted}`)
}

main().catch((e) => {
  console.error(`FAILED: ${(e as Error).message}`)
  process.exit(1)
})
