// Standing regression: an ACTOR drives a free distance spine in the ORDINARY shell.
//
// No laboratory responder, no URL option, no admission injection. What is asserted is the
// placement policy's promise, not its implementation: every child sits on the sphere about
// its PLACED parent, in the direction of its own ACCEPTED position, and every length holds.
// (id:laws-free-relations-f4-actor, id:laws-free-relations-compositional-center)
//
// Run: node --test test/js/laws/actor_follow_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, worldOf } from "./harness.mjs"
import { frameWorldTransform, lawWorld } from "../../../assets/js/turtling/scheduler.js"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { makeDistanceTerm } from "../../../assets/js/turtling/laws/authored.js"
import { lawViolation } from "../../../assets/js/turtling/laws/verdict.js"
import { programFollowing } from "../../../assets/js/turtling/laws/program_following.js"
import { SE3, AXIS_X, AXIS_Y, AXIS_Z } from "../../../assets/js/turtling/se3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const r6ish = (v) => v.map((n) => +n.toFixed(9))
const sub = (a, b) => a.map((v, i) => v - b[i])
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const unit = (a) => { const L = Math.hypot(...a); return a.map((v) => v / L) }
const exactQ = (a, b) => a.w === b.w && a.x === b.x && a.y === b.y && a.z === b.z
const IDENT = SE3.identity()
const DRIVER = "  jmp 1\n  wait 1/24\n  rt 30\n  wait 1/24\n  jmp 1\n  wait 1/24"

const spine = (n) => {
    const names = "ABCDEFGHI".slice(0, n).split("")
    return [
        names.map((id, i) => `${i === 0 ? "" : "jmp 5\n"}let ${id}`).join("\n"),
        names.slice(1).map((id, i) => `let distance(${names[i]},${id})=5`).join("\n"),
        `wait 1\nas A do\n${DRIVER}\nend\n`,
    ].join("\n")
}

// A monotonic logical clock: harness.drive() restarts `now`, so waits never resume.
function settle(scheduler, host, ids, { steps = 60 } = {}) {
    let now = 0
    const tick = () => { now += 1000; scheduler.tick(now); scheduler.readouts?.drain?.() }
    // One publish AND one slice-complete notification per pass, so commits are deduplicated by
    // revision. A MOTION commit is the one whose attempt is the program's own and accepted.
    const commits = []
    let lastRev = -1
    scheduler.onAcceptedChange(() => {
        if (!ids.every((id) => host.children.get(id))) return   // a watcher may run before birth
        const rev = scheduler.motionRevision
        if (rev === lastRev) return
        lastRev = rev
        const attempt = scheduler.root._lastAttempt
        const at = Object.fromEntries(ids.map((id) => [id, worldOf(host.children.get(id))]))
        commits.push({ rev, path: attempt?.path ?? null, verdict: attempt?.verdict ?? null,
            owner: attempt?.owner ?? null, at,
            bonds: ids.slice(1).map((id, k) => dist(at[ids[k]], at[id])) })
    })
    for (let guard = 0; guard < 40 && !ids.every((id) => host.children.get(id)); guard++) tick()
    for (const id of ids) assert.ok(host.children.get(id), `${id} was never born`)
    const seated = Object.fromEntries(ids.map((id) => [id, {
        p: worldOf(host.children.get(id)),
        q: frameWorldTransform(host.children.get(id)).rotation,
        local: host.children.get(id).transform.deref().rotation }]))
    const rev0 = scheduler.motionRevision
    for (let i = 0; i < steps; i++) tick()
    const motions = commits.filter((c) => c.path === "program-motion" && c.verdict === "accept")
    return { commits, motions, tick, seated, rev0 }
}

// The recurrence, asserted as a property of consecutive accepted configurations: a child lies
// on the sphere about its PLACED parent, in the SAME side as its own accepted position.
function assertRecurrence(ids, before, after, radius) {
    for (let k = 1; k < ids.length; k++) {
        const centre = after[ids[k - 1]]
        const was = sub(before[ids[k]], centre), is = sub(after[ids[k]], centre)
        assert.ok(Math.abs(Math.hypot(...is) - radius) < 1e-6, `${ids[k]}: not on its sphere`)
        if (Math.hypot(...was) < 1e-9) continue                    // coincidence: the disclosed tie
        const cross = Math.hypot(was[0] * is[1] - was[1] * is[0], was[1] * is[2] - was[2] * is[1],
            was[2] * is[0] - was[0] * is[2]) / (Math.hypot(...was) * Math.hypot(...is))
        assert.ok(cross < 1e-6, `${ids[k]}: direction changed (|cross|=${cross})`)
        assert.ok(dot(was, is) > 0, `${ids[k]}: antipode, not the nearest accepted child`)
    }
}

