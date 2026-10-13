// Shared authority contracts, with independent fixtures for each reading form. (D058)
// Required readers and malformed terms belong to the fixture, not an assumed arity.
import { test } from "node:test"
import assert from "node:assert/strict"
import { AUTHORED, boundTerm, payloadOf, withPayload } from "../../../assets/js/turtling/laws/authored.js"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const IDENT = SE3.identity()
const SENTINEL = [100, 100, 100]
const SENTINEL_POSE = { position: SENTINEL, rotation: IDENT.rotation }
const bearAt = (deg) => [Math.sin((deg + 90) * Math.PI / 180), Math.cos((deg + 90) * Math.PI / 180), 0]
const tiltAt = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0]
const framedReads = [["worldOf", "A"], ["placementOf", "S"]]

const FIXTURE = {
    distance: [
        { at: [4, 0, 0], value: 2, off: [5, 0, 0], offValue: 3, offResidual: 1,
            payloadField: "radius", required: framedReads,
            term: { type: "distance", references: ["A", { frame: "S", value: [2, 0, 0] }], radius: 2 } },
        { at: [4, 0, 0], value: 2, off: [5, 0, 0], offValue: 3, offResidual: 1,
            payloadField: "radius", positions: { B: [2, 0, 0] },
            required: [["worldOf", "A"], ["worldOf", "B"]],
            term: { type: "distance", references: ["A", "B"], radius: 2 } },
    ],
    position: [{ at: [1, 2, 3], value: [1, 2, 3], off: [9, 9, 9], offValue: [9, 9, 9], offResidual: Math.hypot(8, 7, 6),
        payloadField: "value", required: [["worldOf", "A"]],
        term: { type: "position", references: ["A"], frame: "S", value: [1, 2, 3] } }],
    coordinate: [{ at: [0, 0, 0], value: 0, axis: "z", off: [0, 0, 1], offValue: 1, offResidual: 1,
        payloadField: "value", required: [["worldOf", "A"]],
        term: { type: "coordinate", references: ["A"], frame: "S", axis: "z", value: 0 } }],
    tilt: [{ at: tiltAt(30), value: 30, off: tiltAt(40), offValue: 40, offResidual: 10,
        payloadField: "value", required: framedReads,
        term: { type: "tilt", references: ["A"], frame: "S", value: 30 } }],
    bearing: [{ at: bearAt(30), value: 30, off: bearAt(50), offValue: 50, offResidual: 20,
        payloadField: "value", required: framedReads,
        term: { type: "bearing", references: ["A"], frame: "S", value: 30 } }],
}
const CASES = Object.entries(FIXTURE).flatMap(([feature, fixtures]) =>
    fixtures.map((fixture, i) => ({ ...fixture, feature, name: `${feature}/${i}` })))
const MALFORMED = { missing: undefined, null: null, wrongKind: "30", sparse: new Array(3),
    short: [1, 2], notFinite: [1, NaN, 0] }
const lawOf = (f, term = f.term) => bindLaw({ feature: f.feature, endpoints: ["A"], scope: "S", frame: "S",
    predicate: f.value, axis: f.axis ?? null, expression: term })
const ctxOf = (f, at = f.at) => ({
    worldOf: (id) => id === "A" ? at : (f.positions?.[id] ?? SENTINEL),
    livePoseOf: (id) => id === "S" || id === "F" ? IDENT : SENTINEL_POSE,
    placementOf: (id) => id === "S" || id === "F" ? IDENT : SENTINEL_POSE,
})
const specOf = (f, world = f.at) => ({ law: lawOf(f), value: 999, radius: 999,
    reachPolicy: "target-only", world, axis: f.axis ?? null, ...ctxOf(f) })

test("row contract: every authored reading has an independent fixture", () => {
    const rows = Object.entries(AUTHORED).filter(([, row]) => row.measure && row.validate)
    assert.ok(rows.length)
    for (const [name] of rows) assert.ok(FIXTURE[name]?.length, `${name} must not escape the battery`)
})

test("row contract: the bound term is frozen and names its payload", () => {
    for (const f of CASES) {
        const term = boundTerm(lawOf(f))
        assert.ok(Object.isFrozen(term), f.name)
        assert.deepEqual(payloadOf(f.feature, term), f.value, f.name)
    }
})

