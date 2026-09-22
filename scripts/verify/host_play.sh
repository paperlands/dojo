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

    // Beats: one channel, emitted where the playhead consumes the stroke.
    const beats = []
    const hatch3 = createHatch(canvas)
    hatch3.onLine((b) => beats.push(b))
    const run3 = await hatch3.play("fw 20\nwait 0.2\nrt 90\nfw 20\nwait 0.2\nfw 20")
    await run3.finished
    say("beats:" + JSON.stringify(beats.map((b) => [b.time, b.line, b.lines])))
    const scored = beats.length === 3
        && beats[0].time === 0 && beats[0].lines.join() === "1"
        && Math.abs(beats[1].time - 0.2) < 1e-9 && beats[1].lines.join() === "3,4"
        && Math.abs(beats[2].time - 0.4) < 1e-9 && beats[2].lines.join() === "6"
        && beats.every((b, i) => i === 0 || b.time >= beats[i - 1].time)
    const n = beats.length
    hatch3.dispose()
    await new Promise((r) => setTimeout(r, 120))
    say("scored:" + scored + ":quiet:" + (beats.length === n))

    // A def body, a wait joint, and a spawned child on the parent's clock.
    const beats4 = []
    const hatch4 = createHatch(canvas)
    hatch4.onLine((b) => beats4.push(b))
    const prog4 = [
        "def polygon n do",
        "  loop n do",
        "    fw 2*300*sin[180/n]",
        "    rt 360/n",
        "  end",
        "end",
        "polygon 4",
        "wait 0.1",
        "as 'mice[count]' do",
        "  loop 2 do",
        "    fw 20",
        "    wait 1/24",
        "  end",
        "end",
    ].join("\n")
    const run4 = await hatch4.play(prog4)
    await run4.finished
    say("morph:" + JSON.stringify(beats4.map((b) => [b.time, b.birthtime, b.line, b.lines])))
    const morphok = beats4.length === 4
        && beats4.some((b) => [1, 3, 4, 7].every((l) => b.lines.includes(l)))
        && beats4.some((b) => [10, 11].every((l) => b.lines.includes(l)))
        && beats4.some((b) => Math.abs((b.birthtime + b.time) - (0.1 + 1 / 24)) < 1e-9)
        && beats4.some((b) => Math.abs(b.birthtime - 0.1) < 1e-9)
        && beats4.some((b) => b.birthtime === 0)
    hatch4.dispose()
    say("morphok:" + morphok)

    // Generations: a grandchild's birth is the child's `birthtime + time`.
    const beatsN = []
    const hatchN = createHatch(canvas)
    hatchN.onLine((b) => beatsN.push(b))
    const progN = [
        "wait 0.1",
        "as a do",
        "  wait 0.1",
        "  as b do",
        "    loop 2 do",
        "      fw 5",
        "      wait 1/24",
        "    end",
        "  end",
        "end",
    ].join("\n")
    const runN = await hatchN.play(progN)
    await runN.finished
    say("nest:" + JSON.stringify(beatsN.map((b) => [b.time, b.birthtime, b.line, b.lines])))
    const nestok = beatsN.some((b) => Math.abs(b.birthtime - 0.2) < 1e-9)
        && beatsN.some((b) => Math.abs(b.time - 1 / 24) < 1e-9 && Math.abs(b.birthtime - 0.2) < 1e-9)
    hatchN.dispose()
    say("nestok:" + nestok)
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
