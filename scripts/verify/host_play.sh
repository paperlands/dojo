#!/usr/bin/env bash
# Runtime door — a canvas, a program, the promises a consumer actually awaits.
# The source fence cannot see these. D030, id:host-runtime-play.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(mktemp -d)"
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
http=""
cleanup() {
    if [[ -n "$http" ]]; then kill "$http" 2>/dev/null || true; fi
    rm -rf "$out"
}
trap cleanup EXIT

node "$root/scripts/release/host.mjs" "$out/package" >/dev/null
(
    cd "$out"
    export npm_config_cache="$out/npm-cache"
    export npm_config_userconfig="$out/npmrc"
    export npm_config_offline=true
    export npm_config_ignore_scripts=true
    npm pack ./package --json --pack-destination . > packed.json
    tarball="$(node --input-type=module -e 'import fs from "node:fs"; console.log(Object.values(JSON.parse(fs.readFileSync("packed.json")))[0].filename)')"
    printf '{"private":true,"type":"module"}\n' > package.json
    npm install "./$tarball" --package-lock=false --no-audit --no-fund >/dev/null
    node --input-type=module -e '
        import fs from "node:fs"
        const {name} = JSON.parse(fs.readFileSync("package/package.json"))
        fs.writeFileSync("consumer.mjs", "export { createWorld, projectPoint, unprojectRay } from " + JSON.stringify(name))
    '
    "$root/scripts/vendor/node_modules/esbuild/bin/esbuild" consumer.mjs \
        --bundle --format=esm --platform=browser --outfile=runtime/host.mjs >/dev/null
)

