// A DISPLAY CUT holds only when every live frame in the subtree has closed its instant.
// Regression: a done intermediate body that still owns a living descendant must NOT report
// a cut. Controls: a healthy wait is a cut, and a wholly finished tree is a cut.
// (id:render-construction-cadence, id:render-construction-cadence-wait-regression)
// Run: node --test test/js/runtime/construction_cut_test.mjs
import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork } from "../laws/harness.mjs"

function seat(source, config = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0, ...config })
    scheduler.hotSwapChild("host", fork("host", source), { fresh: true, deferStart: true })
    return scheduler
}
const tick = (scheduler, horizon, budget = null) => scheduler.withSlice(budget, () => scheduler.tick(horizon))
const drain = scheduler => { for (const frame of scheduler.registry.values()) frame.channel.drain() }
const living = scheduler => [...scheduler.registry.values()].filter(frame => frame !== scheduler.root && !frame.done)
const endsAtAncestor = frame => { for (let node = frame.parent; node; node = node.parent) if (node.done) return true; return false }

describe("display cut — descendant traversal", () => {
    // The ended-owner counterexample: the enclosing figure and host finish while a contained
    // child is still building. A breath park on the child must keep the cut false.
    test("a done ancestor with a living breath-suspended descendant is not a cut", () => {
        const scheduler = seat("draw r n do\n as kid do\n  fw 1\n  wait 0.1\n  loop n do\n   fw 1\n  end\n end\nend\nlet F = r 600", { breathEvery: 4 })
        tick(scheduler, 0)
        drain(scheduler)
        tick(scheduler, 100, -1)
        drain(scheduler)

        const parked = living(scheduler).filter(frame => frame.suspension?.kind === "breath")
        assert.ok(parked.length > 0, "a living breath-suspended descendant exists")
        assert.ok(endsAtAncestor(parked[0]), "the descendant sits under an ended owner")
        assert.equal(scheduler.atCut, false, "a living descendant under a done owner is not a cut")
    })

    test("control: a healthy wait is a cut", () => {
        const scheduler = seat("fw 1\nwait 0.1\nfw 2")
        tick(scheduler, 0)
        drain(scheduler)
        assert.equal(scheduler.done, false, "the wait keeps the program live")
        assert.equal(scheduler.atCut, true, "a wait with no pending instant is a cut")
    })

    test("control: a wholly finished tree is a cut", () => {
        const scheduler = seat("fw 1\nfw 2")
        for (let pass = 0; pass < 20 && !scheduler.done; pass++) {
            tick(scheduler, 0)
            drain(scheduler)
        }
        assert.equal(scheduler.done, true, "the program finished")
        assert.equal(scheduler.atCut, true, "a finished tree is a cut")
    })
})
