// A live offer is adopted as data, then realized through the default source authority
// and original gate. Refusal keeps the offer dormant and accepted geometry standing.
// (id:laws-construction-input)
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, worldOf } from "./harness.mjs"
import { toLocalPoint } from "../../../assets/js/turtling/localize.js"
import { worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const SRC = "goto 5 0\nlet p"
const seat = (options = {}) => {
    const s = buildWorld(options)
    const host = s.hotSwapChild("host", fork("host", SRC))
    drive(s)
    return { s, host, p: host.children.get("p") }
}
const capsule = (by) => ({
    v: 1,
    inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by } }],
})
const empty = () => ({ v: 1, inputs: [] })
const hand = (x) => ({ names: ["p"], action: { kind: "translation", by: [0, x, 0] } })
const near = (a, b) => assert.deepEqual(a.map((v) => +v.toFixed(6)), b)

test("a choice-only offer moves a settled ordinary point without a source run", () => {
    const { s, host, p } = seat()
    const before = s.motionRevision
    assert.equal(s.offerChoices(host, capsule([0, 3, 0])).kind, "accept")
    near(worldOf(p), [5, 3, 0])
    assert.equal(s.motionRevision, before + 1, "one publication, one revision")
    assert.deepEqual(s.handChoices(host), [hand(3)])
    assert.ok(p.handBase, "the source baseline is retained")
})

test("an identical offer neither republishes nor double-applies", () => {
    const { s, host, p } = seat()
    s.offerChoices(host, capsule([0, 3, 0]))
    const revision = s.motionRevision
    assert.deepEqual(s.offerChoices(host, capsule([0, 3, 0])), { kind: "unchanged" })
    near(worldOf(p), [5, 3, 0], "no second +3")
    assert.equal(s.motionRevision, revision, "no new publication")
})

test("an ordinary accepted identity is a local choice, never an inherited reveal", () => {
    const { s, host, p } = seat()
    s.offerChoices(host, capsule([0, 3, 0]))
    // ref-null local motion back to the source baseline; NOT reset intent.
    assert.equal(s.requestMotion(p, s.handHome(p), s.motionRevision).kind, "accept")
    near(worldOf(p), [5, 0, 0])
    const revision = s.motionRevision

    assert.deepEqual(s.offerChoices(host, capsule([0, 6, 0])), { kind: "unchanged" })
    near(worldOf(p), [5, 0, 0], "the identity choice masks the replacement")
    assert.equal(s.motionRevision, revision)
    assert.deepEqual(s.handChoices(host), [])

    const next = s.hotSwapChild("host", fork("host", SRC), { fresh: true })
    drive(s)
    near(worldOf(next.children.get("p")), [5, 0, 0], "a rerun does not reveal the old offer")
})

test("a nested frame is not a seat: its route cannot alias the top participant", () => {
    const src = "let p\nas A do\n  let p\nend"
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", src))
    drive(s)
    const top = host.children.get("p"), A = host.children.get("A"), nested = A.children.get("p")
    near(worldOf(top), [0, 0, 0])
    near(worldOf(nested), [0, 0, 0])

    assert.equal(s.offerChoices(A, capsule([2, 0, 0])).kind, "unsupported")
    assert.equal(s.offerChoices(host, capsule([2, 0, 0])).kind, "accept")
    near(worldOf(top), [2, 0, 0])
    near(worldOf(nested), [0, 0, 0], "the nested same-name point is untouched")

    const next = s.hotSwapChild("host", fork("host", src), { fresh: true })
    drive(s)
    near(worldOf(next.children.get("p")), [2, 0, 0], "the top point keeps its choice")
    near(worldOf(next.children.get("A").children.get("p")), [0, 0, 0], "the alias remains impossible")
})

