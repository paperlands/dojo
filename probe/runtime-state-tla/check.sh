#!/usr/bin/env bash
# probe-status: concluded
set -euo pipefail
: "${TLA2TOOLS_JAR:?Set TLA2TOOLS_JAR to the path of an installed tla2tools.jar}"
jar=$(realpath "$TLA2TOOLS_JAR")
root=$(cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp -- "$root/SliceScope.tla" "$root/RevealPermit.tla" "$work/"
cd -- "$work"

check() {
    local tag=$1 module=$2 expected=$3 rc=0
    java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers 1 -config "$tag.cfg" \
        -metadir "$tag.states" "$module" >"$tag.log" 2>&1 || rc=$?
    printf '\n%s\n' "=== $tag ==="
    if [[ -z $expected && $rc -eq 0 ]]; then
        grep -E 'No error has been found|distinct states found' "$tag.log"
    elif [[ -n $expected && $rc -ne 0 ]] && grep -Fq "$expected" "$tag.log"; then
        grep -E '^Error:|^State |^/\\ (run|held|H |edge|sample|callers|deadline)' "$tag.log"
    else
        sed -n '1,180p' "$tag.log" >&2
        return 1
    fi
}

slice() {
    local tag=$1 restore=$2
    printf 'SPECIFICATION Spec\nCONSTANTS Nesting = 3 Restore = %s\nINVARIANT ScopedDeadline\n' "$restore" >"$tag.cfg"
    check "$tag" SliceScope "$3"
}
reveal() {
    local tag=$1 policy=$2 property=$3
    printf 'SPECIFICATION Spec\nCONSTANTS Limit = 3 Policy = "%s"\nPROPERTY %s\n' "$policy" "$property" >"$tag.cfg"
    check "$tag" RevealPermit "$4"
}

slice clear-on-exit FALSE 'Invariant ScopedDeadline is violated'
slice restore-caller TRUE ''
reveal live-hold-check liveChecks SameRunSpend 'Action property SameRunSpend is violated'
reveal match-run-only runOnly SameEdgeSpend 'Action property SameEdgeSpend is violated'
reveal invalidate-on-reset invalidate 'SameRunSpend SameEdgeSpend HeldInert' ''
