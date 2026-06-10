#!/usr/bin/env bash
# Sync — Jira Mirror
# Downloads all matching Jira tickets to local JSON cache, one file per ticket.
# Tracks changes via per-ticket .meta files and marks deleted tickets with a
# synthetic changelog entry rather than removing them.
#
# Usage:
#   ./sync.sh               # normal sync
#   ./sync.sh --force       # re-download all tickets regardless of cache state
#   ./sync.sh --key PROJ-42 # force re-download a single ticket
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Config ─────────────────────────────────────────────────────────────────────
# Non-secret config from root config.env (skip TOOLS[] lines and comments)
if [[ -f "$SCRIPT_DIR/../../../config.env" ]]; then
  while IFS= read -r _line; do
    [[ -z "$_line" || "$_line" == \#* || "$_line" == *\[\]* || "$_line" != *=* ]] && continue
    _key="${_line%%=*}"
    _val="${_line#*=}"
    _key="${_key// /}"
    [[ -z "$_key" ]] && continue
    export "${_key}=${_val}"
  done < "$SCRIPT_DIR/../../../config.env"
fi

# Secrets from root .env (local dev) or environment variables (Azure)
[[ -f "$SCRIPT_DIR/../../../.env" ]] && source "$SCRIPT_DIR/../../../.env"

# Internal aliases — rest of script uses these names unchanged
SYNC_JIRA_URL="${JIRA_URL:-}"
SYNC_EMAIL="${JIRA_EMAIL:-}"
SYNC_PROJECTS="${PROJECTS:-}"
API_TOKEN="${JIRA_API_TOKEN:-}"

: "${SYNC_JIRA_URL:?JIRA_URL not set — add to .env or Azure App Settings}"
: "${SYNC_EMAIL:?JIRA_EMAIL not set — add to .env or Azure App Settings}"
: "${API_TOKEN:?JIRA_API_TOKEN not set — add to .env or Azure App Settings}"
: "${SYNC_PROJECTS:?PROJECTS not set in config.env}"
: "${SYNC_ISSUE_TYPES:?SYNC_ISSUE_TYPES not set in config.env}"
: "${SYNC_START_DATE:?SYNC_START_DATE not set in config.env}"

CACHE_DIR="$SCRIPT_DIR/../../data/bronze"
LOGS_DIR="$SCRIPT_DIR/../../data/logs"
mkdir -p "$CACHE_DIR" "$LOGS_DIR"

AUTH="$SYNC_EMAIL:$API_TOKEN"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Log filename uses dashes instead of colons so it's safe on all filesystems
LOG_FILE="$LOGS_DIR/$(echo "$NOW" | tr ':' '-').log"

# log() writes a timestamped line to the log file only (not terminal)
log() { printf "%s  %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >> "$LOG_FILE"; }

# ── Flags ──────────────────────────────────────────────────────────────────────
FORCE=false
FORCE_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)  FORCE=true; shift ;;
    --key)    FORCE_KEY="${2:?--key requires a ticket key}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *)        echo "ERROR: Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────
jira_get()  { curl -sf -u "$AUTH" -H "Accept: application/json" "$1"; }
jira_post() { curl -sf -u "$AUTH" -H "Accept: application/json" -H "Content-Type: application/json" -X POST -d "$2" "$1"; }

format_duration() {
  local secs=$1
  if   [[ $secs -lt 60 ]];   then printf "%ds"       "$secs"
  elif [[ $secs -lt 3600 ]]; then printf "%dm%02ds"  $(( secs/60 ))  $(( secs%60 ))
  else                             printf "%dh%02dm"  $(( secs/3600 )) $(( (secs%3600)/60 ))
  fi
}

# Throttled progress: print at most once every 2 seconds
_PROGRESS_LAST_T=0
progress() {
  local _t
  _t=$(date +%s)
  if (( _t - _PROGRESS_LAST_T >= 2 )); then
    echo "$1"
    _PROGRESS_LAST_T=$_t
  fi
}
progress_done() { :; }

echo "started=$NOW projects=$SYNC_PROJECTS types=$SYNC_ISSUE_TYPES since=$SYNC_START_DATE$([[ "$FORCE" == "true" ]] && echo " mode=force" || true)"

log "START  projects=$SYNC_PROJECTS  types=$SYNC_ISSUE_TYPES  since=$SYNC_START_DATE$([[ "$FORCE" == "true" ]] && echo "  mode=force" || true)"

# ── Single-ticket shortcut (--key mode) ───────────────────────────────────────
if [[ -n "$FORCE_KEY" ]]; then
  KEY="$FORCE_KEY"
  echo "fetching single ticket: $KEY"

  log "START  mode=--key  key=$KEY"

  ISSUE_JSON=$(jira_get "$SYNC_JIRA_URL/rest/api/3/issue/$KEY?expand=changelog") || {
    log "ERROR  $KEY  download failed"
    echo "[ERROR] Download failed: $KEY" >&2; exit 1
  }
  echo "$ISSUE_JSON" | jq empty 2>/dev/null || { log "ERROR  $KEY  invalid JSON"; echo "[ERROR] Invalid JSON for $KEY" >&2; exit 1; }

  JIRA_UPDATED=$(echo "$ISSUE_JSON" | jq -r '.fields.updated // ""')
  echo "$ISSUE_JSON" > "$CACHE_DIR/$KEY.json.tmp" && mv "$CACHE_DIR/$KEY.json.tmp" "$CACHE_DIR/$KEY.json"
  jq -n --arg u "$JIRA_UPDATED" --arg s "$NOW" \
    '{jira_updated: $u, last_synced: $s, deleted: false, deleted_detected: null}' \
    > "$CACHE_DIR/$KEY.meta.tmp" && mv "$CACHE_DIR/$KEY.meta.tmp" "$CACHE_DIR/$KEY.meta"

  log "FORCE  $KEY"
  log "DONE   mode=--key  key=$KEY"
  echo "done: $KEY saved"
  exit 0
fi

# ── Phase 1: Discovery (key + updated only — fast) ────────────────────────────
JQL="project in ($SYNC_PROJECTS) AND issuetype in ($SYNC_ISSUE_TYPES) AND created >= \"$SYNC_START_DATE\" ORDER BY created ASC"

DISCOVERED_FILE=$(mktemp)

PAGE_TOKEN=""
DISC_COUNT=0
DISC_PAGES=0

progress "Discovering..."

while true; do
  BODY=$(jq -n --arg jql "$JQL" --arg token "$PAGE_TOKEN" \
    '{jql: $jql, maxResults: 100, fields: ["updated"]}
     | if $token != "" then . + {nextPageToken: $token} else . end')

  RESPONSE=$(jira_post "$SYNC_JIRA_URL/rest/api/3/search/jql" "$BODY")

  API_ERR=$(echo "$RESPONSE" | jq -r '.errorMessages[]? // empty' 2>/dev/null)
  [[ -z "$API_ERR" ]] || { progress_done; echo "ERROR: Jira API: $API_ERR" >&2; exit 1; }

  echo "$RESPONSE" | jq -r '.issues[]? | .key + "|" + (.fields.updated // "")' >> "$DISCOVERED_FILE"

  PAGE_COUNT=$(echo "$RESPONSE" | jq '.issues | length // 0')
  DISC_COUNT=$(( DISC_COUNT + PAGE_COUNT ))
  DISC_PAGES=$(( DISC_PAGES + 1 ))
  progress "Discovering... $DISC_COUNT"

  PAGE_TOKEN=$(echo "$RESPONSE" | jq -r '.nextPageToken // empty')
  [[ -n "$PAGE_TOKEN" ]] || break
done

progress_done
echo "discovered=$DISC_COUNT"
log "DISCOVER  $DISC_COUNT tickets"

if [[ $DISC_COUNT -eq 0 ]]; then
  log "DONE  nothing to do"
  echo "nothing to do"
  exit 0
fi

DISC_TOTAL=$DISC_COUNT

# ── Phase 2: Download / Update ────────────────────────────────────────────────
PROC_START=$(date +%s)
PROCESSED=0
CNT_NEW=0
CNT_UPDATED=0
CNT_SKIPPED=0
CNT_ERROR=0

while IFS='|' read -r KEY JIRA_UPDATED; do
  [[ -n "$KEY" ]] || continue

  PROCESSED=$(( PROCESSED + 1 ))
  REMAINING=$(( DISC_TOTAL - PROCESSED ))

  JSON_FILE="$CACHE_DIR/$KEY.json"
  META_FILE="$CACHE_DIR/$KEY.meta"

  # ── Decide whether a download is needed ─────────────────────────────────────
  ACTION=""
  if [[ "$FORCE" == "true" ]]; then
    ACTION="force"
  elif [[ ! -f "$META_FILE" ]]; then
    ACTION="new"
  else
    STORED=$(jq -r '.jira_updated // ""' "$META_FILE" 2>/dev/null || echo "")
    [[ "$STORED" != "$JIRA_UPDATED" ]] && ACTION="updated"
  fi

  # ── ETA & rate ───────────────────────────────────────────────────────────────
  ELAPSED=$(( $(date +%s) - PROC_START ))
  if [[ $PROCESSED -gt 1 && $ELAPSED -gt 0 ]]; then
    ETA_SECS=$(( ELAPSED * REMAINING / PROCESSED ))
    ETA_STR=$(format_duration "$ETA_SECS")
    # avg seconds/ticket in tenths: e.g. 13 → "1.3s"
    AVG10=$(( (ELAPSED * 10) / PROCESSED ))
    RATE_STR="${AVG10%?}.${AVG10: -1}s/t"
  else
    ETA_STR="..."
    RATE_STR="--"
  fi

  PCT=$(( PROCESSED * 100 / DISC_TOTAL ))
  CNT_DL=$(( CNT_NEW + CNT_UPDATED ))

  progress "$PROCESSED/$DISC_TOTAL  eta=$ETA_STR  rate=$RATE_STR  new=$CNT_NEW updated=$CNT_UPDATED skipped=$CNT_SKIPPED"

  # ── Skip if up to date ───────────────────────────────────────────────────────
  if [[ -z "$ACTION" ]]; then
    CNT_SKIPPED=$(( CNT_SKIPPED + 1 ))
    continue
  fi

  # ── Download ─────────────────────────────────────────────────────────────────
  ISSUE_JSON=$(jira_get "$SYNC_JIRA_URL/rest/api/3/issue/$KEY?expand=changelog" 2>/dev/null) || {
    progress_done; echo "[ERROR] Download failed: $KEY" >&2
    log "ERROR  $KEY  download failed"
    CNT_ERROR=$(( CNT_ERROR + 1 ))
    continue
  }

  echo "$ISSUE_JSON" | jq empty 2>/dev/null || {
    progress_done; echo "[ERROR] Invalid JSON received for: $KEY" >&2
    log "ERROR  $KEY  invalid JSON"
    CNT_ERROR=$(( CNT_ERROR + 1 ))
    continue
  }

  # Write atomically
  echo "$ISSUE_JSON"  > "$JSON_FILE.tmp" && mv "$JSON_FILE.tmp" "$JSON_FILE"
  jq -n --arg u "$JIRA_UPDATED" --arg s "$NOW" \
    '{jira_updated: $u, last_synced: $s, deleted: false, deleted_detected: null}' \
    > "$META_FILE.tmp" && mv "$META_FILE.tmp" "$META_FILE"

  case "$ACTION" in
    new|force) CNT_NEW=$(( CNT_NEW + 1 ));     log "NEW     $KEY" ;;
    updated)   CNT_UPDATED=$(( CNT_UPDATED + 1 )); log "UPDATED $KEY" ;;
  esac

