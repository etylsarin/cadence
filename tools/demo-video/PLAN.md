# Cadence Demo Video — Production Plan

## Approach

Audio-first pipeline:

1. **Write narration** → `script.md`
2. **Generate TTS audio** (`edge-tts`, voice `en-US-AvaNeural`) → `audio/`
3. **Record browser scenes** — Playwright for all scenes (Scenes 2–8)
4. **Generate title cards** — FFmpeg dark-bg + text (Scenes 1, 9)
5. **Compose** — merge video+audio per scene, concat, mix in background music

## Output spec

- Resolution: 1280×720 (YouTube 720p)
- Frame rate: 30 fps
- Audio: AAC 128 kbps
- Duration: 103s (matches `assets/bg-music.mp3` exactly — no loop, no fade awkwardness)
- Music: `assets/bg-music.mp3` at 12% volume, 4s fade-out at end

## Scene recording methods

| Scene | File | Method |
|-------|------|---------|
| 01-intro | clips/01-intro.mp4 | FFmpeg title card |
| 02-overview | clips/02-overview.mp4 | Playwright |
| 03-sync | clips/03-sync.mp4 | Playwright |
| 04-ask | clips/04-ask.mp4 | Playwright |
| 05-flow-metrics | clips/05-flow-metrics.mp4 | Playwright |
| 06-hygiene | clips/06-hygiene.mp4 | Playwright |
| 07-release-notes | clips/07-release-notes.mp4 | Playwright |
| 08-planner | clips/08-planner.mp4 | Playwright |
| 09-wrapup | clips/09-wrapup.mp4 | FFmpeg title card |

## Dependencies

```
ffmpeg       # video composition
ffprobe      # audio duration measurement
edge-tts     # TTS (pip install edge-tts)
node         # runtime for Playwright scripts
playwright   # browser recording (npm install in this dir)
bc           # float arithmetic
```

## App prerequisites

Cadence must be running locally (`./run.sh dev` or `./run.sh prod` from repo root)
and seeded with sync data before recording browser scenes.

Default: `http://localhost:8765`
Auth credentials read from `CADENCE_URL`, `CADENCE_USER`, `CADENCE_PASS` env vars.
