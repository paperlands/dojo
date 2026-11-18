// The portable offer is versioned plain data; null is legacy, empty is explicit.
// Routes are tuples: a cell identity or the document root, plus ordinary names.
// (id:laws-construction-input)
import { test } from "node:test"
import assert from "node:assert/strict"
import { copyChoices, validChoices } from "../../../assets/js/turtling/laws/hand_choices.js"

const translation = (x) => ({ kind: "translation", by: [x, 0, 0] })
const offer = (inputs) => ({ v: 1, inputs })

test("null legacy and explicit empty are different values, both admitted", () => {
    assert.equal(validChoices(null), true)
    assert.equal(copyChoices(null), null)
    assert.equal(validChoices(offer([])), true)
    assert.deepEqual(copyChoices(offer([])), { v: 1, inputs: [] })
})

test("every admitted action family copies through the capsule", () => {
    const choices = offer([
        { route: { root: "document", names: ["p"] }, action: translation(2) },
        { route: { root: "document", names: ["A", "p"] }, action: { kind: "sphere", rotation: { w: 1, x: 0, y: 0, z: 0 } } },
        { route: { root: { cell: "1.2.spiral" }, names: ["q"] }, action: { kind: "circle", phaseVector: [0, 0, Math.PI] } },
        { route: { root: "document", names: ["cone"] }, action: { kind: "cone", angle: 0.25, height: 1 } },
    ])
    assert.equal(validChoices(choices), true)
    const copied = copyChoices(choices)
    assert.deepEqual(copied, choices)
    assert.notEqual(copied, choices)
    assert.notEqual(copied.inputs[0].route.names, choices.inputs[0].route.names)
    assert.notEqual(copied.inputs[0].action.by, choices.inputs[0].action.by)
})

test("a quoted name is one tuple element, never a delimiter path", () => {
    const choices = offer([{ route: { root: "document", names: ["A/B.c", "p"] }, action: translation(1) }])
    assert.equal(validChoices(choices), true)
    assert.deepEqual(copyChoices(choices).inputs[0].route.names, ["A/B.c", "p"])
})

test("malformed roots, names, versions and actions admit nothing", () => {
    for (const bad of [
        { v: 2, inputs: [] },
        { v: 1 },
        { v: 1, inputs: {} },
        { v: 1, inputs: [null] },
        { v: 1, inputs: [{ route: { root: "document", names: [] }, action: translation(1) }] },
        { v: 1, inputs: [{ route: { root: "document", names: [1] }, action: translation(1) }] },
        { v: 1, inputs: [{ route: { root: "document", names: Array(1) }, action: translation(1) }] },
        { v: 1, inputs: [{ route: { root: "document", names: ["p", , "q"] }, action: translation(1) }] },
        { v: 1, inputs: [{ route: { root: { cell: "" }, names: ["p"] }, action: translation(1) }] },
        { v: 1, inputs: [{ route: { root: "buffer", names: ["p"] }, action: translation(1) }] },
        { v: 1, inputs: [{ route: { root: "document", names: ["p"] }, action: null }] },
        { v: 1, inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "sphere", rotation: { w: 0, x: 0, y: 0, z: 0 } } }] },
    ]) {
        assert.equal(validChoices(bad), false, JSON.stringify(bad))
        assert.equal(copyChoices(bad), null)
    }
})

test("duplicate routes are refused, not silently ordered", () => {
    const choices = offer([
        { route: { root: "document", names: ["p"] }, action: translation(1) },
        { route: { root: "document", names: ["p"] }, action: translation(2) },
    ])
    assert.equal(validChoices(choices), false)
    assert.equal(copyChoices(choices), null)
})

test("capturing a copy cannot mutate the store's value", () => {
    const choices = offer([{ route: { root: "document", names: ["p"] }, action: translation(2) }])
    const copied = copyChoices(choices)
    choices.inputs[0].route.names[0] = "forged"
    choices.inputs[0].action.by[0] = 99
    assert.deepEqual(copied.inputs[0].route.names, ["p"])
    assert.deepEqual(copied.inputs[0].action, translation(2))
})
