// The three.js entry contract — every name must resolve, and the count is fixed.
//
// Stage 1's enforcement is the bundler: a vanished export fails the build and
// names it. But CI never bundles (.github/workflows/ci.yml: mix compile +
// node --test, no esbuild), so a missing symbol is red on a developer's machine
// and green in CI. That is a gap in what stage 1 claimed.
//
// This test rides the path CI already runs — same reasoning as vendor_test.mjs,
// same shape as CM6's tripwire in terminal_test.mjs. Node imports the entry
// directly; no DOM, no npm. Assert the count too: a silent addition is a change
// to the contract and must be deliberate.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

// The surface three-entry.js promises. Keep this list the source of the count
// assertion so adding a name here without exporting it (or the reverse) fails.
const PROMISED = [
    "BufferAttribute",
    "BufferGeometry",
    "Color",
    "DoubleSide",
    "DynamicDrawUsage",
    "Float32BufferAttribute",
    "FrontSide",
    "GridHelper",
    "Group",
    "InstancedInterleavedBuffer",
    "InterleavedBufferAttribute",
    "LineBasicMaterial",
    "LineSegments",
    "MOUSE",
    "Mesh",
    "MeshBasicMaterial",
    "PerspectiveCamera",
    "Plane",
    "Quaternion",
    "Scene",
    "TOUCH",
    "Vector3",
    "WebGLRenderer",
]

describe("three-entry contract", () => {
    let entry

    test("loads without error", async () => {
        entry = await import("../../../assets/js/utils/three-entry.js")
        assert.ok(entry, "module loaded")
    })

    test(`exports exactly ${PROMISED.length} names`, async () => {
        entry ??= await import("../../../assets/js/utils/three-entry.js")
        const keys = Object.keys(entry)
        assert.equal(
            keys.length,
            PROMISED.length,
            `entry surface drifted: got [${keys.sort().join(", ")}], ` +
                `expected ${PROMISED.length} names — update three-entry.js and this list together`
        )
    })

    for (const name of PROMISED) {
        test(`exports ${name}`, async () => {
            entry ??= await import("../../../assets/js/utils/three-entry.js")
            assert.notEqual(
                entry[name],
                undefined,
                `${name} is undefined — vanished upstream, or dropped from three-entry.js`
            )
        })
    }
})