test("an actor drives a three-joint spine through the default shell", () => {
    const ids = ["A", "B", "C"]
    const scheduler = buildWorld({})                            // nothing installed
    const host = scheduler.hotSwapChild("host", fork("host", spine(3)))
    const run = settle(scheduler, host, ids)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(run.motions.length, 3, "one commit per accepted actor command")
    for (const c of run.motions) c.bonds.forEach((d) => assert.ok(Math.abs(d - 5) < 1e-9, `bond ${d}`))
    // The FIRST move is a move too: the recurrence holds from the seated configuration onward.
    const seatedAt = Object.fromEntries(ids.map((id) => [id, run.seated[id].p]))
    assertRecurrence(ids, seatedAt, run.motions[0].at, 5)
    for (let i = 1; i < run.motions.length; i++)
        assertRecurrence(ids, run.motions[i - 1].at, run.motions[i].at, 5)
})

test("nine joints: the driven prefix moves, every length survives", () => {
    const ids = "ABCDEFGHI".split("")
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", spine(9)))
    const run = settle(scheduler, host, ids, { steps: 80 })
    assert.deepEqual(scheduler.errors, [])
    assert.equal(run.motions.length, 3)
    for (const c of run.motions) c.bonds.forEach((d) => assert.ok(Math.abs(d - 5) < 1e-9, `bond ${d}`))
    assert.notDeepEqual(run.motions.at(-1).at.A, [0, 0, 0], "the head actually walked")
})

test("the next command begins at the ACCEPTED pose, not at the request", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", spine(3)))
    let now = 0
    const attempts = []
    const tick = () => { now += 1000; scheduler.tick(now); scheduler.readouts?.drain?.() }
    for (let guard = 0; guard < 40 && !host.children.get("A"); guard++) tick()
    for (let i = 0; i < 60; i++) {
        tick()
        const a = scheduler.root._lastAttempt
        if (!a || a.path !== "program-motion") continue
        const key = JSON.stringify([a.from, a.candidate])
        if (!attempts.some((x) => x.key === key))
            attempts.push({ key, from: a.from, candidate: a.candidate, verdict: a.verdict })
    }
    const walking = attempts.filter((a) => a.verdict === "accept")
    assert.equal(walking.length, 3, "three accepted program motions")
    for (let i = 1; i < walking.length; i++) {
        const accepted = walking[i - 1].candidate, began = walking[i].from
        assert.ok(accepted && began, "both poses are recorded")
        assert.ok(dist(accepted, began) < 1e-9, `command ${i} began at ${began}, accepted was ${accepted}`)
    }
})

const TILTED = SE3.compose(
    { rotation: SE3.identity().rotation, position: [7, -3, 2] },
    { rotation: Versor.fromAxisAngle(AXIS_X, 15).multiply(Versor.fromAxisAngle(AXIS_Z, 22.5)),
        position: [0, 0, 0] })   // translated, tilted OUT OF PLANE, and yawed

test("translated, out-of-plane-tilted parent: requested heading survives, followers keep theirs", () => {
    const ids = ["A", "B", "C"]
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", spine(3), TILTED))
    const run = settle(scheduler, host, ids)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(run.motions.length, 3)

    // the authored turn is 30 degrees about the frame's own z, so the root's WORLD heading is
    // the parent's placement composed with exactly that turn
    const authored = SE3.compose(TILTED, SE3.rotateLocal(IDENT, AXIS_Z, -30)).rotation
    const headingNow = frameWorldTransform(host.children.get("A")).rotation
    const wished = authored.rotateVec(1, 0, 0), accepted = headingNow.rotateVec(1, 0, 0)
    assert.ok(dist(wished, accepted) < 1e-9,
        `the root's accepted world heading ${accepted} is not the requested ${wished}`)

    // the second jmp walks one unit along that accepted heading, in the parent's world frame
    const step = sub(run.motions[2].at.A, run.motions[1].at.A)
    const expected = headingNow.rotateVec(1, 0, 0)
    assert.ok(Math.abs(dot(unit(step), expected) - 1) < 1e-6, `the head stepped ${step}, not ${expected}`)

    // a follower's LOCAL heading is the one it was seated with: the position policy re-aims none
    for (const id of ["B", "C"])
        assert.ok(exactQ(host.children.get(id).transform.deref().rotation, run.seated[id].local),
            `${id}'s local heading changed`)
})