cat > "$out/index.html" << 'HTML'
<style>#c { display: block; width: 320px; height: 240px; }</style>
<div><canvas id="c" width="320" height="240"></canvas></div>
<pre id="out"></pre>
<script type="module">
const out = document.getElementById("out")
const say = (s) => { out.textContent += s + "\n" }
try {
    const { createWorld, projectPoint, unprojectRay } = await import("./runtime/host.mjs")
    const canvas = document.getElementById("c")
    const world = createWorld(canvas)
    try {
        await world.play("nope")
        say("bad:accepted")
    } catch (e) {
        say("bad:" + e.message + ":badline:" + (e.wound?.span?.line ?? "noline"))
    }
    const run = await world.play("fw 20")
    const fin = await run.finished
    say("ok:" + run.commandCount + ":" + fin.commandCount)
    const world2 = createWorld(canvas)
    const held = await world2.play("wait 30")
    const ended = held.finished.then(() => "ended", (e) => "rej:" + e.message)
    world2.dispose()
    say(await ended)

    // Beats: one channel, emitted where the playhead consumes the stroke.
    const beats = []
    const world3 = createWorld(canvas)
    world3.onBeat((b) => beats.push(b))
    const run3 = await world3.play("fw 20\nwait 0.2\nrt 90\nfw 20\nwait 0.2\nfw 20")
    await run3.finished
    say("beats:" + JSON.stringify(beats.map((b) => [b.time, b.line, b.lines])))
    const scored = beats.length === 3
        && beats[0].time === 0 && beats[0].lines.join() === "1"
        && Math.abs(beats[1].time - 0.2) < 1e-9 && beats[1].lines.join() === "3,4"
        && Math.abs(beats[2].time - 0.4) < 1e-9 && beats[2].lines.join() === "6"
        && beats.every((b, i) => i === 0 || b.time >= beats[i - 1].time)
    const n = beats.length
    world3.dispose()
    await new Promise((r) => setTimeout(r, 120))
    say("scored:" + scored + ":quiet:" + (beats.length === n))

    // A def body, a wait joint, and a spawned child on the parent's clock.
    const beats4 = []
    const world4 = createWorld(canvas)
    world4.onBeat((b) => beats4.push(b))
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
    const run4 = await world4.play(prog4)
    await run4.finished
    say("morph:" + JSON.stringify(beats4.map((b) => [b.time, b.birthtime, b.line, b.lines])))
    const morphok = beats4.length === 4
        && beats4.some((b) => [1, 3, 4, 7].every((l) => b.lines.includes(l)))
        && beats4.some((b) => [10, 11].every((l) => b.lines.includes(l)))
        && beats4.some((b) => Math.abs((b.birthtime + b.time) - (0.1 + 1 / 24)) < 1e-9)
        && beats4.some((b) => Math.abs(b.birthtime - 0.1) < 1e-9)
        && beats4.some((b) => b.birthtime === 0)
    world4.dispose()
    say("morphok:" + morphok)

    // Generations: a grandchild's birth is the child's `birthtime + time`.
    const beatsN = []
    const worldN = createWorld(canvas)
    worldN.onBeat((b) => beatsN.push(b))
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
    const runN = await worldN.play(progN)
    await runN.finished
    say("nest:" + JSON.stringify(beatsN.map((b) => [b.time, b.birthtime, b.line, b.lines])))
    const nestok = beatsN.some((b) => Math.abs(b.birthtime - 0.2) < 1e-9)
        && beatsN.some((b) => Math.abs(b.time - 1 / 24) < 1e-9 && Math.abs(b.birthtime - 0.2) < 1e-9)
    worldN.dispose()
    say("nestok:" + nestok)

    // The law seam: an injected relationship governs real host motion. One valid
    // configuration must be established through the package door and survive
    // `finished`. Lab-only — the responder lives in the page, not in the language.
    const accepted = []
    const pair = ({ command, requested, frame }) => {
        if (frame.name !== "a") return { accepted: true, transform: requested }
        const other = frame.parent.children.get("b")
        if (!other) return { accepted: false }
        const current = frame.transform.deref()
        const delta = requested.position[0] - current.position[0]
        const pose = { ...other.transform.deref(), position: [other.transform.deref().position[0] + delta, 0, 0] }
        accepted.push([requested.position[0], pose.position[0]])
        return { accepted: true, transform: requested, component: [{ frame: other, transform: pose }] }
    }
    const world5 = createWorld(canvas, { law: { motionAdmission: pair } })
    const prog5 = [
        "as b do",
        "  goto 5 0",
        "end",
        "as a do",
        "  goto 1 0",
        "  wait 0.05",
        "  goto 3 0",
        "end",
    ].join("\n")
    const run5 = await world5.play(prog5)
    await run5.finished
    const first = accepted.length
    const run5b = await world5.play(prog5)   // a fresh play re-establishes, never inherits
    await run5b.finished
    const repeated = accepted.length === first * 2
        && accepted.slice(first).every((p, i) => p[0] === accepted[i][0] && p[1] === accepted[i][1])
    world5.dispose()
    let disposedRefused = false
    try { await world5.play(prog5) } catch (e) { disposedRefused = e.message === "world disposed" }
    const lawsok = first === 2
        && accepted.slice(0, first).every(([x, y]) => Math.abs(Math.abs(x - y) - 5) < 1e-9)
        && accepted[first - 1][0] === 3 && accepted[first - 1][1] === 8
        && repeated && disposedRefused
    say("laws:" + JSON.stringify(accepted))
    // Disposal is stronger than dropping the world handle: a nested, delayed
    // verdict cannot wake its old frame after the canvas is gone.
    let answer6, parked6
    const world6 = createWorld(canvas, { law: { motionAdmissionAsync: ({ frame, requested }) => {
        if (frame.name !== "a") return { accepted: true, transform: requested }
        parked6 = frame
        return new Promise(resolve => { answer6 = resolve })
    } } })
    const run6 = await world6.play("as b do\nend\nas a do\n  fw 1\nend")
    const ended6 = run6.finished.catch(e => e.message)
    const parked = parked6?.suspension?.kind === "admission"
    world6.dispose()
    answer6?.({ accepted: true, transform: { ...parked6.transform.deref(), position: [50, 0, 0] } })
    await Promise.resolve()
    say("pendingdispose:" + (parked && parked6.done && parked6.channel.closed
        && parked6.transform.deref().position[0] === 0 && await ended6 === "world disposed"))
    say("lawsok:" + lawsok)

    // The host seam reads authored properties and proposes through native admission.
    const world7 = createWorld(canvas)
    const run7 = await world7.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run7.finished
    const initial7 = world7.interaction.read(['host', "A"], "x")
    const coincident7 = world7.interaction.read(['host', "A"], "bearing")
    const defaultDown7 = new PointerEvent("pointerdown", { clientX: 160, clientY: 120, pointerId: 70, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    canvas.dispatchEvent(defaultDown7)
    const defaultInteractionOff7 = !defaultDown7.defaultPrevented
    const missing7 = world7.interaction.read(['host', "NotDeclared"], "x")
    const samples7 = []
    const mutatedSamples7 = []
    const stop7 = world7.interaction.subscribe(['host', "A"], "x", answer => samples7.push(answer.value))
    const stopMutate7 = world7.interaction.subscribe(['host', "A"], "x", answer => {
        mutatedSamples7.push(answer.value)
        if (mutatedSamples7.length === 1) {
            try { answer.value = 7 } catch { /* frozen public answer */ }
        }
    })
    const stopThrow7 = world7.interaction.subscribe(['host', "A"], "x", () => { throw new Error("observer") })
    const movedToSeven7 = world7.interaction.propose(['host', "A"], [7, 0, 0])
    const moved7 = world7.interaction.propose(['host', "A"], [12, 0, 0])
    const refused7 = world7.interaction.propose(['host', "A"], [12, Number.POSITIVE_INFINITY, 0])
    const final7 = world7.interaction.read(['host', "A"], "x")
    say("interaction:" + JSON.stringify({ initial7, missing7, moved: moved7.kind, refused: refused7.kind, final7, samples7 }))
    const interactionOk = initial7.kind === "value" && initial7.value === 0
        && coincident7.kind === "value" && coincident7.value === null
        && defaultInteractionOff7 && missing7.kind === "missing"
        && movedToSeven7.kind === "accept" && moved7.kind === "accept" && refused7.kind !== "accept"
        && final7.kind === "value" && final7.value === 12
        && samples7.join() === "0,7,12" && mutatedSamples7.join() === "0,7,12"
    stop7()
    stopMutate7()
    stopThrow7()
    const obsoleteSamples7 = []
    const stopObsolete7 = world7.interaction.subscribe(['host', "A"], "x", answer => obsoleteSamples7.push(answer.value))
    const replay7 = await world7.play("let A\nlet A.y = 0\nlet A.z = 0")
    await replay7.finished
    world7.interaction.propose(['host', "A"], [20, 0, 0])
    const replayRetired7 = obsoleteSamples7.length === 1 && obsoleteSamples7[0] === 12
    stopObsolete7()
    world7.dispose()
    const retired7 = world7.interaction.read(['host', "A"], "x").kind === "retired"
    const world8 = createWorld(canvas, { interactive: true })
    const run8 = await world8.play("let A\nlet A.z = 0\nlet A.distance = 50")
    await run8.finished
    const bearing8 = world8.interaction.read(['host', "A"], "bearing")
    const rotatorEvents8 = []
    const stopBearing8 = world8.interaction.subscribe(['host', "A"], "bearing", answer => rotatorEvents8.push(answer.value))
    const rotated8 = world8.interaction.propose(['host', "A"], [0, 0, 0])
    const bearingAfter8 = world8.interaction.read(['host', "A"], "bearing")
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const rect8 = canvas.getBoundingClientRect()
    let rotatorPointerClaimed8 = false
    for (let y = 4; y < rect8.height && !rotatorPointerClaimed8; y += 8) {
        for (let x = 4; x < rect8.width && !rotatorPointerClaimed8; x += 8) {
            const pointerId = 90 + y * rect8.width + x
            const down = new PointerEvent("pointerdown", { clientX: rect8.left + x, clientY: rect8.top + y,
                pointerId, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
            canvas.dispatchEvent(down)
            if (!down.defaultPrevented) continue
            rotatorPointerClaimed8 = true
            window.dispatchEvent(new PointerEvent("pointermove", { clientX: rect8.left + x + 24,
                clientY: rect8.top + y, pointerId, pointerType: "mouse", buttons: 1, bubbles: true, cancelable: true }))
            window.dispatchEvent(new PointerEvent("pointerup", { clientX: rect8.left + x + 24,
                clientY: rect8.top + y, pointerId, pointerType: "mouse", button: 0, buttons: 0, bubbles: true, cancelable: true }))
        }
    }
    const pointerBearing8 = world8.interaction.read(['host', "A"], "bearing")
    const distanceAfter8 = world8.interaction.read(['host', "A"], "distance")
    const zAfter8 = world8.interaction.read(['host', "A"], "z")
    const rotatorOk = bearing8.kind === "value" && rotated8.kind === "accept"
        && bearingAfter8.kind === "value" && bearingAfter8.value !== bearing8.value
        && rotatorPointerClaimed8 && pointerBearing8.kind === "value" && pointerBearing8.value !== bearingAfter8.value
        && distanceAfter8.kind === "value" && Math.abs(distanceAfter8.value - 50) < 1e-9
        && zAfter8.kind === "value" && zAfter8.value === 0
        && rotatorEvents8.length === 3 && rotatorEvents8[0] === bearing8.value
        && rotatorEvents8[1] === bearingAfter8.value && rotatorEvents8[2] === pointerBearing8.value
    const lifecycleOk = retired7 && replayRetired7
    const world10 = createWorld(canvas)
    const source10 = ["goto 10 20", "rt 90", "let A", "let A.z = 0",
        "let A.distance = 50", "let b = A.bearing"].join("\n")
    const run10 = await world10.play(source10)
    await run10.finished
    const directBearing10 = world10.interaction.read(['host', "A"], "bearing")
    const scalarBearing10 = world10.interaction.read("b")
    const observerOk10 = directBearing10.kind === "value"
        && Object.is(directBearing10.value, scalarBearing10.value)
    world10.dispose()
    const world11 = createWorld(canvas)
    const run11 = await world11.play("let A\nlet A.y = 0\nlet A.z = 0\nlet s = A.x")
    await run11.finished
    const scalarSamples11 = []
    const stop11 = world11.interaction.subscribe("s", answer => scalarSamples11.push(answer.value))
    const scalarMoved11 = world11.interaction.propose(['host', "A"], [7, 0, 0])
    const scalarOk11 = scalarSamples11[0] === 0 && scalarSamples11.at(-1) === 7
        && scalarMoved11.kind === "accept"
    stop11()
    let finishPaint11
    const paintGate11 = new Promise(resolve => { finishPaint11 = resolve })
    window.proposalWitnessReady = true
    window.runProposalWitness = async () => {
        const verdict = world11.interaction.propose(['host', "A"], [17, 0, 0])
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return verdict.kind === "accept" && world11.interaction.read(['host', "A"], "x").value === 17
    }
    window.finishProposalWitness = rendered => finishPaint11(rendered)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    say("PAINT_READY")
    const proposalRendered11 = await paintGate11
    world11.dispose()
    say("proposalRendered:" + proposalRendered11)
    const world12 = createWorld(canvas, { law: { motionAdmission: ({ requested }) => ({ accepted: true, transform: requested }) } })
    const run12 = await world12.play("let A\nlet A.z = 0\nlet A.distance = 50")
    await run12.finished
    const refusalEvents12 = []
    const stop12 = world12.interaction.subscribe(['host', "A"], "bearing", answer => refusalEvents12.push(answer.value))
    const beforeRefusal12 = world12.interaction.read(['host', "A"], "bearing")
    const finiteRefusal12 = world12.interaction.propose(['host', "A"], [0, 0, 0])
    const refusalState12 = world12.interaction.read(['host', "A"], "bearing")
    const refusalOk12 = finiteRefusal12.kind === "refuse"
        && Object.is(refusalState12.value, beforeRefusal12.value)
        && refusalEvents12.length === 1
        && refusalEvents12.length === 1 && refusalEvents12[0] === 0
    stop12()
    world12.dispose()
    const world17 = createWorld(canvas)
    const run17 = await world17.play("as A do\n  rt 90\nend")
    await run17.finished
    const headingBefore17 = world17.interaction.read(['host', "A"], "heading")
    const headedProposal17 = world17.interaction.propose(['host', "A"], [1, 0, 0])
    const headingAfter17 = world17.interaction.read(['host', "A"], "heading")
    const headedRejected17 = headedProposal17.kind === "unsupported"
        && headingBefore17.kind === "value" && headingAfter17.kind === "value"
        && headingBefore17.value === headingAfter17.value
    world17.dispose()
    const world13 = createWorld(canvas)
    const run13 = await world13.play("let A\nlet A.y = 0\nlet A.z = 0\nlet B\nlet B.y = 0\nlet B.z = 0")
    await run13.finished
    const positions13 = []
    const stop13 = world13.interaction.subscribe(['host', "A"], "position", answer => {
        positions13.push([...answer.value])
        if (positions13.length === 1) {
            try { answer.value[0] = 42 } catch { /* frozen public vector */ }
        }
    })
    const movedB13 = world13.interaction.propose(['host', "B"], [5, 0, 0])
    const unchangedA13 = world13.interaction.read(['host', "A"], "position")
    const positionOk13 = movedB13.kind === "accept" && positions13.length === 1
        && Object.isFrozen(unchangedA13.value) && unchangedA13.value[0] === 0
    stop13()
    world13.dispose()
    const world14 = createWorld(canvas)
    const run14 = await world14.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run14.finished
    const siblingValues14 = [], lateValues14 = []
    let lateStop14 = () => {}, siblingStop14 = () => {}, lateCreated14 = false
    const spawnerStop14 = world14.interaction.subscribe(['host', "A"], "x", answer => {
        if (answer.value !== 0 && !lateCreated14) {
            lateCreated14 = true
            lateStop14 = world14.interaction.subscribe(['host', "A"], "x", value => lateValues14.push(value.value))
            siblingStop14()
        }
    })
    siblingStop14 = world14.interaction.subscribe(['host', "A"], "x", answer => siblingValues14.push(answer.value))
    world14.interaction.propose(['host', "A"], [7, 0, 0])
    const snapshotWatchers14 = lateValues14.join() === "7" && siblingValues14.join() === "0"
    world14.interaction.propose(['host', "A"], [8, 0, 0])
    const watchersOk14 = snapshotWatchers14 && lateValues14.join() === "7,8" && siblingValues14.join() === "0"
    spawnerStop14()
    lateStop14()
    world14.dispose()
    const world15 = createWorld(canvas)
    const run15 = await world15.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run15.finished
    const disposedSibling15 = []
    const disposeFirst15 = world15.interaction.subscribe(['host', "A"], "x", answer => {
        if (answer.value === 7) world15.dispose()
    })
    world15.interaction.subscribe(['host', "A"], "x", answer => disposedSibling15.push(answer.value))
    const disposedDuringDelivery15 = world15.interaction.propose(['host', "A"], [7, 0, 0]).kind === "accept"
        && disposedSibling15.join() === "0"
        && world15.interaction.read(['host', "A"], "x").kind === "retired"
    disposeFirst15()
    say("positionEquality:" + positionOk13)
    say("watchers:" + watchersOk14 + ":disposeDelivery:" + disposedDuringDelivery15)
    say("finiteRefusal:" + refusalOk12 + ":headed:" + headedRejected17)
    say("rotator:" + JSON.stringify({ bearing8, rotated8: rotated8.kind, bearingAfter8, distanceAfter8, zAfter8, rotatorEvents8 }))
    stopBearing8()
    say("observer:" + JSON.stringify({ directBearing10, scalarBearing10 }))
    world8.dispose()
    const world9 = createWorld(canvas, { interactive: true })
    const run9 = await world9.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run9.finished
    await new Promise(resolve => setTimeout(resolve, 100))
    const rect9 = canvas.getBoundingClientRect()
    const center9 = { x: rect9.left + rect9.width / 2, y: rect9.top + rect9.height / 2 }
    const down9 = new PointerEvent("pointerdown", { clientX: center9.x, clientY: center9.y, pointerId: 71, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    canvas.dispatchEvent(down9)
    const move9 = new PointerEvent("pointermove", { clientX: center9.x + 30, clientY: center9.y, pointerId: 71, pointerType: "mouse", buttons: 1, bubbles: true, cancelable: true })
    window.dispatchEvent(move9)
    window.dispatchEvent(new PointerEvent("pointerup", { ...center9, pointerId: 71, pointerType: "mouse", button: 0, buttons: 0, bubbles: true, cancelable: true }))
    const pointer9 = world9.interaction.read(['host', "A"], "x")
    const claimed9 = down9.defaultPrevented
    const movedByPointer9 = pointer9.kind === "value" && pointer9.value !== 0
    const outside9 = new PointerEvent("pointerdown", { clientX: 5, clientY: 5, pointerId: 72, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    document.body.dispatchEvent(outside9)
    const outsideNotCaptured9 = !outside9.defaultPrevented
    world9.dispose()
    const world16 = createWorld(canvas, { interactive: true })
    const source16 = "let A\nlet A.y = 0\nlet A.z = 0"
    const run16 = await world16.play(source16)
    await run16.finished
    await new Promise(resolve => setTimeout(resolve, 80))
    const rect16 = canvas.getBoundingClientRect()
    const down16 = new PointerEvent("pointerdown", { clientX: rect16.left + rect16.width / 2, clientY: rect16.top + rect16.height / 2, pointerId: 81, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    canvas.dispatchEvent(down16)
    const replacement16 = await world16.play(source16)
    await replacement16.finished
    await new Promise(resolve => setTimeout(resolve, 80))
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: rect16.left + rect16.width / 2 + 30, clientY: rect16.top + rect16.height / 2, pointerId: 81, pointerType: "mouse", buttons: 1, bubbles: true, cancelable: true }))
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: rect16.left + rect16.width / 2 + 30, clientY: rect16.top + rect16.height / 2, pointerId: 81, pointerType: "mouse", button: 0, buttons: 0, bubbles: true, cancelable: true }))
    const afterHeldReplacement16 = world16.interaction.read(['host', "A"], "x")
    const replacedHeldOk16 = down16.defaultPrevented && afterHeldReplacement16.kind === "value"
        && afterHeldReplacement16.value === 0
    world16.dispose()
    say("pointer:" + JSON.stringify({ claimed9, pointer9, movedByPointer9, outsideNotCaptured9, down16: down16.defaultPrevented, afterHeldReplacement16, replacedHeldOk16 }))
    say("interactionok:" + interactionOk + ":lifecycle:" + lifecycleOk + ":position:" + positionOk13 + ":watchers:" + watchersOk14 + ":dispose-delivery:" + disposedDuringDelivery15 + ":finite-refusal:" + refusalOk12 + ":headed:" + headedRejected17 + ":rotator:" + rotatorOk + ":observer:" + observerOk10 + ":scalar:" + scalarOk11 + ":pointer:" + (claimed9 && movedByPointer9 && outsideNotCaptured9 && replacedHeldOk16))
    const world18 = createWorld(canvas)
    const run18 = await world18.play("let s = 1\nlet t = s\nwait 0.1\nlet s = 2\nlet A")
    const sourceSamples18 = [], birthSamples18 = []
    world18.interaction.subscribe("s", answer => sourceSamples18.push([answer.value, world18.interaction.read("t").value]))
    world18.interaction.subscribe(['host', "A"], "x", answer => birthSamples18.push(answer.kind === "value" ? answer.value : answer.kind))
    await run18.finished
    const sourceOk18 = JSON.stringify(sourceSamples18) === "[[1,1],[2,2]]"
        && JSON.stringify(birthSamples18) === '["missing",0]'
    const vectorRun18 = await world18.play("let A\nlet v = [A.x, A.y, A.z, 4]")
    await vectorRun18.finished
    const vectorSamples18 = []
    world18.interaction.subscribe("v", answer => vectorSamples18.push(answer.value))
    const vectorMoved18 = world18.interaction.propose(['host', "A"], [7, 0, 0])
    const vectorsOk18 = vectorMoved18.kind === "accept"
        && JSON.stringify(vectorSamples18) === "[[0,0,0,4],[7,0,0,4]]"
        && vectorSamples18.every(Object.isFrozen)
    world18.dispose()
    say("sourceValues:" + sourceOk18 + ":vectors:" + vectorsOk18)
    // Two page-owned surfaces; each overlay and bitmap follows only its canvas.
    const surfacePlate = document.createElement("div")
    surfacePlate.style.cssText = "position:absolute;left:400px;top:20px"
    const surfaceA = document.createElement("canvas"), surfaceB = document.createElement("canvas")
    surfaceA.style.cssText = "display:block;width:213px;height:117px;border:1px solid white"
    surfaceB.style.cssText = "display:block;width:140px;height:90px"
    surfacePlate.append(surfaceA, surfaceB)
    document.body.append(surfacePlate)
    const surfaceWorldA = createWorld(surfaceA), surfaceWorldB = createWorld(surfaceB)
    await (await surfaceWorldA.play("fw 5")).finished
    await (await surfaceWorldB.play("fw 5")).finished
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const surfaceParts = {
        buffers: surfaceA.width === Math.floor(213 * dpr) && surfaceB.width === Math.floor(140 * dpr),
        layout: surfaceA.style.width === "213px" && surfaceB.style.width === "140px",
        layers: surfacePlate.querySelectorAll(":scope > canvas").length === 4,
    }
    surfaceA.style.width = "0px"
    surfaceA.style.height = "0px"
    await new Promise(resolve => setTimeout(resolve, 150))
    const overlayA = surfacePlate.querySelector("canvas[aria-hidden=true]")
    surfaceParts.collapsed = surfaceA.clientWidth === 0 && overlayA?.getBoundingClientRect().width === 0
    surfaceWorldA.dispose()
    surfaceParts.isolated = surfacePlate.querySelectorAll(":scope > canvas").length === 3
    await (await surfaceWorldB.play("fw 8")).finished
    surfaceWorldB.dispose()
    surfaceParts.disposed = surfacePlate.querySelectorAll(":scope > canvas").length === 2
    surfacePlate.remove()

    // No CSS size: DPR must not amplify the intrinsic box on each resize.
    const barePlate = document.createElement("div")
    const bareCanvas = document.createElement("canvas")
    barePlate.append(bareCanvas)
    document.body.append(barePlate)
    const bareWidth = bareCanvas.getBoundingClientRect().width
    const bareWorld = createWorld(bareCanvas)
    await (await bareWorld.play("fw 5")).finished
    await new Promise(resolve => setTimeout(resolve, 150))
    surfaceParts.unsized = bareCanvas.getBoundingClientRect().width === bareWidth
        && bareCanvas.width === Math.floor(bareWidth * dpr)
    bareWorld.dispose()
    barePlate.remove()
    say("surface:" + JSON.stringify(surfaceParts))
    say("surfaceok:" + Object.values(surfaceParts).every(Boolean))

    const delayedWorld = createWorld(canvas)
    const delayedRun = await delayedWorld.play("wait 0.05\nlet s = 7")
    const delayedSamples = []
    delayedWorld.interaction.subscribe("s", answer => delayedSamples.push(answer.kind === "value" ? answer.value : answer.kind))
    await delayedRun.finished
    delayedWorld.dispose()
    const walkingWorld = createWorld(canvas)
    const walkingRun = await walkingWorld.play("as A do\nwait 0.05\njmp 10\nend")
    const walkingSamples = []
    walkingWorld.interaction.subscribe(['host', "A"], "position", answer => walkingSamples.push(answer.value?.[0]))
    await walkingRun.finished
    walkingWorld.dispose()
    say("walkingReads:" + (JSON.stringify(delayedSamples) === '["missing",7]'
        && JSON.stringify(walkingSamples) === '[0,10]'))
    const lateWorld = createWorld(canvas)
    const lateRun = await lateWorld.play("fw 1\nwait 0.05\nnope")
    let lateFatal = false
    try { await lateRun.finished } catch (error) {
        lateFatal = error.reason === "fatal" && error.wound?.span?.line === 3
    }
    lateWorld.dispose()
    const capWorld = createWorld(canvas, { caps: { maxCommands: 4 } })
    const capRun = await capWorld.play("fw 1\nwait 0.05\nlimitCommand 100\nfw 1\nfw 1\nfw 1")
    let capFatal = false
    try { await capRun.finished } catch (error) { capFatal = error.reason === "fatal" }
    capWorld.dispose()
    say("hostTruth:" + (lateFatal && capFatal))

    // The effective view: frozen plain data, pure projection, one frame fan.
    // A view is the frame that was actually drawn; a stored one cannot move.
    const viewWorld = createWorld(canvas)
    const unpainted = viewWorld.view.snapshot()
    const beforePaint = unpainted.frame === null && unpainted.time === null
    await (await viewWorld.play("fw 5")).finished
    const raf = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await raf()
    const stored = viewWorld.view.snapshot()
    const centre = viewWorld.view.project([0, 0, 0])
    const ray = centre ? viewWorld.view.unproject(centre.x, centre.y) : null
    const seen = []
    const envelopes = []
    const stopEnvelope = viewWorld.onFrame(frame => envelopes.push(
        Object.isFrozen(frame) && Reflect.set(frame, 'view', null) === false))
    const stopFrame = viewWorld.onFrame(({ view }) => seen.push(view))
    const beforeFrames = stored?.frame ?? null
    await raf()
    stopFrame()
    stopEnvelope()
    const frozen = !!stored && Object.isFrozen(stored) && Object.isFrozen(stored.worldToView)
    const shaped = !!stored && stored.kind === "view" && stored.status === "ready"
        && stored.width > 0 && stored.height > 0 && stored.worldToView?.length === 16
    const centred = !!centre && Math.abs(centre.x - stored.width / 2) < 1
        && Math.abs(centre.y - stored.height / 2) < 1
    const rayOk = !!ray && Math.abs(ray.direction[2] + 1) < 0.05
        && Math.abs(ray.origin[0]) < 0.01 && Math.abs(ray.origin[2] - 500) < 1
    const fanOk = seen.length >= 1 && seen.every((v) => v.kind === "view" && v.frame !== null)
        && envelopes.length === seen.length && envelopes.every(Boolean)
    viewWorld.dispose()
    // A real camera orbit moves the projection; the stored view does not follow it.
    // Synthetic pointers have no capture; stock OrbitControls would throw before
    // it ever reads the drag. The verifier owns this stub, not the runtime.
    const restoreCapture = () => {
        canvas.setPointerCapture = () => {}
        canvas.releasePointerCapture = () => {}
    }
    restoreCapture()
    const orbitWorld = createWorld(canvas)
    await (await orbitWorld.play("let A\nlet A.y = 0\nlet A.z = 0")).finished
    await raf()
    const kept = orbitWorld.view.snapshot()
    const frameBefore = orbitWorld.view.snapshot().frame
    const beforeOrbit = orbitWorld.view.project([100, 0, 0])
    const rectV = canvas.getBoundingClientRect()
    const cx = rectV.left + rectV.width / 2, cy = rectV.top + rectV.height / 2
    const downV = new PointerEvent("pointerdown", { clientX: cx, clientY: cy, pointerId: 401, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    canvas.dispatchEvent(downV)
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: cx + 90, clientY: cy + 30, pointerId: 401, pointerType: "mouse", buttons: 1, bubbles: true, cancelable: true }))
    document.dispatchEvent(new PointerEvent("pointerup", { clientX: cx + 90, clientY: cy + 30, pointerId: 401, pointerType: "mouse", button: 0, buttons: 0, bubbles: true, cancelable: true }))
    orbitWorld.requestFrame()
    await raf()
    const afterOrbit = orbitWorld.view.project([100, 0, 0])
    const orbitMoved = JSON.stringify(beforeOrbit) !== JSON.stringify(afterOrbit)
    const orbitDiagnostics = { before: beforeOrbit, after: afterOrbit,
        frameBefore, frameAfter: orbitWorld.view.snapshot().frame }
    const keptStill = JSON.stringify(projectPoint(kept, [100, 0, 0])) === JSON.stringify(beforeOrbit)
    // Last rendered metadata survives a play replacement; stored data survives disposal.
    const replayView = await orbitWorld.play("fw 1")
    await replayView.finished
    await raf()
    const afterReplay = orbitWorld.view.snapshot()
    const metadataKept = !!afterReplay && afterReplay.kind === "view" && afterReplay.frame !== null
    orbitWorld.dispose()
    const disposedNull = orbitWorld.view.snapshot() === null && orbitWorld.view.project([0, 0, 0]) === null
    const restored = structuredClone(kept)
    const dataSurvives = JSON.stringify(projectPoint(restored, [100, 0, 0])) === JSON.stringify(beforeOrbit)
        && !!unprojectRay(restored, restored.width / 2, restored.height / 2)
    const localCanvas = document.createElement('canvas')
    localCanvas.style.cssText = 'display:block;width:160px;height:120px'
    document.body.append(localCanvas)
    const flowWorld = createWorld(localCanvas)
    await raf()
    const boxOf = localCanvas.getBoundingClientRect.bind(localCanvas)
    let layoutReads = 0, pulses = 0
    localCanvas.getBoundingClientRect = () => { layoutReads++; return boxOf() }
    const stopPulses = flowWorld.onFrame(() => {
        pulses++
        if (pulses < 3) flowWorld.requestFrame()
    })
    await raf(); await raf()
    stopPulses()
    const lazyLayout = layoutReads === 0 && pulses === 3
    localCanvas.style.width = '180px'
    await raf(); flowWorld.requestFrame(); await raf()
    const resizedView = flowWorld.view.snapshot()
    const sizedView = resizedView.width === 180 && localCanvas.width === 180 * resizedView.dpr
    localCanvas.style.display = 'none'
    await raf(); flowWorld.requestFrame(); await raf()
    const collapsedView = flowWorld.view.snapshot().status === 'collapsed'
        && flowWorld.view.project([0, 0, 0]) === null
    localCanvas.remove()
    flowWorld.requestFrame(); await raf()
    const detachedView = flowWorld.view.snapshot().status === 'unavailable'
    flowWorld.dispose()
    const dyingWorld = createWorld(canvas)
    let dyingView = null, disposedSibling = 0
    dyingWorld.onFrame(({ view }) => { dyingView = view; dyingWorld.dispose() })
    dyingWorld.onFrame(() => { disposedSibling++ })
    await raf()
    const disposalFan = !!dyingView && disposedSibling === 0 && dyingWorld.view.snapshot() === null
    say('viewLifecycle:' + JSON.stringify({beforePaint, lazyLayout, pulses, sizedView, collapsedView, detachedView, disposalFan}))
    say("view:" + JSON.stringify({ beforeFrames, frames: seen.length, centre, rayOk, orbitMoved, orbitDiagnostics }))
    say("viewok:" + (frozen && shaped && centred && rayOk && fanOk && orbitMoved && keptStill
        && metadataKept && disposedNull && dataSurvives && !!kept && beforePaint && lazyLayout
        && sizedView && collapsedView && detachedView && disposalFan))
    // Read the untouched main program through exact key paths, not a wrapper.
    // (id:host-frame-paths)
    const stateCanvas = document.createElement('canvas')
    stateCanvas.style.cssText = 'width:160px;height:120px'
    document.body.append(stateCanvas)
    const stateWorld = createWorld(stateCanvas)
    const stateRun = await stateWorld.play('fw 1\nwait 0.05\nrt 90\nwait 0.05\nrt 90')
    const rootPath = ['host'], rootHeadings = []
    const offRoot = stateWorld.interaction.subscribe(rootPath, 'heading', answer => rootHeadings.push(answer.value))
    rootPath.push('not-the-root')
    const stateFinished = await stateRun.finished
    const rootPathOk = JSON.stringify(rootHeadings) === '[90,180,270]' && stateFinished.commandCount === 5
    await (await stateWorld.play('as "A/B" do\nrt 30\nend\nas A do\nas B do\nrt 60\nend\nend')).finished
    const literalHeading = stateWorld.interaction.read(['host', 'A/B'], 'heading').value
    const nestedHeading = stateWorld.interaction.read(['host', 'A', 'B'], 'heading').value
    const datum = stateWorld.interaction.read([], 'position')
    let rejectedString = false, authoredLine = null
    try { stateWorld.interaction.read('host', 'heading') } catch (error) { rejectedString = error instanceof TypeError }
    try { await stateWorld.play('fw 1\njmp 1 2 3 4') } catch (error) { authoredLine = error.wound?.span?.line }
    await (await stateWorld.play('pitch 90')).finished
    const vertical = stateWorld.interaction.read(['host'], 'heading')
    offRoot(); offRoot()
    stateWorld.dispose(); stateWorld.dispose()
    const framePathsOk = rootPathOk && rootHeadings.length === 3
        && Math.abs(literalHeading - 120) < 1e-9 && Math.abs(nestedHeading - 150) < 1e-9
        && JSON.stringify(datum.value) === '[0,0,0]' && Object.isFrozen(datum.value)
        && rejectedString && authoredLine === 2 && vertical.kind === 'value' && vertical.value === null
        && stateWorld.interaction.read(['host'], 'heading').kind === 'retired'
    stateCanvas.remove()
    say('framePaths:' + JSON.stringify({rootHeadings, literalHeading, nestedHeading, authoredLine, vertical}))
    say('framePathsok:' + framePathsOk)

    // Pause is a right of one accepted run, not a patch to the browser. (id:host-run-pause)
    const pauseWorlds = [0, 1].map(() => {
        const surface = document.createElement('canvas')
        surface.style.cssText = 'display:block;width:240px;height:180px'
        document.body.append(surface)
        return { surface, world: createWorld(surface) }
    })
    const [heldWorld, otherWorld] = pauseWorlds.map(({ world }) => world)
    const nextHeldView = () => new Promise(resolve => {
        const off = heldWorld.onFrame(({ view }) => { off(); resolve(view) })
    })
    const now = performance.now, pageRAF = requestAnimationFrame, realStart = now.call(performance)
    const heldBeats = []
    heldWorld.onBeat(beat => heldBeats.push(beat))
    const paused = await heldWorld.play('let A = (35, 20)\nfw 10\nwait 0.3\nrt 90\nfw 10')
    const originalBeatCount = heldBeats.length
    const pausedOnce = paused.pause() && !paused.pause()
    let pauseCompleted = false
    const resumed = paused.finished.then(() => { pauseCompleted = true })
    const beforeFit = await nextHeldView()
    const fitted = heldWorld.view.fit()
    const afterFit = await nextHeldView()
    await (await otherWorld.play('wait 0.4\nfw 5')).finished
    const stayedHeld = !pauseCompleted && heldBeats.length === originalBeatCount
        && heldWorld.interaction.read(['host'], 'x').value === 10
        && otherWorld.interaction.read(['host'], 'x').value === 5
        && performance.now === now && requestAnimationFrame === pageRAF && now.call(performance) > realStart
    const resumedOnce = paused.resume() && !paused.resume()
    await resumed
    const endedNoop = !paused.pause() && !paused.resume()
    const old = await heldWorld.play('wait 30')
    const oldEnd = old.finished.catch(error => error.reason)
    const oldHeld = old.pause()
    const newer = await heldWorld.play('wait 0.05\nfw 2')
    const oldRevoked = !old.resume() && !old.pause() && await oldEnd === 'superseded'
    await newer.finished
    const doomed = await heldWorld.play('wait 30')
    const doomedEnd = doomed.finished.catch(error => error.reason)
    const doomedHeld = doomed.pause()
    heldWorld.dispose()
    const disposedHeld = !doomed.resume() && await doomedEnd === 'disposed'
    for (const { world, surface } of pauseWorlds) { world.dispose(); surface.remove() }
    const cameraLive = fitted && afterFit.frame > beforeFit.frame
        && JSON.stringify(afterFit.worldToView) !== JSON.stringify(beforeFit.worldToView)
    say('pause:' + JSON.stringify({ pausedOnce, stayedHeld, resumedOnce, endedNoop,
        oldHeld, oldRevoked, doomedHeld, disposedHeld, cameraLive }))
    say('pauseok:' + (pausedOnce && stayedHeld && resumedOnce && endedNoop
        && oldHeld && oldRevoked && doomedHeld && disposedHeld && cameraLive))
    say("DONE")
} catch (e) {
    say("FAIL " + (e && e.stack || e))
}
</script>
HTML

# The same packed runtime, with independent canvases inside a scrolling page.
# Trusted wheel input is driven by host_play.mjs. (id:host-input-wheel)
cat > "$out/wheel.html" << 'HTML'
<style>
body { margin: 0; height: 3000px; scroll-behavior: auto; }
canvas { position: fixed; top: 40px; width: 200px; height: 160px; }
#default { left: 8px; } #modifier { left: 224px; } #none { left: 440px; }
</style>
<canvas id="default"></canvas><canvas id="modifier"></canvas><canvas id="none"></canvas>
<script type="module">
import { createWorld } from './runtime/host.mjs'
try {
    const worlds = Object.fromEntries(['default', 'modifier', 'none'].map(name => [name,
        createWorld(document.getElementById(name), name === 'default' ? {} : { input: { wheel: name } })]))
    window.wheelWorlds = worlds
    const events = []
    window.addEventListener('wheel', event => events.push({
        trusted: event.isTrusted, target: event.target.id,
        ctrl: event.ctrlKey, meta: event.metaKey, deltaY: event.deltaY,
        cancelable: event.cancelable, prevented: event.defaultPrevented,
    }), { passive: true })
    for (const world of Object.values(worlds)) await (await world.play('fw 30')).finished
    await Promise.all(Object.values(worlds).map(world => new Promise(resolve => {
        const off = world.onFrame(() => { off(); resolve() })
    })))
    window.wheelState = () => ({
        y: scrollY, dpr: devicePixelRatio, scale: visualViewport?.scale ?? 1, events,
        views: Object.fromEntries(Object.entries(worlds).map(([name, world]) => {
            const view = world.view.snapshot()
            return [name, view ? JSON.stringify([view.worldToView, view.projection]) : null]
        })),
    })
    window.addEventListener('pagehide', () => Object.values(worlds).forEach(world => world.dispose()), { once: true })
    window.wheelReady = true
} catch (error) { window.wheelError = error.stack }
</script>
HTML

python3 -m http.server --bind 127.0.0.1 --directory "$out" "$port" >"$out/http.log" 2>&1 &
http=$!
sleep 0.2

node "$root/scripts/verify/host_play.mjs" "$port" "$out"
