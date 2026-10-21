---
kind: studios
# Pixel Studio (pixel art) and Chiptune Studio (music): the user's own apps. Each runs an MCP server.
# Start one without a window: `cd <repo> && yarn build && yarn mcp` (or `<exe> --mcp-only`).
pixelStudioUrl: http://127.0.0.1:7457/mcp
chiptuneStudioUrl: http://127.0.0.1:7458/mcp
# Where the code is: used for the start hints and to open a window ("Open in Pixel Studio / Chiptune Studio" on an asset).
pixelStudioRepo: C:\projects\Personal\pixel-art-generator
chiptuneStudioRepo: C:\projects\Personal\midi-generator
# A packaged app to launch instead of `yarn electron .` in the repo. Empty: use the repo.
pixelStudioExe: ''
chiptuneStudioExe: ''
# Bearer tokens, only when the app's MCP server asks for one (Settings -> MCP in the app). The environment variables
# PIXEL_STUDIO_MCP_TOKEN / CHIPTUNE_STUDIO_MCP_TOKEN and the credential store win over these two fields.
pixelStudioToken: ''
chiptuneStudioToken: ''
# Timeouts in seconds: short calls, an image import or export, a track render.
timeoutS: 15
importTimeoutS: 120
renderTimeoutS: 300
# The pixel-studio-draw mode (an agent draws small sprites): at most this many model steps and seconds per sprite.
drawSteps: 12
drawTimeoutS: 240
---
# Studios

Where VN Studio finds the two studio apps.

- `pixelStudioUrl`, `chiptuneStudioUrl`: the MCP endpoints (`VNO_PIXEL_STUDIO_URL` and `VNO_CHIPTUNE_STUDIO_URL` override them).
- `pixelStudioRepo`, `chiptuneStudioRepo`: the folders of the apps (start hints, and the window of "Open in ...").
- `pixelStudioExe`, `chiptuneStudioExe`: a packaged app to launch instead.
- `pixelStudioToken`, `chiptuneStudioToken`: the bearer token of an app whose MCP server needs one (shown in its Settings -> MCP). It is sent as `Authorization: Bearer <token>`. Where it is looked up, first match wins: the environment variable `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN`, the Windows credential store under the same name (`yarn key:set PIXEL_STUDIO_MCP_TOKEN`), then this field. Keep tokens out of files you share: prefer the first two. An app that answers 401 gives the message "rejected the token: set <VAR> ...". VibeTTS works the same way with `VIBETTS_MCP_TOKEN` (and `vibettsToken` in `config/voice.md`).
- A project picks them in the Look tab: music provider `chiptune` (the default for pixel-style books), pixel provider `pixel-studio`.
- When a studio is not running, a pixel image is made with the built-in converter instead (with a warning on the asset); music from Chiptune Studio fails with the start hint.