test("zero radius: the pair stays coincident and the bond is zero", () => {
    const ids = ["A", "B"]
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
let distance(A,B)=0
wait 1
as A do
  jmp 1
  wait 1/24
end
`))
    const run = settle(scheduler, host, ids)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(run.motions.length, 1)
    assert.ok(dist(worldOf(host.children.get("A")), worldOf(host.children.get("B"))) < 1e-9,
        "a zero bond is one position, never two")
})

// A singular request: the head lands exactly where its partner stands, so the direction must
// come from the pair's ACCEPTED bond, not from the declaring frame's axis.
const SINGULAR = `let A
rt -90
jmp 5
let B
let distance(A,B)=5
wait 1
as A do
  rt -90
  jmp 5
  wait 1/24
end
`

test("a coincident request keeps the ACCEPTED bond, not the declaring axis", () => {
    for (const [label, origin] of [["level", IDENT], ["tilted", TILTED]]) {
        const ids = ["A", "B"]
        const scheduler = buildWorld({})
        const host = scheduler.hotSwapChild("host", fork("host", SINGULAR, origin))
        const run = settle(scheduler, host, ids)
        assert.deepEqual(scheduler.errors, [], label)
        assert.equal(run.motions.length, 2, `${label}: the turn and the step`)
        const placed = run.motions.at(-1)
        const a = placed.at.A, b = placed.at.B
        assert.ok(Math.abs(dist(a, b) - 5) < 1e-9, `${label}: bond ${dist(a, b)}`)
        // the accepted bond ran along +y; the metric tie would have put B on the frame's x
        const bond = unit(sub(b, a))
        const axis = origin.rotation.rotateVec(1, 0, 0)
        assert.ok(Math.abs(dot(bond, axis)) < 1e-6, `${label}: B sits on the declaring axis ${bond}`)
        if (label === "level") assert.deepEqual(placed.at, { A: [0, 5, 0], B: [0, 10, 0] })
    }
})

test("a disconnected point is untouched by the actor's walk", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", spine(3) + "let D\n"))
    let now = 0
    const tick = () => { now += 1000; scheduler.tick(now); scheduler.readouts?.drain?.() }
    for (let guard = 0; guard < 40 && !host.children.get("D"); guard++) tick()
    const d0 = worldOf(host.children.get("D"))
    for (let i = 0; i < 60; i++) tick()
    assert.deepEqual(scheduler.errors, [])
    assert.ok(dist(d0, worldOf(host.children.get("D"))) < 1e-12, "the disconnected point did not move")
})

test("an installed responder owns even an empty answer: the default seat stays out", () => {
    // The responder accepts and names no component, so the ORIGINAL gate must refuse the step.
    // A built-in substitution here would silently take the answer away from its owner.
    const admit = ({ requested }) => ({ accepted: true, transform: requested, component: [] })
    const ids = ["A", "B"]
    const scheduler = buildWorld({ admit })
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
let distance(A,B)=5
wait 1
as A do
  jmp 1
  wait 1/24
end
`))
    const run = settle(scheduler, host, ids)
    const actorId = host.children.get("A").id
    assert.deepEqual(scheduler.errors, [])
    assert.equal(run.motions.filter((c) => c.owner === actorId).length, 0,
        "no commit: the gate refused the unaccompanied step")
    assert.notEqual(scheduler.root._lastAttempt.verdict, "accept", "the seat did not answer for the responder")
    assert.ok(dist(worldOf(host.children.get("A")), [0, 0, 0]) < 1e-12)
    assert.ok(dist(worldOf(host.children.get("B")), [5, 0, 0]) < 1e-12)
})

test("a pinned partner DECLINES: the gate keeps its say and nothing moves", () => {
    const ids = ["A", "B"]
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A=(0,0,0)
let B
let distance(A,B)=5
wait 1
as B do
  jmp 1
  wait 1/24
end
`))
    const run = settle(scheduler, host, ids)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(run.motions.length, 0)
    assert.ok(dist(worldOf(host.children.get("A")), [0, 0, 0]) < 1e-12, "the pin moved")
    assert.ok(dist(worldOf(host.children.get("B")), [5, 0, 0]) < 1e-12, "the walker moved")
})

test("a coordinate truth on a follower is CONDITIONED, not declined", () => {
    // The domain extended: a coordinate-axis row is not a full pin, so it conditions normal
    // movable placement instead of refusing the whole spine.
    const ids = ["A", "B", "C"]
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
jmp 5
let C
let distance(A,B)=5
let distance(B,C)=5
let C.y=2
wait 1
as A do
  jmp 1
  wait 1/24
end
`))
    const run = settle(scheduler, host, ids)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(scheduler.laws.active().length, 3, "the source installed every intended law")
    assert.equal(run.motions.length, 1, "the actor's step was answered")
    const c = worldOf(host.children.get("C"))
    assert.ok(Math.abs(c[1] - 2) < 1e-9, `C did not keep its coordinate truth: ${c}`)
    for (const [x, y] of [["A", "B"], ["B", "C"]])
        assert.ok(Math.abs(dist(worldOf(host.children.get(x)), worldOf(host.children.get(y))) - 5) < 1e-6,
            `${x}-${y} length drifted`)
})

