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
# The pixel-studio-draw mode (an agent draws small sprites): at most this many model steps and seconds per sprite (0 seconds: no limit).
drawSteps: 12
drawTimeoutS: 240
# How the sprite is drawn: auto, loop or grid (see below). auto: grid when the job's model is the client (an MCP client), else loop.
drawMode: auto
---
# Studios

Where VN Studio finds the two studio apps.

- `pixelStudioUrl`, `chiptuneStudioUrl`: the MCP endpoints (`VNO_PIXEL_STUDIO_URL` and `VNO_CHIPTUNE_STUDIO_URL` override them).
- `pixelStudioRepo`, `chiptuneStudioRepo`: the folders of the apps (start hints, and the window of "Open in ...").
- `pixelStudioExe`, `chiptuneStudioExe`: a packaged app to launch instead.
- `pixelStudioToken`, `chiptuneStudioToken`: the bearer token of an app whose MCP server needs one (shown in its Settings -> MCP). It is sent as `Authorization: Bearer <token>`. Where it is looked up, first match wins: the environment variable `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN`, the Windows credential store under the same name (`yarn key:set PIXEL_STUDIO_MCP_TOKEN`), then this field. Keep tokens out of files you share: prefer the first two. An app that answers 401 gives the message "rejected the token: set <VAR> ...". VibeTTS works the same way with `VIBETTS_MCP_TOKEN` (and `vibettsToken` in `config/voice.md`).
- A project picks them in the Look tab: music provider `chiptune` (the default for pixel-style books), pixel provider `pixel-studio`.
- `drawSteps`, `drawTimeoutS`, `drawMode`: how a sprite is drawn in the `pixel-studio-draw` mode (Look tab, pixel art). `loop`: the model calls Pixel Studio's drawing tools turn by turn, up to `drawSteps` turns and `drawTimeoutS` seconds (checked between turns). `grid`: one model request for the whole sprite, with no time limit: the reference is reduced to the palette and sent as rows of characters (`.` transparent, `0-9a-zA-Z` the palette colours, as in Pixel Studio's `draw_grid`), the model answers the cleaned-up rows, and VN Studio paints them with `draw_grid` calls of at most 64x64 pixels and exports as the loop does (so "Open in Pixel Studio" works). Rows that do not fit the grid get one repair round, then the image is converted instead. Without Pixel Studio running, the PNG is built from the rows here. `auto` picks `grid` for a client model (it can take minutes per answer) and `loop` for any other; with a client model the loop has no time limit either.
- When a studio is not running, VN Studio starts it first if a job needs it (`config/autostart.md`, from the creative hub's `services.json`). Only when that fails (or is off) is a pixel image made with the built-in converter instead (with a warning on the asset), and music from Chiptune Studio fails with the start hint.
