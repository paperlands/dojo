#!/usr/bin/env bash
# The BROWSER RUNGS' entry point — the actual canvas, a real browser.
#
# This is NOT yet a CI gate. It is the rung's harness, kept honest about its own
# state: the journey has PASSED 7/7 and has also been observed to fail on
# settling races (see "Known flakiness"). Run it when you have a live shell.
#
# Requirements (all local, no downloads unless noted):
#   - the dev server up:            mix phx.server        (port 4000)
#   - a debuggable chromium:        chromium --headless=new --no-sandbox \
#       --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader \
#       --remote-debugging-port=9222 --remote-allow-origins=* \
#       --user-data-dir=/tmp/dojo-chrome-profile \
#       "http://localhost:4000/shell?perf=1"
#
# Usage:
#   bash scripts/verify/browser_journey.sh [rung] [reviseRadius] [outDir]
#
# READINESS and EXIT STATUS are now firm:
#   - ready means a hatch that happened AFTER the source was submitted, satisfying the
#     stage's own post-condition, and STABLE across consecutive polls. Yesterday's world
#     carries an older hatch, so it cannot be mistaken for the one you asked for.
#   - a collected failure exits 3; `process.exit` no longer overrides `process.exitCode`.
# Stability: three consecutive runs held 7/7 at exit 0, and a deliberately failing
# journey exited 3.
#
# What the stages assert (observable results only):
#   1 a sphere/plane circle renders, with both obligations live;
#   2 the CONTOUR is painted at points AWAY from the marker, and the ink is not a flat
#     fill (a point, a stroke or a UI element cannot satisfy this);
#   3 a REAL pointer captures A; the hand TAKES the camera while it holds;
#   4 every accepted drag configuration stays on the circle, in the plane, and lawful;
#   5 the hand GIVES THE CAMERA BACK on release (`controlsEnabled` true again);
#   6 a source revision moves geometry and painted locus together;
#   7 a refused revision leaves the accepted geometry visible and the refusal legible
set -u

RUNG="${1:-scripts/play/rungs/circle.txt}"
RADIUS="${2:-3}"
OUT="${3:-/tmp}"

curl -sS -o /dev/null -w "" "http://localhost:4000/shell?perf=1" || {
  echo "browser_journey: no shell on :4000 — start the dev server first" >&2
  exit 2
}
curl -sS -o /dev/null "http://localhost:9222/json/version" || {
  echo "browser_journey: no chromium on :9222 — start it with --remote-debugging-port=9222" >&2
  exit 2
}

node scripts/play/play_cdp.mjs journey "$RUNG" "$RADIUS" "$OUT"