test("a full pin is not made movable by a step the pin's tolerance would forgive", () => {
    // A 1e-7 step is inside the gate's tolerance, which must not become permission to nudge a
    // pinned member: eligibility (canMove) is separate from a row's measurement tolerance.
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
let B=(0,0,0)
let distance(A,B)=5
wait 1
as A do
  jmp 0.0000001
  wait 1/24
end
`))
    const run = settle(scheduler, host, ["A", "B"])
    const B = host.children.get("B")
    assert.deepEqual(r6ish(worldOf(B)), [0, 0, 0], "the pinned member did not move at all")
    void run
})

test("a unary distance to a POINT literal is answered by the sphere views", () => {
    // Point literal, not the vector form: |B-(0,10,0)| = sqrt(125) is lawful at B=(5,0,0), so the
    // actor's step to A=(0,3,0) must place B on sphere(AB=5) meeting sphere(|B-(0,10)|=sqrt125):
    // B.y = -9/14, B.x = sqrt(2299)/14, B.z = 0, and C then follows the conditioned B.
    const ids = ["A", "B", "C"]
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
jmp 5
let C
let distance(A,B)=5
let distance(B, (0,10,0)) = 11.180339887498949
let distance(B,C)=5
wait 1
as A do
  rt -90
  jmp 3
  wait 1/24
end
`))
    const run = settle(scheduler, host, ids)
    assert.equal(scheduler.laws.active().length, 3, "all three intended laws installed before the actor ran")
    assert.ok(run.motions.length >= 2, "the actor attempted and its step committed")
    const b = worldOf(host.children.get("B"))
    assert.ok(Math.abs(b[1] - (-9 / 14)) < 1e-6, `B.y = ${b[1]}`)
    assert.ok(Math.abs(b[0] - Math.sqrt(2299) / 14) < 1e-6, `B.x = ${b[0]}`)
    assert.ok(Math.abs(b[2]) < 1e-9, `B.z = ${b[2]}`)
    assert.ok(Math.abs(dist(worldOf(host.children.get("A")), b) - 5) < 1e-6, "AB holds")
    assert.ok(Math.abs(dist(worldOf(host.children.get("B")), worldOf(host.children.get("C"))) - 5) < 1e-6,
        "C follows the conditioned B")
})

test("two equal named-recipe supports ACCEPT, at the single-support pose", () => {
    const LINK = "def link a b r do\n  let distance(a,b)=r\nend"
    const build = (supports) => {
        const scheduler = buildWorld({})
        const host = scheduler.hotSwapChild("host", fork("host",
            `let A\njmp 5\nlet B\n${LINK}\n${supports}\nwait 1\nas A do\n  jmp 1\n  wait 1/24\nend\n`))
        const run = settle(scheduler, host, ["A", "B"])
        return { scheduler, host, run }
    }
    const single = build("let one = link A B 5")
    const double = build("let one = link A B 5\nlet two = link A B 5")
    assert.equal(single.scheduler.laws.active().length, 1)
    assert.equal(double.scheduler.laws.active().length, 2, "both supports are retained, with their owners")
    assert.equal(single.run.motions.length, 1)
    assert.equal(double.run.motions.length, 1, "a duplicate support is the same spine, not a refusal")
    for (const id of ["A", "B"])
        assert.ok(dist(single.run.motions[0].at[id], double.run.motions[0].at[id]) < 1e-9,
            `${id}: the duplicate support changed the pose`)
})

// --- M3b: lifecycle and safety, still authored programs only -------------------

const TWO_SPINES = (secondDriver) => `let A
jmp 40
let B
jmp 40
let C
jmp 40
let D
jmp 40
let E
jmp 40
let F
let distance(A,B)=40
let distance(B,C)=40
let distance(D,E)=40
let distance(E,F)=40
wait 1
as A do
  loop 4 do
    jmp 20
    wait 1/24
  end
end
${secondDriver}
`
const PAIRS = [["A", "B"], ["B", "C"], ["D", "E"], ["E", "F"]]
const DRIVE_D = `as D do
  loop 4 do
    rt 20
    jmp 20
    wait 1/24
  end
end`

test("two independent spines drive in the same world; neither is dragged by the other", () => {
    // Both drivers, concurrent: every commit satisfies all four bonds, and C-D is not a bond
    // at all, so the spines cannot be reading each other.
    const names = "ABCDEF".split("")
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", TWO_SPINES(DRIVE_D)))
    const run = settle(scheduler, host, names, { steps: 90 })
    assert.deepEqual(scheduler.errors, [])
    assert.ok(run.motions.length >= 8, `expected two driven spines, saw ${run.motions.length} motions`)
    for (const c of run.motions)
        for (const [x, y] of PAIRS)
            assert.ok(Math.abs(dist(c.at[x], c.at[y]) - 40) < 1e-6, `${x}-${y} = ${dist(c.at[x], c.at[y])}`)
    assert.ok(new Set(run.motions.map((c) => c.owner)).size >= 2, "two different writers drove")
    // the same world with ONE driver: the second spine never moves at all
    const alone = buildWorld({})
    const hostAlone = alone.hotSwapChild("host", fork("host", TWO_SPINES("")))
    const solo = settle(alone, hostAlone, names, { steps: 90 })
    assert.deepEqual(alone.errors, [])
    assert.ok(solo.motions.length >= 4, "the first spine was driven")
    for (const c of solo.motions)
        for (const id of ["D", "E", "F"])
            assert.ok(dist(c.at[id], solo.seated[id].p) < 1e-12, `${id} moved with no driver of its own`)
})

// A fine logical clock: 25 ms steps make a WAIT a measurable fact, not an assumed tick count.
function clock(scheduler, dt = 25) {
    let now = 0
    return { get now() { return now }, tick: () => { now += dt; scheduler.tick(now); scheduler.readouts?.drain?.() } }
}

