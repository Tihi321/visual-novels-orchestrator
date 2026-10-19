import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import guideText from '../../../docs/mcp-guide.md?raw'
import { callTool, toolList } from './tools'
import type { Tool } from './tools'

/**
 * The MCP server object: `initialize`, `tools/list`, `tools/call` and the guide resource, on the SDK's `Server`. `http.ts` makes one per
 * HTTP session, `stdio.ts` one for the stdio transport. The tools drive the same service as the app and the CLI, so Claude Code (or
 * any agent) can list books, import them, run the pipeline, replace assets and build the game.
 *
 *   claude mcp add --transport http vn-studio http://127.0.0.1:7459/mcp
 *   claude mcp add vn-studio -- yarn --cwd <repo> engine -- mcp
 */

export const SERVER_INFO = { name: 'vn-studio', version: '0.0.1' }
export const GUIDE_URI = 'vn-studio://guide'
export const GUIDE = guideText

/** The short workflow every client gets in `initialize`; the full guide is the resource `vn-studio://guide`. */
export const INSTRUCTIONS = `VN Studio turns Scriptorium books into Ren'Py visual novels. Workflow: vno_list_books, vno_import (gives the project slug), vno_run_pipeline (analyse, art, music, generate, stage, build, lint; restartable from any step), vno_status to follow it (or pass wait / call vno_wait), vno_asset_list and vno_asset_regen / vno_asset_replace to change assets, vno_build for the game, vno_add_edition for a translated edition. Voices: each character has one voice per edition language; Kokoro voices read English only, supertonic:F1..F5 and supertonic:M1..M5 read any language; see vno_voice_status, vno_voice_plan, vno_voice_set, vno_voice_preview and vno_voice_generate. Long calls return job ids at once. Read the resource ${GUIDE_URI} for the full guide.`

export interface McpHost {
  tools: readonly Tool[]
  /** Text of the guide resource (default: docs/mcp-guide.md). */
  guide?: string
  /** `instructions` of initialize (default: INSTRUCTIONS). */
  instructions?: string
}

export function createMcpServer(host: McpHost): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {}, resources: {} }, instructions: host.instructions ?? INSTRUCTIONS })
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolList(host.tools) }))
  // each call is its own async handler, so a long `wait` never holds back the other calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(host.tools, request.params.name, request.params.arguments))
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [{ uri: GUIDE_URI, name: 'VN Studio guide', description: 'The workflow, the tools and how voices work.', mimeType: 'text/markdown' }] }))
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== GUIDE_URI) throw new Error(`Unknown resource ${request.params.uri}`)
    return { contents: [{ uri: GUIDE_URI, mimeType: 'text/markdown', text: host.guide ?? GUIDE }] }
  })
  return server
}
