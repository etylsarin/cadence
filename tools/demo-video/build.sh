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
  08-planner
  09-wrapup
)

SCENE_TEXTS=(
  "Cadence is a Jira toolbox that turns your raw ticket data into delivery insights — and uses AI to help you act on them."
  "Eight tools. One sync pipeline. No changes to your Jira workflow."
  "Start by syncing your Jira project. The pipeline downloads every ticket, normalises the data, and computes delivery metrics — all locally, in seconds."
  "Ask natural-language questions about your delivery. How many stories shipped last sprint? What's blocking us right now? Cadence answers using your actual Jira data, not a generic model."
  "Flow Metrics shows cycle time, lead time, and stage breakdowns so you can see exactly where work is getting stuck — before it derails a release."
  "The Hygiene Auditor scans every ticket for missing story points, empty epics, and stale statuses — then generates an AI plan to fix them all at once."
  "Pick a Jira fix version and let AI draft your release notes. From raw tickets to polished markdown in one click."
  "The Epic Planner projects your delivery timeline from team throughput and epic scope — so you can give honest, data-backed dates."
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
    echo "🌐 Recording browser scene: $scene"
    node scripts/record-browser.mjs "$scene"
  else
    echo "🌐 Recording all browser scenes..."
    node scripts/record-browser.mjs
  fi
}

# ── title cards ───────────────────────────────────────────────
generate_title_cards() {
  echo "🎨 Generating title cards..."

  local dur_intro dur_wrapup
  dur_intro=$(audio_duration audio/01-intro.mp3 2>/dev/null || echo "8")
  dur_wrapup=$(audio_duration audio/09-wrapup.mp3 2>/dev/null || echo "9")

  local intro_dur; intro_dur=$(echo "$dur_intro + 1" | bc)
  local wrapup_dur; wrapup_dur=$(echo "$dur_wrapup + 2" | bc)

  echo "  🎬 01-intro (${intro_dur}s)"
  ffmpeg -y \
    -f lavfi -i "color=c=${BG_COLOR}:s=${WIDTH}x${HEIGHT}:d=${intro_dur}:r=30" \
    -vf "
      drawtext=text='Ca':fontsize=72:fontcolor=white:fontfile=/System/Library/Fonts/Helvetica.ttc:
        x=(w-tw)/2-20:y=(h-th)/2:font=Helvetica:fontweight=bold,
      drawtext=text='dence':fontsize=72:fontcolor=0x94a3b8:fontfile=/System/Library/Fonts/Helvetica.ttc:
        x=(w-tw)/2+50:y=(h-th)/2:font=Helvetica,
      drawtext=text='Your Jira data, finally working for you':fontsize=24:fontcolor=0x64748b:
        fontfile=/System/Library/Fonts/Helvetica.ttc:x=(w-tw)/2:y=(h-th)/2+80:font=Helvetica,
      format=yuv420p
    " \
    -c:v libx264 -preset fast -crf 18 -t "$intro_dur" \
    "clips/01-intro.mp4" 2>/dev/null
  echo "     → clips/01-intro.mp4"

  echo "  🎬 09-wrapup (${wrapup_dur}s)"
  ffmpeg -y \
    -f lavfi -i "color=c=${BG_COLOR}:s=${WIDTH}x${HEIGHT}:d=${wrapup_dur}:r=30" \
    -vf "
      drawtext=text='Ca':fontsize=72:fontcolor=white:fontfile=/System/Library/Fonts/Helvetica.ttc:
        x=(w-tw)/2-20:y=(h-th)/2:font=Helvetica:fontweight=bold,
      drawtext=text='dence':fontsize=72:fontcolor=0x94a3b8:fontfile=/System/Library/Fonts/Helvetica.ttc:
        x=(w-tw)/2+50:y=(h-th)/2:font=Helvetica,
      drawtext=text='cadence.dev':fontsize=20:fontcolor=0x3b82f6:
        fontfile=/System/Library/Fonts/Helvetica.ttc:x=(w-tw)/2:y=(h-th)/2+80:font=Helvetica,
      fade=t=out:st=$(echo "$wrapup_dur - 2" | bc):d=2,
      format=yuv420p
    " \
    -c:v libx264 -preset fast -crf 18 -t "$wrapup_dur" \
    "clips/09-wrapup.mp4" 2>/dev/null
  echo "     → clips/09-wrapup.mp4"

  echo "✅ Title cards done."
}

# ── compose ───────────────────────────────────────────────────
compose_video() {
  echo "🎬 Composing final video..."

  # Dark pause clip between scenes (0.8s)
  local pause_clip="clips/_pause.mp4"
  ffmpeg -y \
    -f lavfi -i "color=c=${BG_COLOR}:s=${WIDTH}x${HEIGHT}:d=0.8:r=30" \
    -f lavfi -i "anullsrc=r=44100:cl=stereo" \
    -c:v libx264 -preset fast -crf 18 \
    -c:a aac -b:a 128k \
    -t 0.8 -shortest \
    "$pause_clip" 2>/dev/null

  # Merge video + audio per scene
  local scene_clips=()
  for key in "${SCENE_KEYS[@]}"; do
    local vid="clips/${key}.mp4"
    local aud="audio/${key}.mp3"
    local merged="clips/_scene-${key}.mp4"

    if [[ ! -f "$vid" ]]; then
      echo "  ⚠️  Missing clip: $vid — skipping"
      continue
    fi

    if [[ -f "$aud" ]]; then
      ffmpeg -y -i "$vid" -i "$aud" \
        -c:v libx264 -c:a aac -shortest \
        "$merged" 2>/dev/null
    else
      cp "$vid" "$merged"
    fi
    scene_clips+=("$merged")
  done

  # Build concat list with pauses between scenes
  local concat_file="clips/_concat.txt"
  : > "$concat_file"
  local first=1
  for clip in "${scene_clips[@]}"; do
    if [[ $first -eq 0 ]]; then
      echo "file '$(realpath "$pause_clip")'" >> "$concat_file"
    fi
    echo "file '$(realpath "$clip")'" >> "$concat_file"
    first=0
  done

  # Concatenate
  local no_music="output/_no-music.mp4"
  ffmpeg -y -f concat -safe 0 -i "$concat_file" \
    -c:v libx264 -c:a aac \
    "$no_music" 2>/dev/null

  # Mix in background music
  local total_dur; total_dur=$(audio_duration "$no_music")
  local final="output/cadence-demo.mp4"
  local fade_start; fade_start=$(echo "$total_dur - 4" | bc)

  ffmpeg -y \
    -i "$no_music" \
    -stream_loop -1 -i assets/bg-music.mp3 \
    -filter_complex "
      [1:a]afade=t=out:st=${fade_start}:d=4,volume=0.12[music];
      [0:a][music]amix=inputs=2:duration=first:dropout_transition=0[aout]
    " \
    -map 0:v -map "[aout]" \
    -c:v copy -c:a aac -b:a 128k \
    -t "$total_dur" \
    "$final" 2>/dev/null

  echo "✅ Output: $final  (${total_dur}s)"
}

# ── all ───────────────────────────────────────────────────────
run_all() {
  check_tools
  generate_tts
  generate_title_cards
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
  browser)     record_browser "${1:-}" ;;
  cards)       generate_title_cards ;;
  compose)     compose_video ;;
  all)         run_all ;;
  *)
    echo "Usage: ./build.sh <check|tts|screenshots|browser [scene]|cards|compose|all>"
    ;;
esac