test("a retired source cannot publish after a swap, while the actor is asleep", () => {
    const scheduler = buildWorld({})
    const c = clock(scheduler)
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
let distance(A,B)=5
wait 1
as A do
  jmp 1
  wait 2
  jmp 1
  wait 1/24
end
`))
    for (let i = 0; i < 400 && !host.children.get("B"); i++) c.tick()
    const A = host.children.get("A")
    const rev0 = scheduler.motionRevision
    for (let i = 0; i < 400 && scheduler.motionRevision === rev0; i++) c.tick()
    const firstStep = worldOf(A)
    assert.ok(dist(firstStep, [0, 0, 0]) > 1e-9, "the actor took its first step")
    // ASLEEP is a logical fact: the next resumption is in the future and nothing suspends it
    for (let i = 0; i < 400 && !(A.resumeAt > c.now); i++) c.tick()
    assert.ok(A.resumeAt > c.now, `the actor is asleep (resumeAt ${A.resumeAt} > now ${c.now})`)
    assert.equal(A.done, false, "an asleep frame is not done")
    assert.equal(A.suspension, null, "sleep holds no suspension: it is logical time")

    const oldName = "A"
    scheduler.hotSwapChild("host", fork("host", "let X\nlet Y\nlet distance(X,Y)=3\n"))
    const revAtSwap = scheduler.motionRevision
    for (let i = 0; i < 400; i++) c.tick()
    assert.deepEqual(scheduler.errors, [])
    assert.equal(scheduler.motionRevision, revAtSwap, "a retired source published after the swap")
    const live = [...scheduler.registry.values()]
    assert.ok(!live.some((f) => f.name === oldName), "the retired identity left the world")
    assert.ok(live.some((f) => f.name === "X") && live.some((f) => f.name === "Y"), "the new source seated")
    assert.ok(dist(worldOf(A), firstStep) < 1e-12, "the retired actor never advanced")
})

test("a law revised at the same address while the head is asleep is used on resumption", () => {
    const ids = ["A", "B", "C"]
    const scheduler = buildWorld({})
    const c = clock(scheduler)
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
jmp 5
let C
let distance(A,B)=5
let distance(B,C)=5
wait 1
as A do
  jmp 1
  wait 4
  jmp 1
  wait 1/24
end
loop 2 do
  wait 1
  let distance(B,C) = 5 + count*2
end
`))
    for (let i = 0; i < 400 && !ids.every((id) => host.children.get(id)); i++) c.tick()
    const A = host.children.get("A"), B = host.children.get("B"), C = host.children.get("C")
    // the head takes its FIRST step, then sleeps for four logical seconds
    const rev0 = scheduler.motionRevision
    for (let i = 0; i < 400 && scheduler.motionRevision === rev0; i++) c.tick()
    const firstStep = worldOf(A)
    assert.ok(dist(firstStep, [0, 0, 0]) > 1e-9, "the head took its first step")
    for (let i = 0; i < 400 && !(A.resumeAt > c.now); i++) c.tick()
    assert.ok(A.resumeAt > c.now, "the head is asleep")

    // the same address is revised WHILE the head sleeps: 5 -> 7
    const radii = () => scheduler.laws.active().filter((l) => l.feature === "distance")
        .map((l) => l.predicate).sort((x, y) => x - y)
    for (let i = 0; i < 400 && !radii().includes(7); i++) c.tick()
    assert.deepEqual(radii(), [5, 7], "one address, revised")
    assert.ok(A.resumeAt > c.now, "the radius changed while the head was still asleep")
    assert.ok(dist(worldOf(A), firstStep) < 1e-12, "and the head had not resumed yet")

    // the NEXT request sees the new radius, keeps the identities, and recaptures C
    const revBefore = scheduler.motionRevision
    for (let i = 0; i < 800 && scheduler.motionRevision === revBefore; i++) c.tick()
    assert.deepEqual(scheduler.errors, [])
    assert.ok(dist(worldOf(A), firstStep) > 1e-9, "the head resumed after the revision")
    assert.ok(Math.abs(dist(worldOf(A), worldOf(B)) - 5) < 1e-9, "AB kept its 5")
    assert.ok(Math.abs(dist(worldOf(B), worldOf(C)) - 7) < 1e-9, "BC adopted the revised 7")
    assert.equal(host.children.get("C"), C, "the captured C is the same identity")
})

