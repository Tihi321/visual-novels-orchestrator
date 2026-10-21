import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RTL_VARIABLES, renderRtl } from '../src/engine/renpy/rtl'

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

describe('right-to-left layout', () => {
  const gui = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'renpy', 'game', 'gui.rpy'), 'utf8')

  it('the table holds the template values: each ltr value is the one in gui.rpy', () => {
    for (const v of RTL_VARIABLES) {
      const m = new RegExp(`^define gui\\.${v.name} = (\\S+)\\s*$`, 'm').exec(gui)
      expect(m, v.name).not.toBeNull()
      expect(Number(m![1]), v.name).toBe(v.ltr)
    }
  })

  it('the navigation screen and the return button use the anchor hook, which is 0.0 for left-to-right', () => {
    expect(gui).toMatch(/^define gui\.navigation_xanchor = 0\.0$/m)
    expect(screenBody('navigation')).toMatch(/xpos gui\.navigation_xpos\s+xanchor gui\.navigation_xanchor/)
    expect(screens).toMatch(/style return_button:\s+xpos gui\.navigation_xpos\s+xanchor gui\.navigation_xanchor/)
  })

  it('mirrors the layout for Arabic at 1920x1080', () => {
    const rpy = renderRtl(['arabic'], ['None', 'croatian'], 1920)
    expect(rpy).toContain('define config.rtl = True')
    const arabic = rpy.slice(rpy.indexOf('translate arabic python:'), rpy.indexOf('translate None python:'))
    expect(arabic).toContain('    gui.name_xpos = 1560\n')
    expect(arabic).toContain('    gui.name_xalign = 1.0\n')
    expect(arabic).toContain('    gui.dialogue_text_xalign = 1.0\n')
    expect(arabic).toContain('    gui.navigation_xpos = 1860\n')
    expect(arabic).toContain('    gui.navigation_xanchor = 1.0\n')
    expect(arabic).toContain('    gui.main_menu_text_xalign = 0.0\n')
    expect(arabic).toContain('    gui.history_name_xpos = 1687\n')
    expect(arabic).toContain('    gui.history_text_xalign = 1.0\n')
    expect(arabic).not.toContain('choice_button_text_xalign')
    // the other languages of the game get the template values back, so switching language mirrors and unmirrors
    const none = rpy.slice(rpy.indexOf('translate None python:'), rpy.indexOf('translate croatian python:'))
    expect(none).toContain('    gui.name_xpos = 360\n')
    expect(none).toContain('    gui.navigation_xanchor = 0.0\n')
    expect(rpy).toContain('translate croatian python:')
  })

  it('uses the screen width for the positions (1280x720)', () => {
    const rpy = renderRtl(['hebrew'], [], 1280)
    expect(rpy).toContain('    gui.name_xpos = 920\n')
    expect(rpy).toContain('    gui.navigation_xpos = 1220\n')
    expect(rpy).toContain('    gui.history_name_xpos = 1047\n')
    expect(rpy).not.toContain('translate None')
  })
})