test("an incompatible family is adopted but reported uninterpreted, not silently applied", () => {
    const { s, host, p } = seat()
    const verdict = s.offerChoices(host, {
        v: 1,
        inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "sphere", rotation: { w: 1, x: 0, y: 0, z: 0 } } }],
    })
    assert.equal(verdict.kind, "accept")
    assert.equal(verdict.outcomes[0].interpreted, false)
    assert.equal(verdict.outcomes[0].reason, "family")
    near(worldOf(p), [5, 0, 0], "the accepted geometry is the source baseline")
    assert.equal(s.handChoices(host)[0].action.kind, "sphere", "the offered value is retained")
})

test("a gate-refused offer is retained dormant; an identical resend is unchanged", () => {
    const S = 1e11
    const src = `let B=(${S}, ${S}, 0)\njmp 5\nlet a\nlet a.z = 0\nlet distance(a,B)=5`
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", src, { rotation: SE3.identity().rotation, position: [S, S, 0] }))
    drive(s)
    const a = host.children.get("a")
    near(worldOf(a), [S + 5, S, 0])
    const revision = s.motionRevision
    const circle = {
        v: 1,
        inputs: [{
            route: { root: "document", names: ["a"] },
            action: { kind: "circle", phaseVector: [0, 0, Math.PI / 4] },
        }],
    }

    const refused = s.offerChoices(host, circle)
    assert.equal(refused.kind, "refuse")
    assert.equal(refused.retained, true)
    assert.equal(refused.outcomes[0].kind, "circle")
    near(worldOf(a), [S + 5, S, 0], "the accepted geometry stands")
    assert.equal(s.motionRevision, revision, "a refusal publishes no geometry")
    assert.equal(s.handChoices(host)[0].action.kind, "circle", "the offered value stays")

    const again = s.offerChoices(host, circle)
    assert.equal(again.kind, "unchanged", "a resend is a non-attempt, not a second accept")
    near(worldOf(a), [S + 5, S, 0])
    assert.equal(s.motionRevision, revision)
})

test("an untouched offer replaces per slot; explicit empty restores the source baseline", () => {
    const { s, host, p } = seat()
    s.offerChoices(host, capsule([0, 3, 0]))
    s.offerChoices(host, capsule([0, 5, 0]))
    near(worldOf(p), [5, 5, 0], "replacement, not 3+5")

    assert.equal(s.offerChoices(host, empty()).kind, "accept")
    near(worldOf(p), [5, 0, 0], "the former offer is restored to its baseline")
    assert.equal(p.handBase, null)
    assert.deepEqual(s.handChoices(host), [])
})

test("a local gesture wins and is erased neither by an offer nor by an empty offer", () => {
    const { s, host, p } = seat()
    s.offerChoices(host, capsule([0, 3, 0]))
    const local = toLocalPoint(worldTransform(p), [5, 4, 0])
    assert.equal(s.requestMotion(p, { ...p.transform.deref(), position: local }, s.motionRevision).kind, "accept")
    near(worldOf(p), [5, 4, 0])

    const revision = s.motionRevision
    s.offerChoices(host, capsule([0, 6, 0]))
    near(worldOf(p), [5, 4, 0], "the local choice wins")
    assert.equal(s.motionRevision, revision, "an unused offered change is not published")
    assert.deepEqual(s.handChoices(host), [hand(4)])

    s.offerChoices(host, empty())
    near(worldOf(p), [5, 4, 0], "clearing the offered layer does not erase the local choice")
    assert.deepEqual(s.handChoices(host), [hand(4)])
})

test("a local reset mask hides replacement offers without being erased", () => {
    const { s, host, p } = seat()
    s.offerChoices(host, capsule([0, 3, 0]))
    assert.equal(s.requestMotion(p, s.handHome(p), s.motionRevision, null, { reset: true }).kind, "accept")
    near(worldOf(p), [5, 0, 0])
    const revision = s.motionRevision

    s.offerChoices(host, capsule([0, 6, 0]))
    near(worldOf(p), [5, 0, 0], "the mask suppresses the new offer")
    assert.equal(s.motionRevision, revision)
    assert.deepEqual(s.handChoices(host), [])
})