test("the independent validator ceiling sees the EXPANDED candidate, once", () => {
    // The writer alone is permitted; any other member is not. Exactly ONE callback must see
    // [A, B] — a ceiling asked before the policy expands would see [A] only and let a
    // follow-on move publish uncertified geometry. (id:laws-free-relations-n-node-review)
    const calls = []
    const scheduler = buildWorld({ validate: ({ entries, writer }) => {
        calls.push(entries.map((e) => e.frame.name))
        return entries.every((e) => e.frame === writer)
    } })
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
let distance(A,B)=5
wait 1
as A do
  jmp 1
  wait 1/24
end
`))
    const c = clock(scheduler)
    for (let i = 0; i < 400 && !host.children.get("B"); i++) c.tick()
    const A = host.children.get("A"), B = host.children.get("B")
    const a0 = worldOf(A), b0 = worldOf(B)
    const rev0 = scheduler.motionRevision
    for (let i = 0; i < 400; i++) c.tick()
    assert.deepEqual(calls, [["A", "B"]], "the ceiling saw the writer and the member it carried, once")
    assert.equal(scheduler.motionRevision, rev0, "a refused candidate published geometry")
    assert.ok(dist(worldOf(A), a0) < 1e-12 && dist(worldOf(B), b0) < 1e-12, "nothing moved")
    assert.ok(scheduler.errors.some((e) => /fails independent validation/i.test(e.message ?? "")),
        "the ceiling's refusal is named")
})

test("a program step is recorded as program motion, not as a hand gesture", () => {
    const ids = ["A", "B"]
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
let distance(A,B)=5
wait 1
as A do
  jmp 1
  wait 1/24
end
`))
    const run = settle(scheduler, host, ids)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(run.motions.length, 1)
    const attempt = scheduler.root._lastAttempt
    assert.equal(attempt.path, "program-motion", "the actor's own instant is named as such")
    assert.equal(attempt.command, "jmp", "the command is the author's, not a synthesised gesture")
})

// --- M6: the exact user source and its companions, graduated from scratch ---------------

const PLANAR17 = `def spine links spacing do
  loop links+1 do
    let "J[count]"
    let "J[count]".z=0
    jmp 0-spacing
  end
  loop links do
    let distance("J[count]", "J[count+1]") = spacing
  end
end
spine 8 50
as "J0" do
  loop 100 do
    jmp 8
    rt 8
    wait 1/24
  end
end
`
const PLANAR_NOZ = PLANAR17.replace('    let "J[count]".z=0\n', '')

// The ordered movement commits of the user's source: the watcher is registered BEFORE the
// source is seated (a synchronous first step otherwise escapes it), the writer is resolved
// through the registry, and every channel is drained each tick.
function planar(source, ticks = 400) {
    let now = 0
    const scheduler = buildWorld({})
    const commits = []
    let lastRev = -1
    scheduler.onAcceptedChange(() => {
        const a = scheduler.root._lastAttempt
        if (!a || a.path !== "program-motion" || a.verdict !== "accept" || a.command !== "jmp") return
        const rev = scheduler.motionRevision
        if (rev === lastRev) return
        lastRev = rev
        const writer = scheduler.registry.get(a.owner)
        if (!writer || writer.name !== "J0") return
        commits.push([...writer.parent.children.entries()].map(([n, f]) => [n, r6ish(worldOf(f))]))
    })
    const host = scheduler.hotSwapChild("host", fork("host", source))
    for (let i = 0; i < ticks; i++) {
        now += 50
        scheduler.tick(now)
        scheduler.readouts?.drain?.()
        for (const f of scheduler.registry.values()) f.channel?.drain?.()
    }
    return { scheduler, host, commits }
}

test("the exact 17-law source walks, and the noZ control takes the SAME ordered steps", () => {
    const z = planar(PLANAR17)
    assert.deepEqual(z.scheduler.errors, [])
    const laws = z.scheduler.laws.active()
    assert.equal(laws.filter((l) => l.feature === "coordinate").length, 9, "nine coordinate laws stayed installed")
    assert.equal(laws.filter((l) => l.feature === "distance").length, 8, "eight distance laws stayed installed")
    const ids = "J0,J1,J2,J3,J4,J5,J6,J7,J8".split(",")
    const head = worldOf(z.host.children.get("J0"))
    assert.ok(dist(head, [0, 0, 0]) > 1, `the head actually translated (${head})`)
    for (const n of ids) assert.ok(Math.abs(worldOf(z.host.children.get(n))[2]) < 1e-9, `${n} left the plane`)
    for (const law of laws.filter((l) => l.feature === "distance")) {
        const [a, b] = law.endpoints.map((id) => worldOf(z.scheduler.registry.get(id)))
        assert.ok(Math.abs(dist(a, b) - law.predicate) < 1e-6, `length drifted to ${dist(a, b)}`)
    }

    const plain = planar(PLANAR_NOZ)
    assert.deepEqual(plain.scheduler.errors, [])
    assert.equal(z.commits.length, 100, `the Z run's accepted jmp steps: ${z.commits.length}`)
    assert.equal(plain.commits.length, z.commits.length, "the control takes the same number of steps")
    assert.deepEqual(z.commits, plain.commits, "every joint's position at every accepted step")

    const first = Object.fromEntries(z.commits[0])
    const last = Object.fromEntries(z.commits.at(-1))
    assert.ok(dist(first.J0, [8, 0, 0]) < 1e-9, `first step ${first.J0}`)
    assert.ok(dist(last.J0, [59.63903530073217, -43.33029547519493, 0]) < 1e-6, `last step ${last.J0}`)
})

