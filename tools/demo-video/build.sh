#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# Cadence Demo Video — Build Script
#
# Approach: generate audio per scene → measure durations →
#           record browser scenes via Playwright →
#           compose with title cards + background music.
#
# Usage:
#   ./build.sh check            Verify tools
#   ./build.sh screenshots      Take PNG screenshots of each tool
#   ./build.sh tts              Generate TTS narration audio
#   ./build.sh browser          Record all browser scenes via Playwright
#   ./build.sh browser 04-ask   Record a single browser scene
#   ./build.sh cards            Generate title card clips (01-intro, 09-wrapup)
#   ./build.sh compose          Compose final video (needs all clips + audio)
#   ./build.sh all              Full pipeline
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="$PATH:$HOME/Library/Python/3.9/bin:$HOME/Library/Python/3.10/bin:$HOME/Library/Python/3.11/bin:$HOME/Library/Python/3.12/bin"

mkdir -p clips audio output screenshots

WIDTH=1280
HEIGHT=720
BG_COLOR="0x0d1117"   # dark navy, matches Cadence dark mode

# App
CADENCE_URL="${CADENCE_URL:-http://localhost:8765}"
CADENCE_USER="${CADENCE_USER:-filip}"
CADENCE_PASS="${CADENCE_PASS:-cadence-test}"
export CADENCE_URL CADENCE_USER CADENCE_PASS

# TTS
TTS_VOICE="${TTS_VOICE:-en-US-AvaNeural}"

# ── Scenes (parallel arrays) ──────────────────────────────────
SCENE_KEYS=(
  01-intro
  02-overview
  03-sync
  04-ask
  05-flow-metrics
  06-hygiene
  07-release-notes
  08-sprint-summary
  09-planner
  10-prompt-builder
  11-wrapup
)

SCENE_TEXTS=(
  "Cadence turns your Jira data into delivery insights — and uses AI to help you act on them."
  "Eight tools in one place. One sync pipeline. No changes to how your team works in Jira."
  "Start by syncing your Jira project. The pipeline pre-computes delivery metrics so every tool runs instantly — even across thousands of tickets."
  "Ask natural-language questions about your delivery. How many stories shipped last sprint? What's blocking us? Cadence answers using your actual Jira data, not guesswork."
  "Flow Metrics shows cycle time, lead time, and a stage-by-stage breakdown of where work gets stuck. Click any stage to drill into the tickets slowing you down."
  "The Hygiene Auditor scans every ticket for missing story points, empty epics, and stale statuses — then generates an AI plan to fix them."
  "Pick a fix version and click Generate. In seconds you have polished release notes, grouped by type, ready to paste into Confluence or Slack."
  "Sprint Summary gives a live view of velocity, burndown, and completed work — a stakeholder-ready sprint overview in seconds."
  "The Epic Planner simulates your delivery timeline from team throughput and epic scope. Set a start date and get a data-backed forecast."
  "Prompt Builder turns any ticket into a complete, context-rich Claude prompt — description, epic, linked issues, all in one click."
  "Cadence. Your Jira data, finally working for you."
)

# ── Helpers ───────────────────────────────────────────────────
audio_duration() {
  ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$1"
}

# ── check ─────────────────────────────────────────────────────
check_tools() {
  local missing=0
  for cmd in ffmpeg ffprobe node bc; do
    if command -v "$cmd" &>/dev/null; then
      echo "✅ $cmd"
    else
      echo "❌ Missing: $cmd"
      missing=1
    fi
  done

  if command -v edge-tts &>/dev/null; then
    echo "✅ edge-tts"
  else
    echo "❌ Missing: edge-tts  (pip install edge-tts)"
    missing=1
  fi

  if [[ -d node_modules/playwright ]]; then
    echo "✅ playwright (node_modules)"
  else
    echo "❌ Missing: playwright  (run: npm install)"
    missing=1
  fi

  [[ $missing -eq 1 ]] && { echo -e "\nRun: npm install && pip install edge-tts"; exit 1; }
  echo -e "\nAll tools ready."
}

# ── tts ───────────────────────────────────────────────────────
generate_tts() {
  echo "🎙  Generating voiceover..."

  for i in "${!SCENE_KEYS[@]}"; do
    local key="${SCENE_KEYS[$i]}"
    local text="${SCENE_TEXTS[$i]}"
    local outfile="audio/${key}.mp3"

    if [[ -f "$outfile" ]]; then
      local dur; dur=$(audio_duration "$outfile")
      echo "  ⏭  ${key}.mp3 (${dur}s) — cached"
      continue
    fi

    echo "  🔊 ${key}.mp3"
    edge-tts --voice "$TTS_VOICE" --text "$text" --write-media "$outfile" 2>/dev/null
    local dur; dur=$(audio_duration "$outfile")
    echo "     → ${dur}s"
  done

  echo -e "\n✅ Audio done."
}

# ── screenshots ───────────────────────────────────────────────
take_screenshots() {
  echo "📸 Taking screenshots..."
  node scripts/take-screenshots.mjs
}

# ── browser ───────────────────────────────────────────────────
record_browser() {
  local scene="${1:-}"
  if [[ -n "$scene" ]]; then
    echo "🌐 Recording scene: $scene"
  else
    echo "🌐 Recording all scenes..."
  fi
  node scripts/record-browser.mjs $scene
}

