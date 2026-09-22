#!/usr/bin/env bash
# G1 — one host artifact, and the closure a consumer actually pays for.
# D030, id:host-runtime-closure.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
esbuild="$root/scripts/vendor/node_modules/esbuild/bin/esbuild"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

"$esbuild" "$root/assets/js/host.js" \
    --bundle \
    --format=esm \
    --metafile="$out/meta.json" \
    --outfile="$out/host.js" \
    >/dev/null

node --input-type=module - "$out/meta.json" << 'JS'
import { readFileSync } from "node:fs"
const meta = JSON.parse(readFileSync(process.argv[2], "utf8"))
const inputs = Object.keys(meta.inputs)
const banned = [
    "turtling/export/recorder.js",
    "mediabunny",
    "/editor/",
    "/terminal/",
    "phoenix_live_view",
]
const hit = inputs.filter((p) => banned.some((b) => p.includes(b)))
if (hit.length) {
    console.error("host closure carries a banned input:\n" + hit.join("\n"))
    process.exit(1)
}
const need = ["turtling/turtle.js", "turtling/orbit.js", "utils/threetext.js"]
const missing = need.filter((n) => !inputs.some((p) => p.endsWith(n) || p.includes(n)))
if (missing.length) {
    console.error("host closure is missing the runtime:\n" + missing.join("\n"))
    process.exit(1)
}
console.log("host closure ok,", inputs.length, "inputs")
JS