done < "$DISCOVERED_FILE"

# ── Phase 3: Deletion detection ───────────────────────────────────────────────
echo "checking deletions..."
CNT_DELETED=0
DELETED_KEYS=()

# Build a normalised comma-list of project keys for scope checking: "KEY1,KEY2,KEY3"
PROJECTS_NORM=$(echo "$SYNC_PROJECTS" | tr -d ' ')

# O(1) lookup set: one empty file per discovered key in a tmpdir
DISC_SET_DIR=$(mktemp -d)
trap 'rm -f "$DISCOVERED_FILE"; rm -rf "$DISC_SET_DIR"' EXIT
while IFS='|' read -r K _; do
  touch "$DISC_SET_DIR/$K"
done < "$DISCOVERED_FILE"

shopt -s nullglob
for META_FILE in "$CACHE_DIR"/*.meta; do
  KEY=$(basename "$META_FILE" .meta)

  # O(1) lookup instead of grep scan
  if [[ -f "$DISC_SET_DIR/$KEY" ]]; then continue; fi

  # Cheap grep instead of jq subprocess for deleted flag
  if grep -q '"deleted"[[:space:]]*:[[:space:]]*true' "$META_FILE"; then continue; fi

  # ── Scope checks: only flag as deleted if the ticket should be in current query ──
  # 1. Project must be in SYNC_PROJECTS
  PROJECT="${KEY%%-*}"
  echo ",$PROJECTS_NORM," | grep -qi ",${PROJECT}," || continue

  # 2. Created date must be >= SYNC_START_DATE (cheap grep, no jq)
  JSON_FILE="$CACHE_DIR/$KEY.json"
  if [[ -f "$JSON_FILE" ]]; then
    CREATED=$(grep -o '"created":"[^"]*"' "$JSON_FILE" 2>/dev/null | head -1 | cut -d'"' -f4 | cut -c1-10 || true)
    if [[ -n "$CREATED" && "$CREATED" < "$SYNC_START_DATE" ]]; then continue; fi
  fi

  # ── Genuinely not returned by Jira → mark as deleted ────────────────────────
  DELETED_KEYS+=("$KEY")

  if [[ -f "$JSON_FILE" ]]; then
    LAST_STATUS=$(jq -r '
      [.changelog.histories[]?.items[]? | select(.field == "status") | .toString]
      | last // "Unknown"
    ' "$JSON_FILE" 2>/dev/null || echo "Unknown")

    jq --arg now "$NOW" --arg from "$LAST_STATUS" '
      .changelog.histories += [{
        "_sync": {"synthetic": true, "event": "deleted"},
        "id":      "_sync_deleted",
        "created": $now,
        "items": [{
          "field":      "status",
          "fieldtype":  "jira",
          "fromString": $from,
          "toString":   "Deleted"
        }]
      }]
    ' "$JSON_FILE" > "$JSON_FILE.tmp" && mv "$JSON_FILE.tmp" "$JSON_FILE"
  fi

  jq --arg now "$NOW" '.deleted = true | .deleted_detected = $now' \
    "$META_FILE" > "$META_FILE.tmp" && mv "$META_FILE.tmp" "$META_FILE"

  log "DELETED $KEY"
  CNT_DELETED=$(( CNT_DELETED + 1 ))
done

progress_done

if [[ $CNT_DELETED -gt 0 ]]; then
  echo "deleted=${CNT_DELETED} keys=${DELETED_KEYS[*]}"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
TOTAL_ELAPSED=$(( $(date +%s) - PROC_START ))
ELAPSED_STR=$(format_duration "$TOTAL_ELAPSED")


CNT_API=$(( DISC_PAGES + CNT_NEW + CNT_UPDATED + CNT_ERROR ))
echo "new=$CNT_NEW updated=$CNT_UPDATED skipped=$CNT_SKIPPED deleted=$CNT_DELETED errors=$CNT_ERROR api_calls=$CNT_API time=$ELAPSED_STR"

log "SUMMARY  new=$CNT_NEW  updated=$CNT_UPDATED  skipped=$CNT_SKIPPED  deleted=$CNT_DELETED  errors=$CNT_ERROR  api_calls=$CNT_API  time=$ELAPSED_STR"
log "DONE"

echo "$NOW" > "$SCRIPT_DIR/../../data/last_sync.txt"
echo "done"

[[ $CNT_ERROR -eq 0 ]] || exit 1