test("the stronger constrained case: root A(0,3) with B.y=0 gives B[4,0,0], C[9,0,0]", () => {
    const ids = ["A", "B", "C"]
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
jmp 5
let C
let distance(A,B)=5
let distance(B,C)=5
let B.y=0
as A do
  rt -90
  jmp 3
  wait 1/24
end
`))
    const run = settle(scheduler, host, ids)
    assert.deepEqual(scheduler.errors, [])
    assert.equal(scheduler.laws.active().length, 3, "all three intended laws installed")
    assert.ok(run.motions.length >= 1, "the actor ran")
    assert.ok(dist(worldOf(host.children.get("A")), [0, 3, 0]) < 1e-9, "the root took its given pose")
    assert.ok(dist(worldOf(host.children.get("B")), [4, 0, 0]) < 1e-9, "B met both the sphere and the plane")
    assert.ok(dist(worldOf(host.children.get("C")), [9, 0, 0]) < 1e-9, "C followed the conditioned B")
})



test("a constrained singular tie keeps the +x accepted bond, not the circle's +y basis", () => {
    // A[0,0,0], B[5,0,0], both z=0, root jmp 5 lands exactly on the old B. The accepted bond is
    // +x, so the conditioned answer is B[10,0,0]; a fallback that re-picks a basis on the z=0
    // circle would choose +y and land B[5,5,0]. This is the discriminating case S1 was not.
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
let A.z=0
let B.z=0
let distance(A,B)=5
as A do
  jmp 5
  wait 1/24
end
`))
    const run = settle(scheduler, host, ["A", "B"])
    assert.deepEqual(scheduler.errors, [])
    assert.equal(scheduler.laws.active().length, 3, "two coordinate rows and one distance")
    assert.ok(dist(worldOf(host.children.get("A")), [5, 0, 0]) < 1e-9, "the root took its given pose")
    assert.ok(dist(worldOf(host.children.get("B")), [10, 0, 0]) < 1e-6,
        `B landed at ${worldOf(host.children.get("B"))}: the accepted +x bond was not kept`)
    assert.ok(Math.abs(worldOf(host.children.get("B"))[1] - 5) > 1, "not the circle's +y basis")
    void run
})

test("a world-z row on the ROOT stays refused: the given pose is never projected", () => {
    const scheduler = buildWorld({})
    const origin = SE3.compose({ rotation: SE3.identity().rotation, position: [0, 0, 0] },
        { rotation: Versor.fromAxisAngle(AXIS_Y, 15), position: [0, 0, 0] })
    const host = scheduler.hotSwapChild("host", fork("host", `let A
let A.z=0
as A do
  jmp 3
  wait 1/24
end
`, origin))
    const run = settle(scheduler, host, ["A"])
    const attempt = scheduler.root._lastAttempt
    assert.equal(attempt.gate.status, "violation", "the gate refused")
    // `gate.law` is an ADDRESS, not a law object: resolve it in the active store.
    const cited = String(attempt.gate.law)
    const law = scheduler.laws.active().find((l) => String(l.address) === cited)
    assert.ok(law, `the citation resolves to an active law (${cited})`)
    assert.equal(law.feature, "coordinate", "a coordinate row refused the root's wish")
    assert.ok(Math.abs(attempt.gate.residual) > 1e-6, "and it reports a real residual")
    assert.ok(dist(worldOf(host.children.get("A")), [0, 0, 0]) < 1e-12, "the root did not move")
    assert.equal(run.motions.length, 0)
})

// --- M6 typed bound-row fixtures: INTERPRETATION of a valid bound term, not authoring ------
// Births first, then the base laws, then a long sleep; the extra row is injected while the
// actor sleeps, so nothing here claims in-body declaration admission.

function seatedThenInjected({ source, required, extra, ticks = 1000 }) {
    let now = 0
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const tick = () => {
        now += 25
        scheduler.tick(now)
        scheduler.readouts?.drain?.()
        for (const f of scheduler.registry.values()) f.channel?.drain?.()
    }
    for (let i = 0; i < 200; i++) {
        tick()
        const ready = required.every((n) => host.children.get(n))
        if (ready && scheduler.laws.active().length >= 1) break
    }
    for (const n of required) assert.ok(host.children.get(n), `${n} was seated`)
    scheduler.laws.apply(extra(host, scheduler))
    // the injected row must be lawful BEFORE the actor is asked anything
    assert.equal(lawViolation(scheduler.laws.active(), null, scheduler.registry, lawWorld).status, "valid",
        "the injected bound row is lawful at injection")
    for (let i = 0; i < ticks; i++) tick()
    return { scheduler, host }
}

