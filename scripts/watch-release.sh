#!/usr/bin/env bash
# watch-release.sh — polls GitHub for failed release runs and triggers Claude Code.
#
# Usage:
#   ./scripts/watch-release.sh          # runs forever, checks every 60s
#   ./scripts/watch-release.sh --once   # single check then exit (good for cron)
#
# Requires: gh (GitHub CLI, authenticated), claude (Claude Code CLI)
# State file: .git/watch-release-last-seen  (tracks last handled run ID)

set -euo pipefail

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "deusludum/dojo")"
WORKFLOW="release.yml"
STATE_FILE=".git/watch-release-last-seen"
POLL_INTERVAL=60
ONCE=false

[[ "${1:-}" == "--once" ]] && ONCE=true

check_once() {
  # Fetch the most recent failed run for the release workflow
  FAILED=$(gh run list \
    --repo "$REPO" \
    --workflow "$WORKFLOW" \
    --status failure \
    --limit 1 \
    --json databaseId,headSha,createdAt,url \
    --jq '.[0] // empty')

  [[ -z "$FAILED" ]] && return 0

  RUN_ID=$(echo "$FAILED" | jq -r .databaseId)
  SHA=$(echo "$FAILED" | jq -r .headSha)
  RUN_URL=$(echo "$FAILED" | jq -r .url)

  # Skip if already handled
  LAST_SEEN=$(cat "$STATE_FILE" 2>/dev/null || echo "")
  [[ "$RUN_ID" == "$LAST_SEEN" ]] && return 0

  echo "[watch-release] New failure detected — run $RUN_ID ($SHA)"
  echo "[watch-release] $RUN_URL"

  # Capture the failed log output
  ERROR_LOG=$(gh run view "$RUN_ID" \
    --repo "$REPO" \
    --log-failed 2>&1 | tail -150)

  # Mark as handled before invoking Claude (prevents double-trigger on slow sessions)
  echo "$RUN_ID" > "$STATE_FILE"

  # Invoke Claude Code with the full context
  claude --print \
    "The GitHub Actions release workflow for this project just failed.

Run: $RUN_URL
Commit: $SHA

Failed log output (last 150 lines):
\`\`\`
$ERROR_LOG
\`\`\`

Read .github/workflows/release.yml and any relevant project files (mix.exs, rel/packaging/), identify the root cause, and fix it."
}

if $ONCE; then
  check_once
else
  echo "[watch-release] Watching $REPO/$WORKFLOW every ${POLL_INTERVAL}s. Ctrl-C to stop."
  while true; do
    check_once
    sleep "$POLL_INTERVAL"
  done
fi
