#!/usr/bin/env bash
# Runs the multi-node LAN tests inside a throwaway network namespace.
#
#   scripts/verify/lan_test.sh                       # all of them
#   scripts/verify/lan_test.sh test/dojo/cluster/lan_test.exs:52
#
# Everything past this wrapper is ordinary ExUnit — Dojo.Test.Lan builds the
# bridge, the namespaces and the nodes from Elixir, so tests can move the
# network around instead of editing shell phases.
#
# `unshare --user --map-root-user` makes us root inside a user namespace and
# nowhere else: no sudo, and the host's real interfaces are untouchable from
# in here.

set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${DOJO_LAN_NS:-}" != "1" ]; then
  # Both envs, once, out here. Compiling inside while three nodes boot is the
  # race this rig exists to study; it should not be self-inflicted.
  run="${DOJO_LAN_RUN:-dl$$}"
  dir="$PWD/tmp/lan/$run"

  # The controller is test code; nodes use a separate, real-network build.
  echo "compiling lan + test before entering the namespace..."
  if [ ! -d _build/lan/lib/phoenix_live_view ]; then
    MIX_ENV=lan mix deps.compile --no-deps-check
  fi
  DOJO_LAN_DIR="$dir" DOJO_LAN_NODE=build MIX_ENV=lan mix compile --no-deps-check >/dev/null
  MIX_ENV=test mix compile --no-deps-check >/dev/null
  exec unshare --user --map-root-user --net --mount \
    env DOJO_LAN_NS=1 DOJO_LAN_RUN="$run" DOJO_LAN_DIR="$dir" bash "$0" "$@"
fi

cleanup() {
  status=$?

  # Names are this run's only. Deleting a namespace kills even a node that
  # failed before it could write its PID file.
  for i in $(seq 1 32); do
    ip netns del "${DOJO_LAN_RUN}-n${i}" 2>/dev/null || true
  done
  ip link del "${DOJO_LAN_RUN}-br" 2>/dev/null || true

  if [ "$status" -eq 0 ]; then
    rm -rf "$DOJO_LAN_DIR"
  else
    echo "LAN failure logs retained in $DOJO_LAN_DIR" >&2
  fi
}
trap cleanup EXIT

mount -t tmpfs none /run && mkdir -p /run/netns

# The bridge gets no IPv4: the test runner must not become a fourth LAN node.
mix test --no-compile --only lan --include lan "$@"
