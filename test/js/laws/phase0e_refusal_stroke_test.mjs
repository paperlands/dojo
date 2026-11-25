// Phase 0e: what a refused move does to the figure.
//
// Probe: accepted segment -> refused move -> accepted segment -> fill
//
//   fw 5      (0 -> 5)   accepted
//   fw 5      (5 -> 10)  refused
//   fw 3      (5 -> 8)   accepted
//   fill
//
// Two interaction policies, same program:
//   refusalStroke "break"    — refusal flushes the open path (historical default)
//   refusalStroke "continue" — refusal holds the pose and the trail joins through it
//
// The question: does refusal merely prevent movement, or does it also split the
// figure and change what fill covers? (laws-build.org id:laws-build-solve-seam)
//
// Run: node --test test/js/laws/phase0e_refusal_stroke_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

function fork(name, src) {
    return {
        name, origin: SE3.identity(), frame: null,
        style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
        code: { ast: parseProgram(src), functions: {} },
        env: { userspace: new Map(), loopCounter: 0, scope: {} },
    }
}

// Refuse only the over-long middle move; every other motion is accepted unchanged.
const refuseTheStretch = ({ requested }) =>
    requested.position[0] === 10 ? { accepted: false } : { accepted: true, transform: requested }

const SOURCE = "fw 5\nfw 5\nfw 3\nfill\nwait 1"

function run(refusalStroke) {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 0, breathEvery: 1 },
        channelCapacity: 64,
        motionAdmission: refuseTheStretch,
        refusalStroke,
        onShout: () => {},
    })
    scheduler.hotSwapChild("w", fork("w", SOURCE))

    const paths = []
    for (let i = 0; i < 20 && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        for (const frame of scheduler.registry.values()) {
            if (frame === scheduler.root) continue
            for (const event of frame.channel.drain()) {
                if (event.type === "path") paths.push({ points: event.points, filled: event.filled })
            }
        }
    }
    return { scheduler, paths, final: scheduler.root.children.get("w").transform.deref().position }
}

test("refusal with break splits the figure: fill covers only the segment after it", () => {
    const { paths, final } = run("break")

    assert.equal(paths.length, 2, "the refused move flushed a boundary")
    assert.deepEqual(paths[0], { points: [[0, 0, 0], [5, 0, 0]], filled: false })
    assert.deepEqual(paths[1], { points: [[5, 0, 0], [8, 0, 0]], filled: true },
        "fill covered only the second segment — the first is left open")
    assert.deepEqual([...final], [8, 0, 0], "refusal still prevented the over-long move")
})

test("refusal with continue holds the pose and joins the trail: fill covers both segments", () => {
    const { paths, final } = run("continue")

    assert.equal(paths.length, 1, "no boundary was invented at the refusal")
    assert.deepEqual(paths[0], {
        points: [[0, 0, 0], [5, 0, 0], [5, 0, 0], [8, 0, 0]],
        filled: true,
    }, "one filled figure; the refused move contributed no geometry")
    assert.deepEqual([...final], [8, 0, 0])
})

test("the two policies agree on movement and disagree on the figure", () => {
    const brk = run("break")
    const cont = run("continue")
    assert.deepEqual([...brk.final], [...cont.final], "refusal is about movement in both")
    assert.notDeepEqual(brk.paths, cont.paths, "but the interaction decision changed the ink and the fill")
})
