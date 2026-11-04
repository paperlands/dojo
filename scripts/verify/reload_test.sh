#!/usr/bin/env bash
# Run code-loading stressors alone. They remove beams by design.
set -euo pipefail
cd "$(dirname "$0")/../.."

# A killed prior run can leave the test ebin renamed. Restore it before the
# next VM starts; source and compiled artefacts must agree before observation.
while IFS= read -r -d '' stash; do
  mv "$stash" "${stash%.reloadsim}"
done < <(find _build/test -name '*.beam.reloadsim' -print0)

mix test --only reload_sim --include reload_sim "$@"
mix test --only full_recompile --include full_recompile "$@"
