#!/usr/bin/env bash
# Vitality check for probe/ — prints the census, loud when stale.
#
# Doctrine: probe/README.org. A probe is an instrument; every instrument carries
# exactly one `probe-status:` header, and that status is its exit:
#   draft | active | concluded | superseded | composted
# `composted` is the drain: spent probes live under probe/composted/, and nothing
# there may be cited by :PATH: (re-anchor, not re-emit — D012).
#
# Instruments carry the pragma in their own comment syntax:
#   .mjs  // probe-status: active        .org  #+PROBE-STATUS: active
#   .exs  # probe-status: active         .html <!-- probe-status: active -->
#   .doj  # probe-status: active
#
# Not instruments: *.jsonl (records — inherit their writer's status) and
# README.org (describes, does not declare).
#
# Modes:
#   (default)    print findings to stdout, always exit 0 — advisory.
#   --strict     exit 2 if any finding; a gate.
cd "$(dirname "$0")/../.." || exit 1

VALID='draft|active|concluded|superseded|composted'
findings=0
note() { printf '%s\n' "$*"; findings=$((findings + 1)); }

# 1. Every instrument declares exactly one valid status.
while IFS= read -r f; do
    header=$(grep -ioE '^[^A-Za-z]*probe-status[[:space:]]*:[[:space:]]*[a-z]+' "$f" | head -1)
    if [ -z "$header" ]; then
        note "NO STATUS   $f — add: probe-status: <$VALID>"
        continue
    fi
    status=$(printf '%s' "$header" | grep -ioE '[a-z]+$')
    if ! printf '%s' "$status" | grep -qE "^($VALID)$"; then
        note "BAD STATUS  $f — '$status' is not <$VALID>"
        continue
    fi
    case "$f" in
        probe/composted/*)
            [ "$status" = composted ] || note "OFF SEAT    $f — '$status' under probe/composted/; only 'composted' belongs here" ;;
        *)
            [ "$status" = composted ] && note "OFF SEAT    $f — 'composted' must live under probe/composted/" ;;
    esac
done < <(find probe -type f ! -name '*.jsonl' ! -name 'README.org' | sort)

# 2. No cited probe path has rotted or points into the compost.
cited=$(grep -rhoE 'probe/[A-Za-z0-9_./-]+\.(mjs|exs|doj|html|org|jsonl)' \
    navigation.org specs 2>/dev/null | sort -u)
while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ ! -e "$p" ]; then
        note "ROTTED      $p — cited but absent (re-anchor the citation)"
    elif printf '%s' "$p" | grep -q '^probe/composted/'; then
        note "CITED-COMPOST $p — compost is never cited by :PATH: (D012)"
    fi
done <<< "$cited"

# 3. Census — the drain should be visible, never empty forever, never full.
census=$(grep -rhoiE '^[^A-Za-z]*probe-status[[:space:]]*:[[:space:]]*[a-z]+' \
    probe --exclude=README.org 2>/dev/null | grep -ioE '[a-z]+$' | sort | uniq -c |
    awk '{printf "%s=%s ", $2, $1}')
printf 'CENSUS      %s\n' "${census:-<none>}"

if [ "$1" = "--strict" ] && [ "$findings" -gt 0 ]; then
    exit 2
fi
exit 0
