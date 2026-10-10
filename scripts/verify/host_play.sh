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

node "$root/scripts/release/host.mjs" "$out/runtime" >/dev/null

cat > "$out/index.html" << 'HTML'
<style>#c { display: block; width: 320px; height: 240px; }</style>
<div><canvas id="c" width="320" height="240"></canvas></div>
<pre id="out"></pre>
<script type="module">
const out = document.getElementById("out")
const say = (s) => { out.textContent += s + "\n" }
try {
    const { createHatch } = await import("./runtime/host.mjs")
    const canvas = document.getElementById("c")
    const hatch = createHatch(canvas)
    try {
        await hatch.play("nope")
        say("bad:accepted")
    } catch (e) {
        say("bad:" + e.message + ":badline:" + (e.wound?.span?.line ?? "noline"))
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
    hatch3.onBeat((b) => beats.push(b))
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
    hatch4.onBeat((b) => beats4.push(b))
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
    hatchN.onBeat((b) => beatsN.push(b))
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
    const hatch5 = createHatch(canvas, { law: { motionAdmission: pair } })
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
    const run5 = await hatch5.play(prog5)
    await run5.finished
    const first = accepted.length
    const run5b = await hatch5.play(prog5)   // a fresh play re-establishes, never inherits
    await run5b.finished
    const repeated = accepted.length === first * 2
        && accepted.slice(first).every((p, i) => p[0] === accepted[i][0] && p[1] === accepted[i][1])
    hatch5.dispose()
    let disposedRefused = false
    try { await hatch5.play(prog5) } catch (e) { disposedRefused = e.message === "hatch disposed" }
    const lawsok = first === 2
        && accepted.slice(0, first).every(([x, y]) => Math.abs(Math.abs(x - y) - 5) < 1e-9)
        && accepted[first - 1][0] === 3 && accepted[first - 1][1] === 8
        && repeated && disposedRefused
    say("laws:" + JSON.stringify(accepted))
    // Disposal is stronger than dropping the hatch handle: a nested, delayed
    // verdict cannot wake its old frame after the canvas is gone.
    let answer6, parked6
    const hatch6 = createHatch(canvas, { law: { motionAdmissionAsync: ({ frame, requested }) => {
        if (frame.name !== "a") return { accepted: true, transform: requested }
        parked6 = frame
        return new Promise(resolve => { answer6 = resolve })
    } } })
    const run6 = await hatch6.play("as b do\nend\nas a do\n  fw 1\nend")
    const ended6 = run6.finished.catch(e => e.message)
    const parked = parked6?.suspension?.kind === "admission"
    hatch6.dispose()
    answer6?.({ accepted: true, transform: { ...parked6.transform.deref(), position: [50, 0, 0] } })
    await Promise.resolve()
    say("pendingdispose:" + (parked && parked6.done && parked6.channel.closed
        && parked6.transform.deref().position[0] === 0 && await ended6 === "hatch disposed"))
    say("lawsok:" + lawsok)

    // The host seam reads authored properties and proposes through native admission.
    const hatch7 = createHatch(canvas)
    const run7 = await hatch7.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run7.finished
    const initial7 = hatch7.interaction.read("A", "x")
    const coincident7 = hatch7.interaction.read("A", "bearing")
    const defaultDown7 = new PointerEvent("pointerdown", { clientX: 160, clientY: 120, pointerId: 70, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    canvas.dispatchEvent(defaultDown7)
    const defaultInteractionOff7 = !defaultDown7.defaultPrevented
    const missing7 = hatch7.interaction.read("NotDeclared", "x")
    const samples7 = []
    const mutatedSamples7 = []
    const stop7 = hatch7.interaction.subscribe("A", "x", answer => samples7.push(answer.value))
    const stopMutate7 = hatch7.interaction.subscribe("A", "x", answer => {
        mutatedSamples7.push(answer.value)
        if (mutatedSamples7.length === 1) {
            try { answer.value = 7 } catch { /* frozen public answer */ }
        }
    })
    const stopThrow7 = hatch7.interaction.subscribe("A", "x", () => { throw new Error("observer") })
    const movedToSeven7 = hatch7.interaction.propose("A", [7, 0, 0])
    const moved7 = hatch7.interaction.propose("A", [12, 0, 0])
    const refused7 = hatch7.interaction.propose("A", [12, Number.POSITIVE_INFINITY, 0])
    const final7 = hatch7.interaction.read("A", "x")
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
    const stopObsolete7 = hatch7.interaction.subscribe("A", "x", answer => obsoleteSamples7.push(answer.value))
    const replay7 = await hatch7.play("let A\nlet A.y = 0\nlet A.z = 0")
    await replay7.finished
    hatch7.interaction.propose("A", [20, 0, 0])
    const replayRetired7 = obsoleteSamples7.length === 1 && obsoleteSamples7[0] === 12
    stopObsolete7()
    hatch7.dispose()
    const retired7 = hatch7.interaction.read("A", "x").kind === "retired"
    const hatch8 = createHatch(canvas, { interactive: true })
    const run8 = await hatch8.play("let A\nlet A.z = 0\nlet A.distance = 50")
    await run8.finished
    const bearing8 = hatch8.interaction.read("A", "bearing")
    const rotatorEvents8 = []
    const stopBearing8 = hatch8.interaction.subscribe("A", "bearing", answer => rotatorEvents8.push(answer.value))
    const rotated8 = hatch8.interaction.propose("A", [0, 0, 0])
    const bearingAfter8 = hatch8.interaction.read("A", "bearing")
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
    const pointerBearing8 = hatch8.interaction.read("A", "bearing")
    const distanceAfter8 = hatch8.interaction.read("A", "distance")
    const zAfter8 = hatch8.interaction.read("A", "z")
    const rotatorOk = bearing8.kind === "value" && rotated8.kind === "accept"
        && bearingAfter8.kind === "value" && bearingAfter8.value !== bearing8.value
        && rotatorPointerClaimed8 && pointerBearing8.kind === "value" && pointerBearing8.value !== bearingAfter8.value
        && distanceAfter8.kind === "value" && Math.abs(distanceAfter8.value - 50) < 1e-9
        && zAfter8.kind === "value" && zAfter8.value === 0
        && rotatorEvents8.length === 3 && rotatorEvents8[0] === bearing8.value
        && rotatorEvents8[1] === bearingAfter8.value && rotatorEvents8[2] === pointerBearing8.value
    const lifecycleOk = retired7 && replayRetired7
    const hatch10 = createHatch(canvas)
    const source10 = ["goto 10 20", "rt 90", "let A", "let A.z = 0",
        "let A.distance = 50", "let b = A.bearing"].join("\n")
    const run10 = await hatch10.play(source10)
    await run10.finished
    const directBearing10 = hatch10.interaction.read("A", "bearing")
    const scalarBearing10 = hatch10.interaction.read("b")
    const observerOk10 = directBearing10.kind === "value"
        && Object.is(directBearing10.value, scalarBearing10.value)
    hatch10.dispose()
    const hatch11 = createHatch(canvas)
    const run11 = await hatch11.play("let A\nlet A.y = 0\nlet A.z = 0\nlet s = A.x")
    await run11.finished
    const scalarSamples11 = []
    const stop11 = hatch11.interaction.subscribe("s", answer => scalarSamples11.push(answer.value))
    const scalarMoved11 = hatch11.interaction.propose("A", [7, 0, 0])
    const scalarOk11 = scalarSamples11[0] === 0 && scalarSamples11.at(-1) === 7
        && scalarMoved11.kind === "accept"
    stop11()
    let finishPaint11
    const paintGate11 = new Promise(resolve => { finishPaint11 = resolve })
    window.proposalWitnessReady = true
    window.runProposalWitness = async () => {
        const verdict = hatch11.interaction.propose("A", [17, 0, 0])
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return verdict.kind === "accept" && hatch11.interaction.read("A", "x").value === 17
    }
    window.finishProposalWitness = rendered => finishPaint11(rendered)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    say("PAINT_READY")
    const proposalRendered11 = await paintGate11
    hatch11.dispose()
    say("proposalRendered:" + proposalRendered11)
    const hatch12 = createHatch(canvas, { law: { motionAdmission: ({ requested }) => ({ accepted: true, transform: requested }) } })
    const run12 = await hatch12.play("let A\nlet A.z = 0\nlet A.distance = 50")
    await run12.finished
    const refusalEvents12 = []
    const stop12 = hatch12.interaction.subscribe("A", "bearing", answer => refusalEvents12.push(answer.value))
    const beforeRefusal12 = hatch12.interaction.read("A", "bearing")
    const finiteRefusal12 = hatch12.interaction.propose("A", [0, 0, 0])
    const refusalState12 = hatch12.interaction.read("A", "bearing")
    const refusalOk12 = finiteRefusal12.kind === "refuse"
        && Object.is(refusalState12.value, beforeRefusal12.value)
        && refusalEvents12.length === 1
        && refusalEvents12.length === 1 && refusalEvents12[0] === 0
    stop12()
    hatch12.dispose()
    const hatch17 = createHatch(canvas)
    const run17 = await hatch17.play("as A do\n  rt 90\nend")
    await run17.finished
    const headingBefore17 = hatch17.interaction.read("A", "heading")
    const headedProposal17 = hatch17.interaction.propose("A", [1, 0, 0])
    const headingAfter17 = hatch17.interaction.read("A", "heading")
    const headedRejected17 = headedProposal17.kind === "unsupported"
        && headingBefore17.kind === "value" && headingAfter17.kind === "value"
        && headingBefore17.value === headingAfter17.value
    hatch17.dispose()
    const hatch13 = createHatch(canvas)
    const run13 = await hatch13.play("let A\nlet A.y = 0\nlet A.z = 0\nlet B\nlet B.y = 0\nlet B.z = 0")
    await run13.finished
    const positions13 = []
    const stop13 = hatch13.interaction.subscribe("A", "position", answer => {
        positions13.push([...answer.value])
        if (positions13.length === 1) {
            try { answer.value[0] = 42 } catch { /* frozen public vector */ }
        }
    })
    const movedB13 = hatch13.interaction.propose("B", [5, 0, 0])
    const unchangedA13 = hatch13.interaction.read("A", "position")
    const positionOk13 = movedB13.kind === "accept" && positions13.length === 1
        && Object.isFrozen(unchangedA13.value) && unchangedA13.value[0] === 0
    stop13()
    hatch13.dispose()
    const hatch14 = createHatch(canvas)
    const run14 = await hatch14.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run14.finished
    const siblingValues14 = [], lateValues14 = []
    let lateStop14 = () => {}, siblingStop14 = () => {}, lateCreated14 = false
    const spawnerStop14 = hatch14.interaction.subscribe("A", "x", answer => {
        if (answer.value !== 0 && !lateCreated14) {
            lateCreated14 = true
            lateStop14 = hatch14.interaction.subscribe("A", "x", value => lateValues14.push(value.value))
            siblingStop14()
        }
    })
    siblingStop14 = hatch14.interaction.subscribe("A", "x", answer => siblingValues14.push(answer.value))
    hatch14.interaction.propose("A", [7, 0, 0])
    const snapshotWatchers14 = lateValues14.join() === "7" && siblingValues14.join() === "0"
    hatch14.interaction.propose("A", [8, 0, 0])
    const watchersOk14 = snapshotWatchers14 && lateValues14.join() === "7,8" && siblingValues14.join() === "0"
    spawnerStop14()
    lateStop14()
    hatch14.dispose()
    const hatch15 = createHatch(canvas)
    const run15 = await hatch15.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run15.finished
    const disposedSibling15 = []
    const disposeFirst15 = hatch15.interaction.subscribe("A", "x", answer => {
        if (answer.value === 7) hatch15.dispose()
    })
    hatch15.interaction.subscribe("A", "x", answer => disposedSibling15.push(answer.value))
    const disposedDuringDelivery15 = hatch15.interaction.propose("A", [7, 0, 0]).kind === "accept"
        && disposedSibling15.join() === "0"
        && hatch15.interaction.read("A", "x").kind === "retired"
    disposeFirst15()
    say("positionEquality:" + positionOk13)
    say("watchers:" + watchersOk14 + ":disposeDelivery:" + disposedDuringDelivery15)
    say("finiteRefusal:" + refusalOk12 + ":headed:" + headedRejected17)
    say("rotator:" + JSON.stringify({ bearing8, rotated8: rotated8.kind, bearingAfter8, distanceAfter8, zAfter8, rotatorEvents8 }))
    stopBearing8()
    say("observer:" + JSON.stringify({ directBearing10, scalarBearing10 }))
    hatch8.dispose()
    const hatch9 = createHatch(canvas, { interactive: true })
    const run9 = await hatch9.play("let A\nlet A.y = 0\nlet A.z = 0")
    await run9.finished
    await new Promise(resolve => setTimeout(resolve, 100))
    const rect9 = canvas.getBoundingClientRect()
    const center9 = { x: rect9.left + rect9.width / 2, y: rect9.top + rect9.height / 2 }
    const down9 = new PointerEvent("pointerdown", { clientX: center9.x, clientY: center9.y, pointerId: 71, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    canvas.dispatchEvent(down9)
    const move9 = new PointerEvent("pointermove", { clientX: center9.x + 30, clientY: center9.y, pointerId: 71, pointerType: "mouse", buttons: 1, bubbles: true, cancelable: true })
    window.dispatchEvent(move9)
    window.dispatchEvent(new PointerEvent("pointerup", { ...center9, pointerId: 71, pointerType: "mouse", button: 0, buttons: 0, bubbles: true, cancelable: true }))
    const pointer9 = hatch9.interaction.read("A", "x")
    const claimed9 = down9.defaultPrevented
    const movedByPointer9 = pointer9.kind === "value" && pointer9.value !== 0
    const outside9 = new PointerEvent("pointerdown", { clientX: 5, clientY: 5, pointerId: 72, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    document.body.dispatchEvent(outside9)
    const outsideNotCaptured9 = !outside9.defaultPrevented
    hatch9.dispose()
    const hatch16 = createHatch(canvas, { interactive: true })
    const source16 = "let A\nlet A.y = 0\nlet A.z = 0"
    const run16 = await hatch16.play(source16)
    await run16.finished
    await new Promise(resolve => setTimeout(resolve, 80))
    const rect16 = canvas.getBoundingClientRect()
    const down16 = new PointerEvent("pointerdown", { clientX: rect16.left + rect16.width / 2, clientY: rect16.top + rect16.height / 2, pointerId: 81, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true })
    canvas.dispatchEvent(down16)
    const replacement16 = await hatch16.play(source16)
    await replacement16.finished
    await new Promise(resolve => setTimeout(resolve, 80))
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: rect16.left + rect16.width / 2 + 30, clientY: rect16.top + rect16.height / 2, pointerId: 81, pointerType: "mouse", buttons: 1, bubbles: true, cancelable: true }))
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: rect16.left + rect16.width / 2 + 30, clientY: rect16.top + rect16.height / 2, pointerId: 81, pointerType: "mouse", button: 0, buttons: 0, bubbles: true, cancelable: true }))
    const afterHeldReplacement16 = hatch16.interaction.read("A", "x")
    const replacedHeldOk16 = down16.defaultPrevented && afterHeldReplacement16.kind === "value"
        && afterHeldReplacement16.value === 0
    hatch16.dispose()
    say("pointer:" + JSON.stringify({ claimed9, pointer9, movedByPointer9, outsideNotCaptured9, down16: down16.defaultPrevented, afterHeldReplacement16, replacedHeldOk16 }))
    say("interactionok:" + interactionOk + ":lifecycle:" + lifecycleOk + ":position:" + positionOk13 + ":watchers:" + watchersOk14 + ":dispose-delivery:" + disposedDuringDelivery15 + ":finite-refusal:" + refusalOk12 + ":headed:" + headedRejected17 + ":rotator:" + rotatorOk + ":observer:" + observerOk10 + ":scalar:" + scalarOk11 + ":pointer:" + (claimed9 && movedByPointer9 && outsideNotCaptured9 && replacedHeldOk16))
    const hatch18 = createHatch(canvas)
    const run18 = await hatch18.play("let s = 1\nlet t = s\nwait 0.1\nlet s = 2\nlet A")
    const sourceSamples18 = [], birthSamples18 = []
    hatch18.interaction.subscribe("s", answer => sourceSamples18.push([answer.value, hatch18.interaction.read("t").value]))
    hatch18.interaction.subscribe("A", "x", answer => birthSamples18.push(answer.kind === "value" ? answer.value : answer.kind))
    await run18.finished
    const sourceOk18 = JSON.stringify(sourceSamples18) === "[[1,1],[2,2]]"
        && JSON.stringify(birthSamples18) === '["missing",0]'
    const vectorRun18 = await hatch18.play("let A\nlet v = [A.x, A.y, A.z, 4]")
    await vectorRun18.finished
    const vectorSamples18 = []
    hatch18.interaction.subscribe("v", answer => vectorSamples18.push(answer.value))
    const vectorMoved18 = hatch18.interaction.propose("A", [7, 0, 0])
    const vectorsOk18 = vectorMoved18.kind === "accept"
        && JSON.stringify(vectorSamples18) === "[[0,0,0,4],[7,0,0,4]]"
        && vectorSamples18.every(Object.isFrozen)
    hatch18.dispose()
    say("sourceValues:" + sourceOk18 + ":vectors:" + vectorsOk18)
    // Two page-owned surfaces; each overlay and bitmap follows only its canvas.
    const surfacePlate = document.createElement("div")
    surfacePlate.style.cssText = "position:absolute;left:400px;top:20px"
    const surfaceA = document.createElement("canvas"), surfaceB = document.createElement("canvas")
    surfaceA.style.cssText = "display:block;width:213px;height:117px;border:1px solid white"
    surfaceB.style.cssText = "display:block;width:140px;height:90px"
    surfacePlate.append(surfaceA, surfaceB)
    document.body.append(surfacePlate)
    const surfaceHatchA = createHatch(surfaceA), surfaceHatchB = createHatch(surfaceB)
    await (await surfaceHatchA.play("fw 5")).finished
    await (await surfaceHatchB.play("fw 5")).finished
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
    surfaceHatchA.dispose()
    surfaceParts.isolated = surfacePlate.querySelectorAll(":scope > canvas").length === 3
    await (await surfaceHatchB.play("fw 8")).finished
    surfaceHatchB.dispose()
    surfaceParts.disposed = surfacePlate.querySelectorAll(":scope > canvas").length === 2
    surfacePlate.remove()

    // No CSS size: DPR must not amplify the intrinsic box on each resize.
    const barePlate = document.createElement("div")
    const bareCanvas = document.createElement("canvas")
    barePlate.append(bareCanvas)
    document.body.append(barePlate)
    const bareWidth = bareCanvas.getBoundingClientRect().width
    const bareHatch = createHatch(bareCanvas)
    await (await bareHatch.play("fw 5")).finished
    await new Promise(resolve => setTimeout(resolve, 150))
    surfaceParts.unsized = bareCanvas.getBoundingClientRect().width === bareWidth
        && bareCanvas.width === Math.floor(bareWidth * dpr)
    bareHatch.dispose()
    barePlate.remove()
    say("surface:" + JSON.stringify(surfaceParts))
    say("surfaceok:" + Object.values(surfaceParts).every(Boolean))

    const delayedHatch = createHatch(canvas)
    const delayedRun = await delayedHatch.play("wait 0.05\nlet s = 7")
    const delayedSamples = []
    delayedHatch.interaction.subscribe("s", answer => delayedSamples.push(answer.kind === "value" ? answer.value : answer.kind))
    await delayedRun.finished
    delayedHatch.dispose()
    const walkingHatch = createHatch(canvas)
    const walkingRun = await walkingHatch.play("as A do\nwait 0.05\njmp 10\nend")
    const walkingSamples = []
    walkingHatch.interaction.subscribe("A", "position", answer => walkingSamples.push(answer.value?.[0]))
    await walkingRun.finished
    walkingHatch.dispose()
    say("walkingReads:" + (JSON.stringify(delayedSamples) === '["missing",7]'
        && JSON.stringify(walkingSamples) === '[0,10]'))
    const lateHatch = createHatch(canvas)
    const lateRun = await lateHatch.play("fw 1\nwait 0.05\nnope")
    let lateFatal = false
    try { await lateRun.finished } catch (error) {
        lateFatal = error.reason === "fatal" && error.wound?.span?.line === 3
    }
    lateHatch.dispose()
    const capHatch = createHatch(canvas, { caps: { maxCommands: 4 } })
    const capRun = await capHatch.play("fw 1\nwait 0.05\nlimitCommand 100\nfw 1\nfw 1\nfw 1")
    let capFatal = false
    try { await capRun.finished } catch (error) { capFatal = error.reason === "fatal" }
    capHatch.dispose()
    say("hostTruth:" + (lateFatal && capFatal))
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