# ── compose ───────────────────────────────────────────────────
compose_video() {
  echo "🎬 Composing final video..."

  local music_dur; music_dur=$(audio_duration assets/bg-music.mp3)
  local final="output/cadence-demo.mp4"
  local fade_start; fade_start=$(echo "$music_dur - 4" | bc)

  # ── Decide video source: individual clips (preferred) or legacy raw file ──
  local use_clips=1
  for key in "${SCENE_KEYS[@]}"; do
    [[ ! -f "clips/${key}.mp4" ]] && { use_clips=0; break; }
  done

  local video_src
  if [[ $use_clips -eq 1 ]]; then
    echo "  🎞  Trimming and concatenating individual clips..."

    local concat_video="clips/_concat.txt"
    : > "$concat_video"
    local n="${#SCENE_KEYS[@]}"

    for i in "${!SCENE_KEYS[@]}"; do
      local key="${SCENE_KEYS[$i]}"
      local aud_dur; aud_dur=$(audio_duration "audio/${key}.mp3")
      # Trim 1s from the start (skips about:blank / page-load blank) then keep
      # audio_dur + 1.0s so the scene holds for 1s after narration finishes.
      local trim_dur; trim_dur=$(echo "$aud_dur + 1.0" | bc)
      local trimmed="clips/${key}-trimmed.mp4"
      ffmpeg -y -ss 1.0 -i "clips/${key}.mp4" -t "$trim_dur" \
        -c:v libx264 -preset fast -crf 20 "$trimmed" 2>/dev/null
      echo "file '$(realpath "$trimmed")'" >> "$concat_video"
      echo "  ✂  ${key}: skip 1s + keep ${trim_dur}s"
    done

    video_src="clips/_combined.mp4"
    ffmpeg -y -f concat -safe 0 -i "$concat_video" \
      -c:v libx264 -preset fast "$video_src" 2>/dev/null
    echo "  ✅ Combined video: $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$video_src")s"
  else
    video_src="clips/cadence-demo-raw.mp4"
    if [[ ! -f "$video_src" ]]; then
      echo "❌ No clips found — run: ./build.sh browser first"
      exit 1
    fi
    echo "  ⚠️  Individual clips not found, using legacy raw file"
  fi

  # ── Build narration audio track (concat all scenes with 1.0s silence gaps) ──
  # 1s pause matches the 1s clip trim excess so narration ends exactly with each clip.
  local has_audio=0
  for key in "${SCENE_KEYS[@]}"; do
    [[ -f "audio/${key}.mp3" ]] && { has_audio=1; break; }
  done

  if [[ $has_audio -eq 1 ]]; then
    echo "  🎙  Building narration track..."

    # Pause must be MP3 to match scene files — concat demuxer silently drops
    # files whose codec differs from the first file in the list.
    ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=stereo" \
      -t 1.0 -c:a libmp3lame -b:a 128k "audio/_pause.mp3" 2>/dev/null

    local concat_audio="audio/_narration_concat.txt"
    : > "$concat_audio"
    local first=1
    for key in "${SCENE_KEYS[@]}"; do
      [[ $first -eq 0 ]] && echo "file '$(realpath "audio/_pause.mp3")'" >> "$concat_audio"
      echo "file '$(realpath "audio/${key}.mp3")'" >> "$concat_audio"
      first=0
    done

    ffmpeg -y -f concat -safe 0 -i "$concat_audio" \
      -c:a aac -b:a 128k "audio/_narration.aac" 2>/dev/null

    # No adelay needed: 1s trimmed from clip start so content is visible at t=0.
    ffmpeg -y \
      -i "$video_src" \
      -i "audio/_narration.aac" \
      -stream_loop -1 -i assets/bg-music.mp3 \
      -filter_complex "
        [2:a]afade=t=out:st=${fade_start}:d=4,volume=0.12[music];
        [1:a][music]amix=inputs=2:duration=longest:dropout_transition=0[aout]
      " \
      -map 0:v -map "[aout]" \
      -c:v libx264 -preset fast -c:a aac -b:a 128k \
      -t "$music_dur" \
      "$final" 2>/dev/null
  else
    echo "  ℹ️  No narration audio — mixing background music only"
    ffmpeg -y \
      -i "$video_src" \
      -stream_loop -1 -i assets/bg-music.mp3 \
      -filter_complex "
        [1:a]afade=t=out:st=${fade_start}:d=4,volume=0.25[music];
        [music]anull[aout]
      " \
      -map 0:v -map "[aout]" \
      -c:v libx264 -preset fast -c:a aac -b:a 128k \
      -t "$music_dur" \
      "$final" 2>/dev/null
  fi

  echo "✅ Output: $final  (${music_dur}s)"
}

# ── all ───────────────────────────────────────────────────────
run_all() {
  check_tools
  generate_tts
  record_browser
  compose_video
}

# ── dispatch ──────────────────────────────────────────────────
CMD="${1:-help}"
shift || true

case "$CMD" in
  check)       check_tools ;;
  tts)         generate_tts ;;
  screenshots) take_screenshots ;;
  browser)     record_browser "$@" ;;
  compose)     compose_video ;;
  all)         run_all ;;
  *)
    echo "Usage: ./build.sh <check|tts|screenshots|browser [scene-key]|compose|all>"
    ;;
esac
