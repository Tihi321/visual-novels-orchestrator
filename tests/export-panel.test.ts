import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { storyInputSchema } from '../src/engine/vn/story'
import type { EngineEvent } from '../src/shared/protocol'
import { makeVnEnv } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

/** VNO-56: the Build tab's `exportBook` command reaches the same export function as the MCP tool, in a temp data folder, and answers with `export.result`. */
describe('exportBook command', () => {
  let env: VnEnv
  beforeEach(async () => {
    env = await makeVnEnv({ sdk: false })
  })
  afterEach(async () => {
    await env.cleanup()
  })
  const last = (): Extract<EngineEvent, { type: 'export.result' }> => env.events.filter((e) => e.type === 'export.result').at(-1) as Extract<EngineEvent, { type: 'export.result' }>

  it('answers the dry run with counts, writes an EPUB, and reports a failure as an error', async () => {
    const story = storyInputSchema.parse({
      title: 'Fork',
      characters: [{ name: 'Mara' }],
      chapters: [
        { title: 'Start', scenes: [{ place: 'harbour', beats: [{ text: 'The sea was calm.' }] }], choices: [{ text: 'Go left', to: 2 }, { text: 'Go right', to: 3 }] },
        { title: 'Left', scenes: [{ place: 'harbour', beats: [{ text: 'Left.' }] }], ending: 'The end.' },
        { title: 'Right', scenes: [{ place: 'harbour', beats: [{ text: 'Right.' }] }], ending: 'The end.' }
      ]
    })
    const { slug } = await env.engine.vn.createProject(story)

    await env.engine.handleCommand({ type: 'exportBook', slug, format: 'plan' })
    expect(last()).toMatchObject({ slug, format: 'plan', result: { mode: 'gamebook', sections: 3, stale: false } })
    expect(Object.keys(last().result!.sectionMap!.sections)).toHaveLength(3)
    expect(last().result?.path).toBeUndefined()

    await env.engine.handleCommand({ type: 'exportBook', slug, format: 'epub', order: 'in-order' })
    const written = last().result
    expect(written?.path).toMatch(/\.epub$/)
    expect(existsSync(written!.path!)).toBe(true)
    expect((await env.engine.vn.detail(slug)).lastExport?.path).toBe(written!.path) // kept on the project

    await env.engine.handleCommand({ type: 'exportBook', slug, format: 'plan', lang: 'ar' })
    expect(last().error).toMatch(/no ar edition/)
  })
})