test("a relative bound row reads the root's ROTATED pose (case 1)", () => {
    const { scheduler, host } = seatedThenInjected({
        source: `let A
jmp 5
let B
let distance(A,B)=5
wait 10
as A do
 rt 90
 wait 1/24
end
`,
        required: ["A", "B"],
        extra: (host) => {
            const A = host.children.get("A"), B = host.children.get("B")
            return bindLaw({ feature: "distance", endpoints: [B.id], scope: host.id, frame: host.id, predicate: 3,
                expression: makeDistanceTerm([B.id, { frame: A.id, value: [2, 0, 0], relative: true }], 3),
                owner: { line: 99 } })
        },
    })
    assert.deepEqual(scheduler.errors, [])
    assert.equal(scheduler.laws.active().length, 2, "the base law and the injected row")
    const A = host.children.get("A"), B = host.children.get("B")
    assert.ok(dist(worldOf(A), [0, 0, 0]) < 1e-9, "the root did not translate")
    assert.ok(dist(worldOf(B), [0, -5, 0]) < 1e-6, `B landed at ${worldOf(B)}, not the tangent point`)
    assert.equal(scheduler.root._lastAttempt.gate.status, "valid")
    assert.ok(Math.abs(worldOf(B)[1] - 5) > 1, "the +y circle basis did not answer")
})

test("a bound row relative to a future child is DEFERRED, not frozen (case 2)", () => {
    const source = `let A
jmp 5
let B
jmp 5
let C
let distance(A,B)=5
let distance(B,C)=5
wait 10
as A do
 rt -90
 jmp 3
 wait 1/24
end
`
    const row = (relative) => (host) => {
        const C = host.children.get("C")
        return bindLaw({ feature: "distance", endpoints: [host.children.get("B").id], scope: host.id, frame: host.id, predicate: 5,
            expression: makeDistanceTerm([host.children.get("B").id,
                { frame: C.id, value: [0, 0, 0], relative }], 5), owner: { line: 99 } })
    }
    const relative = seatedThenInjected({ source, required: ["A", "B", "C"], extra: row(true) })
    assert.deepEqual(relative.scheduler.errors, [])
    assert.equal(relative.scheduler.laws.active().length, 3, "base pair laws plus the relative row")
    const at = (h, n) => worldOf(h.children.get(n))
    assert.ok(dist(at(relative.host, "A"), [0, 3, 0]) < 1e-6, `A ${at(relative.host, "A")}`)
    assert.ok(dist(at(relative.host, "B"), [4.28746462856, 0.42752122286, 0]) < 1e-6, `B ${at(relative.host, "B")}`)
    assert.ok(dist(at(relative.host, "C"), [9.27352093277, 0.05436906715, 0]) < 1e-6, `C ${at(relative.host, "C")}`)
    assert.equal(relative.scheduler.root._lastAttempt.gate.status, "valid")

    // the placement twin is a FIXED birth centre, so the same root wish must be refused
    const placed = seatedThenInjected({ source, required: ["A", "B", "C"], extra: row(false) })
    assert.deepEqual(placed.scheduler.errors, [])
    assert.equal(placed.scheduler.laws.active().length, 3)
    assert.equal(placed.scheduler.root._lastAttempt.gate.status, "violation", "a placement read refused the wish")
    assert.ok(dist(at(placed.host, "A"), [0, 0, 0]) < 1e-6, "nothing moved")
    assert.ok(dist(at(placed.host, "B"), [5, 0, 0]) < 1e-6)
    assert.ok(dist(at(placed.host, "C"), [10, 0, 0]) < 1e-6)
})

test("independent conditioned branches compose regardless of traversal order", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", `let A
jmp 5
let B
jmp -5
rt -90
jmp 5
let C
let distance(A,B)=5
let distance(A,C)=5
let B.y=0
let C.x=0
`))
    settle(scheduler, host, ["A", "B", "C"])
    assert.deepEqual(scheduler.errors, [])
    const laws = scheduler.laws.active()
    assert.equal(laws.length, 4)
    const A = host.children.get("A")
    const offered = { kind: "accept", pose: { ...A.transform.deref(), position: [0, 3, 0] }, component: [] }
    const before = ["A", "B", "C"].map((name) => worldOf(host.children.get(name)))
    const propose = (order) => programFollowing(offered, A, scheduler.registry, { active: () => order }, lawWorld)
    const forward = propose(laws), reverse = propose([...laws].reverse())
    for (const answer of [forward, reverse]) {
        assert.ok(answer)
        assert.strictEqual(answer.pose, offered.pose, "the root is given, not projected")
        const poses = new Map([[A, answer.pose], ...answer.component.map(({ frame, pose }) => [frame, pose])])
        assert.equal(lawViolation(laws, poses, scheduler.registry, lawWorld).status, "valid")
        for (const [name, expected] of [["B", [4, 0, 0]], ["C", [0, 8, 0]]]) {
            const at = lawWorld.read(host.children.get(name), poses).position
            assert.ok(dist(at, expected) < 1e-9, `${name}: ${at}`)
        }
    }
    assert.deepEqual(forward.component.map(({ frame }) => frame.name), ["B", "C"])
    assert.deepEqual(reverse.component.map(({ frame }) => frame.name), ["C", "B"], "the traversal really changed")
    assert.deepEqual(offered.component, [], "the retained raw offer stays reusable")
    assert.deepEqual(["A", "B", "C"].map((name) => worldOf(host.children.get(name))), before,
        "neither private proposal publishes")
})
