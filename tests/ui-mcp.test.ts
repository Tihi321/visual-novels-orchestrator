import { describe, expect, it } from 'vitest'
import { mcpSnippets } from '../src/renderer/lib/mcp'
import { vnStore } from '../src/renderer/store/store'

describe('MCP settings state', () => {
  it('keeps the last mcp.status the engine sent', () => {
    expect(vnStore.getState().mcp).toBeNull()
    vnStore.getState().applyEvents([{ type: 'mcp.status', enabled: true, listening: true, url: 'http://127.0.0.1:7459/mcp', error: '', port: 7459, tokenSet: false }])
    expect(vnStore.getState().mcp).toMatchObject({ listening: true, port: 7459 })
    vnStore.getState().applyEvents([{ type: 'mcp.status', enabled: true, listening: false, url: null, error: 'Port 7459 is already in use.', port: 7459, tokenSet: true }])
    expect(vnStore.getState().mcp).toMatchObject({ listening: false, error: 'Port 7459 is already in use.', tokenSet: true })
  })

  it('builds the snippets', () => {
    const s = mcpSnippets('http://127.0.0.1:7459/mcp', false)
    expect(s.http).toBe('claude mcp add --transport http vn-studio http://127.0.0.1:7459/mcp')
    expect(mcpSnippets('http://127.0.0.1:7500/mcp', true).http).toMatch(/--header "Authorization: Bearer <token>"$/)
    expect(s.stdio).toMatch(/engine -- mcp$/)
    expect(s.headless).toMatch(/--mcp-only/)
  })
})
