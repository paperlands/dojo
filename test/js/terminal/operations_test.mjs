import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { formatArgs } from "../../../assets/js/terminal/operations.js"

describe("formatArgs", () => {
    test("ordinary commands stay space-separated", () => {
        assert.equal(formatArgs([50], "fw"), " 50")
        assert.equal(formatArgs(["red"], "beColour"), " red")
    })

    test("let births the place, then writes the law", () => {
        assert.equal(formatArgs(["A", "distance", "=", 50], "let"), "let A\nlet A.distance=50")
        assert.equal(formatArgs(["B", "x", "=", 0], "let"), "let B\nlet B.x=0")
        assert.equal(formatArgs(["A", "tilt", "<=", 45], "let"), "let A\nlet A.tilt<=45")
    })
})
