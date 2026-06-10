#!/usr/bin/env bash
# Sync Repair
# Reverses false deletions: strips synthetic "_sync deleted" changelog entries
# from JSON files and resets meta files back to deleted=false.
#
# Usage:
#   ./sync-repair.sh          # dry run — shows what would be repaired
#   ./sync-repair.sh --apply  # apply the repairs
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="$SCRIPT_DIR/../../data/bronze"

DRY_RUN=true
[[ "${1:-}" == "--apply" ]] && DRY_RUN=false

CNT_FIXED=0
CNT_SKIPPED=0

shopt -s nullglob
for META_FILE in "$CACHE_DIR"/*.meta; do
  KEY=$(basename "$META_FILE" .meta)

  IS_DELETED=$(jq -r '.deleted // false' "$META_FILE" 2>/dev/null || echo "false")
  [[ "$IS_DELETED" == "true" ]] || continue

  JSON_FILE="$CACHE_DIR/$KEY.json"

  # Check if JSON has a synthetic deletion entry
  HAS_SYNTHETIC="false"
  if [[ -f "$JSON_FILE" ]]; then
    HAS_SYNTHETIC=$(jq '[.changelog.histories[]? | select(._sync.synthetic == true)] | length > 0' "$JSON_FILE" 2>/dev/null || echo "false")
  fi

  echo "$KEY  (synthetic=$HAS_SYNTHETIC)"
  CNT_FIXED=$(( CNT_FIXED + 1 ))

  [[ "$DRY_RUN" == "true" ]] && continue

  # Strip all synthetic entries from changelog
  if [[ -f "$JSON_FILE" && "$HAS_SYNTHETIC" == "true" ]]; then
    jq '.changelog.histories = [.changelog.histories[]? | select(._sync.synthetic != true)]' \
      "$JSON_FILE" > "$JSON_FILE.tmp" && mv "$JSON_FILE.tmp" "$JSON_FILE"
  fi

  # Reset meta
  jq '.deleted = false | .deleted_detected = null' \
    "$META_FILE" > "$META_FILE.tmp" && mv "$META_FILE.tmp" "$META_FILE"
done

echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run — $CNT_FIXED tickets would be repaired. Run with --apply to fix."
else
  echo "Repaired $CNT_FIXED tickets."
fi
