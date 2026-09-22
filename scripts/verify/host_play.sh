#!/usr/bin/env bash
# Runtime door — a canvas, a program, the promises a consumer actually awaits.
# The source fence cannot see these. D030, id:host-runtime-play.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
esbuild="$root/scripts/vendor/node_modules/esbuild/bin/esbuild"
out="$(mktemp -d)"
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
http=""
cleanup() {
    if [[ -n "$http" ]]; then kill "$http" 2>/dev/null || true; fi
    rm -rf "$out"
}
trap cleanup EXIT

"$esbuild" "$root/assets/js/host.js" \
    --bundle --format=esm --outfile="$out/host.js" >/dev/null

cat > "$out/index.html" << 'HTML'
<canvas id="c" width="320" height="240"></canvas>
<pre id="out"></pre>
<script type="module">
const out = document.getElementById("out")
const say = (s) => { out.textContent += s + "\n" }
try {
    const { createHatch } = await import("./host.js")
    const canvas = document.getElementById("c")
    const hatch = createHatch(canvas)
    try {
        await hatch.play("nope")
        say("bad:accepted")
    } catch (e) {
        say("bad:" + e.message + ":" + (e.wound?.span?.line ?? "noline"))
    }
    const run = await hatch.play("fw 20")
    const fin = await run.finished
    say("ok:" + run.commandCount + ":" + fin.commandCount)
    const hatch2 = createHatch(canvas)
    const held = await hatch2.play("wait 30")
    const ended = held.finished.then(() => "ended", (e) => "rej:" + e.message)
    hatch2.dispose()
    say(await ended)
    say("DONE")
} catch (e) {
    say("FAIL " + (e && e.stack || e))
}
</script>
HTML

python3 -m http.server --bind 127.0.0.1 --directory "$out" "$port" >"$out/http.log" 2>&1 &
http=$!
sleep 0.2

node "$root/scripts/verify/host_play.mjs" "$port" "$out"
