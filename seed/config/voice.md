---
kind: voice
# VibeTTS: the local text-to-speech app (fixed voices: Kokoro for English, Supertonic for 31 languages including Croatian;
# download Supertonic in VibeTTS Settings > Supertonic). Its MCP server must be running:
# `python -m vibetts --mcp-only` in C:\projects\Personal\vibe-tts-flow, or Settings > Agents (MCP) in the app.
vibettsUrl: http://127.0.0.1:7723/mcp
# Bearer token, only when VibeTTS asks for one. The environment variable VIBETTS_MCP_TOKEN and the credential store win over this field.
vibettsToken: ''
# Speech speed, 0.5 to 2.
speed: 1
# Format of the clips: mp3 (small) or wav.
format: mp3
# How many beats go into one synthesize_batch call. A stopped job continues from the last finished batch.
chunkSize: 20
# Timeouts in seconds: short calls, one voice preview (the model loads on the first call), one batch.
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

The voices are fixed: Kokoro voices (`af_heart`, ...) read English only, Supertonic voices (`supertonic:F1` .. `F5`, `M1` .. `M5`) read 31 languages. Each book keeps its own cast (`voice.voices` in its project.md): per character and narrator, one voice per edition language, for example Kokoro for `en` and Supertonic for `hr`. `voice.englishEngine` (`kokoro`, the default, or `supertonic`) says which engine reads English; every other language uses Supertonic. Plan voices assigns them (existing ones are kept unless you overwrite) and the Voice tab changes a single one.
