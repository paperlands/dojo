// Material cache lifecycle — owned instance, not a module-global Map.
// Run with: node --test test/js/render/material_cache_test.mjs
//
// Guards the remount hazard: the canvas (and stage) outlive the hook. A
// module-global cache with a manual free was one forgotten call away from
// leaking GPU materials for the page's life. createMaterialCache() makes
// ownership structural — dispose is on the owner, clear is the blank slate.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createMaterialCache } from "../../../assets/js/turtling/render/line/material-cache.js"

function fakeMaterial(color, thickness, opts = {}) {
    return {
        color: opts.vertexColors ? 0xffffff : (color || 0xe77808),
        linewidth: thickness || 2,
        vertexColors: !!opts.vertexColors,
        resolution: { set() {} },
        disposed: false,
        dispose() { this.disposed = true },
    }
}

describe("createMaterialCache", () => {
    test("reuses one material per (color, thickness) key", () => {
        const cache = createMaterialCache({ createMaterial: fakeMaterial })
        const a = cache.get(0xff0000, 2)
        const b = cache.get(0xff0000, 2)
        const c = cache.get(0xff0000, 4)
        assert.equal(a, b)
        assert.notEqual(a, c)
        assert.equal(cache.size, 2)
        assert.equal(a._cached, true)
    })

    test("getInk collapses many colours into one material per thickness", () => {
        const cache = createMaterialCache({ createMaterial: fakeMaterial })
        const a = cache.getInk(2)
        const b = cache.getInk(2)
        const c = cache.getInk(4)
        assert.equal(a, b)
        assert.notEqual(a, c)
        assert.equal(a.vertexColors, true)
        assert.equal(a.color, 0xffffff)
        assert.equal(cache.size, 2)   // not one per colour
    })

    test("clear disposes GPU materials and empties the map (blank slate)", () => {
        const cache = createMaterialCache({ createMaterial: fakeMaterial })
        const a = cache.get(1, 2)
        const b = cache.get(2, 3)
        cache.clear()
        assert.equal(cache.size, 0)
        assert.equal(a.disposed, true)
        assert.equal(b.disposed, true)
        // Reusable after clear — stage still owns us.
        const c = cache.get(1, 2)
        assert.equal(c.disposed, false)
        assert.equal(cache.size, 1)
    })

    test("dispose is the hard free — idempotent, get after throws", () => {
        const cache = createMaterialCache({ createMaterial: fakeMaterial })
        const a = cache.get(1, 2)
        cache.dispose()
        assert.equal(a.disposed, true)
        assert.equal(cache.size, 0)
        cache.dispose() // second call is a no-op
        assert.throws(() => cache.get(1, 2), /used after dispose/)
    })

    test("every material carries the resolution — at creation, and on update", () => {
        // Line width is screen-space, so a material is only as honest as the
        // resolution it holds. The cache used to read the WINDOW at creation,
        // which is the wrong surface for a canvas that is not the viewport, and
        // wrong for a material made after the last resize. The stage sets the
        // number through updateResolution; the cache keeps it and hands it to
        // everything it makes, whenever it makes it.
        const seen = []
        const cache = createMaterialCache({
            createMaterial: (color, thickness) => ({
                ...fakeMaterial(color, thickness),
                resolution: { set(w, h) { seen.push([w, h]) } },
            }),
        })
        cache.get(1, 2)
        cache.get(2, 3)
        // No surface has been set yet: the materials carry the placeholder, not a
        // window read this cache cannot see.
        assert.deepEqual(seen, [[1, 1], [1, 1]])

        seen.length = 0
        cache.updateResolution(800, 600)
        assert.deepEqual(seen, [[800, 600], [800, 600]])

        // And one made between resizes is not left behind at the placeholder.
        seen.length = 0
        cache.get(3, 4)
        cache.getInk(6)
        assert.deepEqual(seen, [[800, 600], [800, 600]])

        // A later resize reaches the materials that already exist.
        seen.length = 0
        cache.updateResolution(320, 240)
        assert.deepEqual(seen, [[320, 240], [320, 240], [320, 240], [320, 240]])
    })
})