test("malformed, missing and unsupported offers admit nothing", () => {
    const { s, host, p } = seat()
    s.offerChoices(host, capsule([0, 3, 0]))
    const revision = s.motionRevision

    assert.equal(s.offerChoices(host, null).kind, "unsupported", "legacy null is not an empty offer")
    assert.equal(s.offerChoices(host, { v: 1, inputs: [{ route: { root: "document", names: ["p"] }, action: null }] }).kind,
        "unsupported")
    assert.equal(s.offerChoices(host, { v: 1, inputs: [{ route: { root: { cell: "1.2.spiral" }, names: ["p"] }, action: { kind: "translation", by: [0, 9, 0] } }] }).kind,
        "unsupported")
    assert.equal(s.offerChoices(host, { v: 1, inputs: [{ route: { root: "document", names: ["nope"] }, action: { kind: "translation", by: [0, 9, 0] } }] }).kind,
        "unresolved")

    near(worldOf(p), [5, 3, 0], "the accepted offer stands")
    assert.equal(s.motionRevision, revision, "no mutation on an inadmissible offer")
    assert.deepEqual(s.handChoices(host), [hand(3)])
})

test("a custom motion responder owns its question; import does not bypass it", () => {
    const s = buildWorld({ admit: () => ({ accepted: true, transform: { rotation: null, position: [0, 0, 0] } }) })
    const host = s.hotSwapChild("host", fork("host", "let p"))
    drive(s)
    const verdict = s.offerChoices(host, capsule([0, 3, 0]))
    assert.equal(verdict.kind, "unsupported")
    near(worldOf(host.children.get("p")), [0, 0, 0], "no synthetic admission")
    assert.deepEqual(s.handChoices(host), [])
})

test("an unsettled seat is busy before the offered layer is touched", () => {
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", "goto 5 0\nlet p\nwait 10"))
    // Do not drive: the seat is still running.
    const verdict = s.offerChoices(host, capsule([0, 3, 0]))
    assert.equal(verdict.kind, "busy")
    assert.deepEqual(s.handChoices(host), [])
})

test("a host motion validator is not bypassed by import", () => {
    const s = buildWorld({ validate: () => false })
    const host = s.hotSwapChild("host", fork("host", "let p"))
    drive(s)
    assert.equal(s.offerChoices(host, capsule([0, 3, 0])).kind, "unsupported")
    assert.deepEqual(s.handChoices(host), [])
})

test("a pre-seat offer restores source+choice on a fresh seat and survives reruns", () => {
    const s = buildWorld()
    assert.deepEqual(s.offerAt("host", capsule([0, 3, 0])), { kind: "accept" })

    let host = s.hotSwapChild("host", fork("host", SRC))
    drive(s)
    near(worldOf(host.children.get("p")), [5, 3, 0], "birth applies the offered adjustment")
    assert.deepEqual(s.handChoices(host), [hand(3)])

    host = s.hotSwapChild("host", fork("host", SRC), { fresh: true })
    drive(s)
    near(worldOf(host.children.get("p")), [5, 3, 0], "same source keeps the choice")

    host = s.hotSwapChild("host", fork("host", "goto 10 0\nlet p"), { fresh: true })
    drive(s)
    near(worldOf(host.children.get("p")), [10, 3, 0], "a new baseline keeps the adjustment")
})

test("legacy/no choices clear the pre-seat offer; malformed ones leave it standing", () => {
    const s = buildWorld()
    s.offerAt("host", capsule([0, 3, 0]))
    assert.equal(s.offerAt("host", { v: 1, inputs: [{ route: { root: "document", names: ["p"] }, action: null }] }).kind,
        "unsupported")
    let host = s.hotSwapChild("host", fork("host", SRC))
    drive(s)
    near(worldOf(host.children.get("p")), [5, 3, 0], "the malformed replacement admitted nothing")

    assert.deepEqual(s.offerAt("host", null), { kind: "accept" })
    host = s.hotSwapChild("host", fork("host", SRC), { fresh: true })
    drive(s)
    near(worldOf(host.children.get("p")), [5, 0, 0], "no choices is the source baseline")
    assert.deepEqual(s.handChoices(host), [])
})