test("row contract: poisoned mirrors never change an identity-sensitive reading", () => {
    for (const f of CASES) {
        const law = lawOf(f), row = AUTHORED[f.feature]
        const clean = row.measure(law, ctxOf(f))
        assert.equal(clean.status, "valid", f.name)
        const dirty = row.measure({ ...law, predicate: 999, endpoints: ["Z"], frame: "Z" }, ctxOf(f))
        assert.deepEqual(dirty, clean, f.name)
        assert.notDeepEqual(row.measure(law, ctxOf(f, SENTINEL)), clean, `${f.name}: reader sensitivity`)
    }
})

test("row contract: each required identity reading is independently unavailable", () => {
    for (const f of CASES) for (const [reader, id] of f.required) {
        const ctx = ctxOf(f), real = ctx[reader]
        ctx[reader] = (input) => input === id ? null : real(input)
        const check = AUTHORED[f.feature].measure(lawOf(f), ctx)
        assert.equal(check.status, "cannot-measure", `${f.name}/${reader}/${id}`)
        assert.ok(check.reason)
    }
})

test("row contract: a live-only distance does not invent a placement dependency", () => {
    const f = CASES.find((f) => f.feature === "distance" && f.positions)
    const ctx = { ...ctxOf(f), placementOf: () => { throw new Error("not a required reader") } }
    assert.equal(AUTHORED.distance.measure(lawOf(f), ctx).status, "valid")
})

test("row contract: validation uses the bound payload, not the request mirrors", () => {
    for (const f of CASES) assert.equal(AUTHORED[f.feature].validate(specOf(f)).ok, true, f.name)
})

test("row contract: spoofed request values cannot certify unlawful geometry", () => {
    for (const f of CASES) {
        const spec = { ...specOf(f, f.off), value: f.offValue, radius: f.offResidual }
        assert.equal(AUTHORED[f.feature].validate(spec).ok, false, f.name)
    }
})

test("row contract: malformed terms refuse without assuming three inputs are invalid", () => {
    for (const f of CASES) {
        const law = lawOf(f, { ...f.term, references: [null] })
        assert.equal(boundTerm(law), null, f.name)
        const spec = { ...specOf(f), law }
        assert.equal(AUTHORED[f.feature].validate(spec).ok, false, f.name)
    }
})

test("row contract: each residual remains in its own quantity's units", () => {
    for (const f of CASES) {
        const check = AUTHORED[f.feature].measure(lawOf(f), ctxOf(f, f.off))
        assert.equal(check.status, "violation", f.name)
        assert.ok(Math.abs(check.residual - f.offResidual) < 1e-6, f.name)
    }
})

test("row contract: malformed payloads target the fixture's actual slot", () => {
    for (const f of CASES) for (const [label, bad] of Object.entries(MALFORMED)) {
        const law = lawOf(f, { ...f.term, [f.payloadField]: bad })
        let check
        assert.doesNotThrow(() => { check = AUTHORED[f.feature].measure(law, ctxOf(f)) }, `${f.name}/${label}`)
        assert.equal(check.status, "cannot-measure", `${f.name}/${label}`)
        assert.equal(AUTHORED[f.feature].validate({ ...specOf(f), law }).ok, false, `${f.name}/${label}`)
    }
})

test("row contract: payload replacement changes only the independently named slot", () => {
    for (const f of CASES) {
        const original = { ...lawOf(f).expression, futureMeaning: { untouched: true } }
        const changed = withPayload(original, f.offValue)
        assert.deepEqual(changed, { ...original, [f.payloadField]: f.offValue }, f.name)
        assert.deepEqual(payloadOf(f.feature, changed), f.offValue, f.name)
        assert.equal(changed.references, original.references, f.name)
        assert.equal(changed.futureMeaning, original.futureMeaning, f.name)
        assert.deepEqual(original[f.payloadField], f.value, `${f.name}: no mutation`)
    }
    assert.equal(withPayload({ type: "unknown", value: 2 }, 3), null)
    assert.equal(withPayload(null, 3), null)
})
