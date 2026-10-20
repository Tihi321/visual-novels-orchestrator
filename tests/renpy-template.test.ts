import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const screens = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'renpy', 'game', 'screens.rpy'), 'utf8')

/** The body of one screen: from `screen <name>` to the next top-level statement. */
function screenBody(name: string): string {
  const start = screens.search(new RegExp(`^screen ${name}\\b`, 'm'))
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = screens.slice(screens.indexOf('\n', start) + 1)
  const end = rest.search(/^\S/m)
  return end < 0 ? rest : rest.slice(0, end)
}

describe('Ren\'Py template', () => {
  it('the end screen restarts with Jump("start"): Start() only works from the main menu and crashes in the game', () => {
    const body = screenBody('the_end')
    expect(body).toContain('Jump("start")')
    expect(body).not.toMatch(/action\s+Start\(\)/)
  })
})
