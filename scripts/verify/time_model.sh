#!/usr/bin/env bash
# The clock model — headless, no browser. `time` local, `origin` birth,
# axis = origin + time. (id:host-beat)
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/verify/time_model.mjs
