// Phase 0n: initial activation — attacking the proposed ordering.
//
// Proposed contract:
//   identify supported declarations and identities
//    → assemble the active relationship batch
//    → realize and independently validate
//    → publish an accepted configuration
//    → allow governed actions
//
// Invariant under attack: no user-written `wait` may decide whether the first
// action is governed.
//
// `let` has no parser form yet, so a "declaration" here is the injected
// admission policy and the identities are real seated frames. These probes are
// characterization: each names the stage it attacks and records what the machine
// answers today.
// Run: node --test test/js/laws/phase0n_activation_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, drive, settle } from "./harness.mjs"
import { takeSync, worldTransform, frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pos = (scheduler, name) => frameWorldTransform(find(scheduler.root, name)).position
const pair = (scheduler) => [pos(scheduler, "a")[0], pos(scheduler, "b")[0]]

// The declared relationship drives from A: equal displacement of both ends keeps
// |AB| = 5. B's own motion is ungoverned, so seating order is the only variable.
const responder = ({ requested, frame }) => {
    if (frame.name !== "a") return { accepted: true, transform: requested }
    const other = frame.parent.children.get("b")
    if (!other) return { accepted: false }
    const current = frame.transform.deref()
    const delta = requested.position[0] - current.position[0]
    return { accepted: true, transform: requested, component: [{
        frame: other,
        transform: { ...other.transform.deref(), position: [other.transform.deref().position[0] + delta, 0, 0] },
    }] }
}

// Independent census: Euclidean world distance over the accepted reply, never
// the responder's own displacement rule.
const pairFive = ({ writer, entries }) => {
    const other = writer.parent.children.get(writer.name === "a" ? "b" : "a")
    if (!other) return false
    const world = (frame) => {
        const local = entries.find((e) => e.frame === frame)?.pose ?? frame.transform.deref()
        return SE3.compose(worldTransform(frame), local).position
    }
    const a = world(writer), b = world(other)
    return Math.abs(Math.hypot(...a.map((v, i) => v - b[i])) - 5) < 1e-9
}

test("invariant: a user-written wait is not what makes the first action governed", () => {
    const run = (src) => {
        const scheduler = buildWorld({ admit: responder })
        scheduler.hotSwapChild("a", fork("a", src), { deferStart: true })
        scheduler.hotSwapChild("b", fork("b", "wait 5", at(5)), { deferStart: true })
        drive(scheduler)
        return scheduler
    }
    // Both are governed, identically: admission is a construction option, so the
    // first action was never ungoverned to begin with. The invariant holds because
    // there is no activation stage for a `wait` to stand in for.
    assert.deepEqual(pair(run("goto 1 0")), [1, 6])
    assert.deepEqual(pair(run("wait 0.5\ngoto 1 0")), [1, 6])
})

test("attack: which endpoint is assembled first decides governance, with no wait written", () => {
    const run = (order) => {
        const scheduler = buildWorld({ admit: responder })
        const source = order === "b-first"
            ? ["as b do", "  fw 5", "  wait 5", "end", "as a do", "  goto 1 0", "  wait 5", "end"]
            : ["as a do", "  goto 1 0", "  wait 5", "end", "as b do", "  fw 5", "  wait 5", "end"]
        scheduler.hotSwapChild("host", fork("host", source.join("\n")))
        drive(scheduler)
        return pair(scheduler)
    }
    // No `wait` is written in either. Statement order alone decides whether the
    // first action is governed: with its endpoint already assembled it moves
    // (1,6); with the endpoint still to come it is silently refused and the pair
    // stays (0,5). Stage 2 ("assemble the batch") has no representation, so
    // source order is standing in for it.
    assert.deepEqual(run("b-first"), [1, 6])
    assert.deepEqual(run("a-first"), [0, 5])
})

test("attack: a missing endpoint is reported as a refusal, not an unassembled batch", () => {
    const scheduler = buildWorld({ admit: responder })
    const a = scheduler.hotSwapChild("a", fork("a", "goto 1 0"))
    drive(scheduler)
    // The relationship names b; b is never declared. The machine answers with the
    // same observable as a genuine mathematical refusal: pose held, no wound.
    assert.equal(a.error, null)
    assert.equal(a.done, true)
    assert.equal(find(scheduler.root, "b"), null, "b was never declared")
    assert.equal(pos(scheduler, "a")[0], 0)
    // Nothing distinguishes "the batch is incomplete" from "the relationship
    // forbids this move" — the frame is finished and carries no suspension.
    assert.equal(a.suspension, null)
})

test("attack: an invalid seed has no realize door — the first action wounds", () => {
    const scheduler = buildWorld({ admit: responder, validate: pairFive })
    scheduler.hotSwapChild("a", fork("a", "goto 1 0"), { deferStart: true })
    scheduler.hotSwapChild("b", fork("b", "wait 5"), { deferStart: true })   // coincident seed
    drive(scheduler)
    // Equal displacement keeps a coincident pair coincident, so the reply fails
    // independent validation. No stage realizes a valid configuration from an
    // invalid seed; the frame wounds instead.
    assert.equal(scheduler.root.children.get("a").error?.kind, "motion")
    assert.equal(pos(scheduler, "a")[0], 0)
})

test("attack: a relationship naming an existing ambient adopts it, never a second A", () => {
    const scheduler = buildWorld({ admit: responder })
    const host = scheduler.hotSwapChild("host", fork("host", [
        "as b do", "  fw 5", "  wait 5", "end",
        "as a do", "  goto 1 0", "  wait 5", "end",
    ].join("\n")))
    drive(scheduler)
    // Adoption is scoped-name lookup: the relationship addressed the ambient the
    // source already seated. There is no adapter identity and no second A.
    assert.equal(host.children.size, 2, "one A, one B")
    assert.deepEqual(pair(scheduler), [1, 6])
})

test("attack: source replacement while a program admission is pending is NOT dropped", async () => {
    let answer
    const scheduler = buildWorld({ admitAsync: ({ frame, requested }) => {
        if (frame.name !== "a") return { accepted: true, transform: requested }
        return new Promise((resolve) => { answer = resolve })
    } })
    const a = scheduler.hotSwapChild("a", fork("a", "goto 1 0"))
    const first = scheduler.hotSwapChild("b", fork("b", "wait 5", at(5)))
    assert.equal(a.suspension?.kind, "admission")
    scheduler.hotSwapChild("b", fork("b", "label 'edited' 0", at(5)), { fresh: true })
    const second = scheduler.root.children.get("b")
    assert.notEqual(first, second, "the dependency really was replaced")
    answer({ accepted: true, transform: at(1) })
    await settle()
    drive(scheduler)
    // The program door carries no base revision: only the pure-=goto= observation
    // path attaches one. The delivery fence is run/seq/identity, which a source
    // edit leaves intact — so a reply based on a configuration that no longer
    // exists is applied.
    assert.equal(a.error ?? null, null)
    assert.deepEqual(pos(scheduler, "a").slice(0, 2), [1, 0])
})

test("attack: deletion and recreation of an endpoint is fenced by identity, not freshness", async () => {
    const run = async (name) => {
        let answer
        const scheduler = buildWorld({ admitAsync: ({ frame, requested }) => {
            if (frame.name !== "a") return { accepted: true, transform: requested }
            return new Promise((resolve) => { answer = resolve })
        } })
        const a = scheduler.hotSwapChild("a", fork("a", "goto 1 0"))
        const b = scheduler.hotSwapChild("b", fork("b", "wait 5", at(5)))
        assert.equal(a.suspension?.kind, "admission")
        scheduler.removeChild("b")
        const b2 = scheduler.hotSwapChild("b", fork("b", "wait 5", at(5)))
        answer({
            accepted: true, transform: at(1),
            component: [{ frame: name === "old" ? b : b2, transform: at(1) }],
        })
        await settle()
        return { a, scheduler }
    }
    // A reply naming the frame that left the world is refused as a transaction
    // conflict; the recreated endpoint keeps its own seat.
    const left = await run("old")
    assert.equal(left.a.error?.kind, "motion")
    assert.deepEqual(pos(left.scheduler, "b").slice(0, 2), [5, 0])
    // A reply naming the recreated frame is applied. Nothing fences the new
    // identity for a program motion: sharing the name is enough to adopt a dead
    // run's reply.
    const fresh = await run("new")
    assert.equal(fresh.a.error ?? null, null)
    assert.deepEqual(pair(fresh.scheduler), [1, 6])
})

test("attack: an invalid edit leaves the previous picture displayed as an accepted result", () => {
    let valid = true
    const scheduler = buildWorld({ admit: (request) => valid ? responder(request) : { accepted: false } })
    const a = scheduler.hotSwapChild("a", fork("a", "goto 1 0"), { deferStart: true })
    const b = scheduler.hotSwapChild("b", fork("b", "wait 5", at(5)), { deferStart: true })
    drive(scheduler)
    assert.deepEqual(pair(scheduler), [1, 6])
    assert.equal(takeSync(a)?.find((e) => e.type === "head")?.position[0], 1)

    // The truths change: the relationship can no longer be satisfied.
    valid = false
    const verdict = scheduler.requestMotion(a, at(3), scheduler.motionRevision)
    assert.equal(verdict.kind, "refuse")
    assert.deepEqual(pair(scheduler), [1, 6], "accepted geometry is untouched")
    assert.notEqual(takeSync(a)?.find((e) => e.type === "head")?.position?.[0], 3,
        "a refusal writes no new head")
    // Nothing marks the still-visible pair as no longer a valid realization of the
    // current truths: no error, and no state says otherwise. Stage 3's
    // "the previous picture is shown as such" has no representation.
    assert.equal(a.error, null)
    assert.equal(b.error, null)
})
