#!/usr/bin/env bash
# Retracted keep facts must not appear as current law in comments.
# Law: specs/weave/keep.org id:keep-retracted
set -euo pipefail
cd "$(dirname "$0")/../.." || exit 1

# Phrases that were true and are not. A hit is a resurrected conclusion.
pattern='id:kb-2a|id:ka-works-bind|id:ki-mint|rebuild IS the upgrade'

hits=$(
  grep -RInE --include='*.js' --include='*.ex' --include='*.mjs' \
    "$pattern" \
    assets/js/keep assets/js/terminal assets/js/hooks/shell \
    lib/dojo/keep.ex lib/dojo_web/live/shell_live.ex \
    2>/dev/null || true
)

if [ -n "$hits" ]; then
  echo "keep-retracted: comments still assert withdrawn facts:"
  echo "$hits"
  exit 1
fi
echo "keep-retracted: vital"
exit 0
