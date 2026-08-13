#!/usr/bin/env bash
# Vitality check for navigation.org — silent when vital, loud when stale.
# Each :PATH: is `file` or `file::symbol`; both must still exist in the tree.
#
# Modes:
#   (default)    print STALE lines to stdout, always exit 0 — advisory.
#   --stop-hook  Claude Code Stop hook: reads hook JSON on stdin. If hotpaths
#                rotted, exits 2 with the list on stderr so the ENDING session
#                (which just changed the code and has the context) updates
#                navigation.org before it stops. Respects stop_hook_active
#                to never loop.
cd "$(dirname "$0")/../.." || exit 1

stale=$(grep -E '^[[:space:]]*:PATH:' navigation.org | sed -E 's/^[[:space:]]*:PATH:[[:space:]]*//' |
  while IFS= read -r path; do
    file=${path%%::*}
    sym=${path#*::}
    if [ ! -e "$file" ]; then
      echo "STALE navigation.org hotpath: file missing — $path"
    elif [ "$sym" != "$path" ] && ! grep -qF "$sym" "$file"; then
      echo "STALE navigation.org hotpath: symbol gone — $path"
    fi
  done)

if [ "$1" = "--stop-hook" ]; then
  input=$(cat)
  # Already blocked once this stop — let it through rather than loop.
  if printf '%s' "$input" | grep -q '"stop_hook_active":[[:space:]]*true'; then
    exit 0
  fi
  if [ -n "$stale" ]; then
    {
      printf '%s\n' "$stale"
      echo "You changed this code in this session — update the stale :PATH: entries in navigation.org now (and prune or add hotpaths the change warrants), then confirm scripts/verify/nav_verify.sh is silent."
    } >&2
    exit 2
  fi
  exit 0
fi

[ -n "$stale" ] && printf '%s\n' "$stale"
exit 0