test("a local accepted input notifies its seat once; offered news does not echo", () => {
    const localSeen = []
    const local = seat({ onHandInput: (slot) => localSeen.push(slot) })
    const desired = toLocalPoint(worldTransform(local.p), [5, 4, 0])
    assert.equal(local.s.requestMotion(local.p, { ...local.p.transform.deref(), position: desired }, local.s.motionRevision).kind, "accept")
    assert.equal(localSeen.length, 1, "one accepted local choice, one notification")
    assert.equal(localSeen[0], "host", "the callback speaks the top seat key, not private map JSON")

    local.s.offerChoices(local.host, capsule([0, 6, 0]))
    assert.equal(localSeen.length, 1, "an offered update is not relabelled local")

    const remoteSeen = []
    const remote = seat({ onHandInput: (slot) => remoteSeen.push(slot) })
    remote.s.offerChoices(remote.host, capsule([0, 3, 0]))
    assert.equal(remoteSeen.length, 0, "offered realization alone is not a local gesture")
})

test("a green same-seed upsert reconciles changed choices without reseating", () => {
    const s = buildWorld()
    const spec = fork("host", SRC)
    s.offerAt("host", capsule([0, 3, 0]))
    const host = s.hotSwapChild("host", spec)
    drive(s)
    const p = host.children.get("p")
    near(worldOf(p), [5, 3, 0])
    const id = host.id, run = host.run, incarnation = host.runIncarnation
    const pointId = p.id, pointRun = p.run, pointIncarnation = p.runIncarnation
    const revision = s.motionRevision

    // The same AST object is the green-tree seed; only the offer changed.
    const again = s.hotSwapChild("host", spec, { choices: capsule([0, 6, 0]) })
    assert.equal(again, host, "the seed held: same frame, clock and ink")
    assert.equal(again.id, id)
    assert.equal(again.run, run, "no new execution run")
    assert.equal(again.runIncarnation, incarnation, "no new incarnation")
    assert.equal(p.id, pointId, "the point identity held")
    assert.equal(p.run, pointRun, "the point run held")
    assert.equal(p.runIncarnation, pointIncarnation, "the point incarnation held")
    near(worldOf(p), [5, 6, 0], "the held frame reconciled the new offer")
    assert.equal(s.motionRevision, revision + 1, "exactly one publication")
})

test("a fresh hotSwapChild admits a choices capsule without preinstall", () => {
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", SRC), { choices: capsule([0, 3, 0]) })
    drive(s)
    near(worldOf(host.children.get("p")), [5, 3, 0])
    assert.deepEqual(s.handChoices(host), [hand(3)])
})

test("a new source with different choices replaces stale pre-seat A", () => {
    const s = buildWorld()
    s.offerAt("host", capsule([0, 3, 0]))
    let host = s.hotSwapChild("host", fork("host", SRC))
    drive(s)
    near(worldOf(host.children.get("p")), [5, 3, 0])

    host = s.hotSwapChild("host", fork("host", "goto 10 0\nlet p"), { choices: capsule([0, 6, 0]) })
    drive(s)
    near(worldOf(host.children.get("p")), [10, 6, 0], "B, not the stale A")
    assert.deepEqual(s.handChoices(host), [hand(6)])
})

test("a cell-root capsule is not materialized by the scheduler", () => {
    const cell = (y) => ({
        v: 1,
        inputs: [{ route: { root: { cell: "foreign" }, names: ["p"] }, action: { kind: "translation", by: [0, y, 0] } }],
    })
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", SRC))
    drive(s)
    const p = host.children.get("p")
    near(worldOf(p), [5, 0, 0])

    const rejected = s.hotSwapChild("host", fork("host", "goto 10 0\nlet p"), { choices: cell(6) })
    assert.equal(rejected, host, "the standing source is not retired")
    near(worldOf(p), [5, 0, 0], "no top-p alias")
    assert.deepEqual(s.handChoices(host), [])

    const empty = buildWorld()
    assert.equal(empty.hotSwapChild("host", fork("host", SRC), { choices: cell(6) }), null)
    assert.equal(empty.root.children.size, 0, "a rejected cell capsule creates no child")
})
