// Phase 2a — replacement without a solver.
//
// The pure transition fixture: what a line replaces, and who owns it. Five → ten;
// reversed endpoints; an identical value from another site; editing versus
// deleting an active or a superseded owner; no resurrection; fresh replay.
// (id:laws-ordered-replacement, id:laws-build-p2a)
// Run: node --test test/js/laws/replacement_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { addressOf, createLawStore } from "../../../assets/js/turtling/laws/replacement.js"

const distance = (a, b, value, owner, scope = "s", frame = null) =>
    ({ feature: "distance", endpoints: [a, b], scope, frame, predicate: value, owner })
const position = (a, value, owner, scope = "s", frame = "f") =>
    ({ feature: "position", endpoints: [a], scope, frame, predicate: value, owner })
const coincidence = (a, b, owner, scope = "s") =>
    ({ feature: "coincidence", endpoints: [a, b], scope, predicate: true, owner })

test("address: declared symmetries only, never algebraic equivalence", () => {
    assert.equal(addressOf(distance("A", "B", 5, "s1")), addressOf(distance("B", "A", 9, "s2")),
        "distance endpoints are unordered")
    assert.notEqual(addressOf(distance("A", "B", 5, "s1", "s")), addressOf(distance("A", "B", 5, "s1", "t")),
        "scope is part of the address")
    assert.notEqual(addressOf(distance("A", "B", 5, "s1", "s", "f")), addressOf(distance("A", "B", 5, "s1", "s", "g")),
        "a named metric frame is part of the address")
    assert.notEqual(addressOf(distance("A", "B", 5, "s1")), addressOf(coincidence("A", "B", "s1")),
        "the feature separates addresses")
    assert.equal(addressOf(position("A", [1, 0, 0], "s1")), addressOf(position("A", [2, 0, 0], "s2")),
        "a position pin is addressed by A and its frame, not by its value")
})

test("replacement: five → ten is one law; the later owner wins", () => {
    const store = createLawStore()
    const key = addressOf(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 10, "s2"))
    assert.equal(store.active().length, 1, "one law, not two")
    assert.equal(store.lawAt(key).predicate, 10)
    assert.equal(store.ownerOf(key), "s2")
})

test("replacement: reversed endpoints reach the same address", () => {
    const store = createLawStore()
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(distance("B", "A", 10, "s2"))
    assert.equal(store.active().length, 1)
    assert.equal(store.lawAt(addressOf(distance("A", "B", 5, "s1"))).predicate, 10)
})

test("replacement: an identical value from another site still moves the owner", () => {
    const store = createLawStore()
    const key = addressOf(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 5, "s2"))
    assert.equal(store.active().length, 1, "equal values are not extra strength")
    assert.equal(store.ownerOf(key), "s2", "the later statement still owns it")
})

test("edit: the current owner revises; a superseded owner cannot steal", () => {
    const store = createLawStore()
    const key = addressOf(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 5, "s1"))
    assert.equal(store.edit("s1", distance("A", "B", 7, "s1")), "revised")
    assert.equal(store.lawAt(key).predicate, 7)

    store.apply(distance("A", "B", 10, "s2"))
    assert.equal(store.edit("s1", distance("A", "B", 9, "s1")), "future",
        "editing a superseded statement changes future execution only")
    assert.equal(store.lawAt(key).predicate, 10)
    assert.equal(store.ownerOf(key), "s2")
})

test("edit: a changed address needs a clearly identified fresh play", () => {
    const store = createLawStore()
    store.apply(distance("A", "B", 5, "s1"))
    assert.equal(store.edit("s1", distance("A", "C", 5, "s1")), "fresh-play")
    assert.equal(store.lawAt(addressOf(distance("A", "B", 5, "s1"))).predicate, 5, "the old law stands")
})

test("delete: the current owner retracts; a superseded owner is a no-op", () => {
    const store = createLawStore()
    const key = addressOf(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 10, "s2"))
    assert.equal(store.retract("s1"), "noop", "the superseded owner owns nothing")
    assert.equal(store.lawAt(key).predicate, 10, "no change to the active law")
    assert.equal(store.retract("s2"), "retracted")
    assert.equal(store.active().length, 0)
})

test("delete does not resurrect the superseded law", () => {
    const store = createLawStore()
    const key = addressOf(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 10, "s2"))
    store.retract("s2")
    assert.equal(store.lawAt(key), null, "an earlier statement is not re-executed by a delete")
})

test("one owner retracts all its lowered predicates together", () => {
    const store = createLawStore()
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(coincidence("A", "C", "s1"))   // a second predicate from the same site
    assert.equal(store.active().length, 2)
    store.retract("s1")
    assert.equal(store.active().length, 0, "lowered helpers share their owner's lifetime")
})

test("different addresses conjoin", () => {
    const store = createLawStore()
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(distance("B", "C", 3, "s2"))
    store.apply(position("A", [0, 0, 0], "s3"))
    assert.equal(store.active().length, 3)
})

test("fresh play clears, then executes the source in order", () => {
    const store = createLawStore()
    store.apply(distance("A", "B", 5, "s1"))
    store.apply(distance("A", "B", 10, "s2"))
    store.clear()
    assert.equal(store.active().length, 0, "a fresh play inherits nothing")
    for (const law of [distance("A", "B", 5, "s1"), distance("A", "B", 10, "s2")]) store.apply(law)
    assert.equal(store.active().length, 1)
    assert.equal(store.lawAt(addressOf(distance("A", "B", 5, "s1"))).predicate, 10)
})
