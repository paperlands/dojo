// Driven-law lifecycle: installation identity, canonical retirement, target lifetime.
// (id:laws-dependency-driven-place, id:laws-ordered-replacement)
//
// Three defects the review reproduced against the generic driven path:
//   1. stale work — a queued move whose installation was superseded still published,
//      because the guard compared an owner SPAN, which a loop revisit leaves unchanged;
//   2. retirement by NAME — driver keys used target names, so an equivalent spelling of
//      the same bound identity left the old producer behind;
//   3. orphan driver — removing a target retracted its law but kept the driver, which is
//      owned by a declaring scope that survives the target.
//
// REOPEN when a driver can be installed outside the accepted-publication boundary, when a
// driver key is not the canonical address, or when a target leaving the play keeps a
// producer association.
//
// Run: node --test test/js/laws/driven_lifecycle_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, nz } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { addressOf } from "../../../assets/js/turtling/laws/replacement.js"

const accept = ({ requested }) => ({ accepted: true, transform: requested })
const pos = (f) => nz(frameWorldTransform(f).position)

// 1. Installation identity: a queued move from a superseded installation must not publish.
test("a superseded installation's queued move does not publish", () => {
    const scheduler = buildWorld({ admit: accept })
    const host = scheduler.hotSwapChild("host", fork("host", "let B\nlet A = (B.x, 100)"))
    drive(scheduler)
    const A = host.children.get("A")
    const B = host.children.get("B")
    assert.deepEqual(pos(A), [0, 100, 0], "A starts on B.x = 0")
    scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [7, 0, 0] },
        scheduler.motionRevision)
    assert.equal(scheduler.root._derivedMoves.length, 1, "a move is pending for the live driver")
    const move = scheduler.root._derivedMoves[0]
    assert.equal(move.spec.source, host.id, "the move names its installation's source")
    assert.equal(move.spec.key, addressOf(scheduler.laws.active().find((l) => l.feature === "position")),
        "and its installation's address")
    // A revisit re-registers the SAME site and address: a FRESH descriptor object.
    scheduler.readouts.register(host.id, move.spec.key, () => [7, 100, 0],
        { kind: "place", source: host.id, spec: { ...move.spec } })
    drive(scheduler)
    assert.deepEqual(pos(A), [0, 100, 0],
        "the stale move is dropped: its installation is no longer the current one")
})

// 2. Canonical address: the driver's retirement identity is the law address, not a name.
test("a driven law's driver is keyed by the canonical address", () => {
    const scheduler = buildWorld({ admit: accept })
    const host = scheduler.hotSwapChild("host", fork("host", "let B\nlet A = (B.x, 100)"))
    drive(scheduler)
    const law = scheduler.laws.active().find((l) => l.feature === "position")
    const drives = scheduler.readouts.drivesForSource(host.id)
    assert.equal(drives.length, 1, "one driver for the one driven law")
    assert.equal(drives[0].spec.key, addressOf(law),
        "the driver key IS the canonical address — same address replaces, different conjoins")
})

// 3. Target lifetime: removing a target drops the driver its surviving scope declared.
test("removing a target drops the driver owned by a surviving declaring scope", () => {
    const scheduler = buildWorld({ admit: accept })
    scheduler.hotSwapChild("A", fork("A", ""))                          // the target is a root child
    scheduler.hotSwapChild("host", fork("host", "let B\nlet A.position = (B.x, 0)"))
    drive(scheduler)
    assert.ok(scheduler.root.children.get("A"), "the target exists")
    assert.equal(scheduler.readouts.size, 1, "its driven law installed one driver")
    scheduler.removeChild("A")
    drive(scheduler)
    assert.equal(scheduler.readouts.size, 0,
        "the target leaving takes the driver: source release alone is insufficient")
})
