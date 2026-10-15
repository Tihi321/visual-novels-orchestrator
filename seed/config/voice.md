---
kind: voice
# VibeTTS: the local text-to-speech app (OmniVoice voices, English and Croatian). Its MCP server must be running:
# `python -m vibetts --mcp-only` in C:\projects\Personal\vibe-tts-flow, or Settings > Agents (MCP) in the app.
vibettsUrl: http://127.0.0.1:7723/mcp
# Speech speed, 0.5 to 2.
speed: 1
# Format of the clips: mp3 (small) or wav.
format: mp3
# How many beats go into one synthesize_batch call. A stopped job continues from the last finished batch.
chunkSize: 20
# Timeouts in seconds: short calls, one voice (create or preview), one batch.
timeoutS: 15
voiceTimeoutS: 180
batchTimeoutS: 900
---
# Voice

How the spoken lines are made when a book's voice provider is `vibetts` (the default; the ComfyUI TTS workflows are the other provider).

- `vibettsUrl`: the VibeTTS MCP endpoint (`VNO_VIBETTS_URL` overrides it).
- `speed`, `format`: speech speed and clip format. Clips whose text, voice, language, speed and format did not change are skipped.
- `chunkSize`: beats per batch call.
- The timeouts are in seconds. The first call loads the voice model, so the first batch takes longer.

Each book keeps its own character voices (`voice.voices` in its project.md); the same voice speaks every edition of the book, with the language passed per clip.
