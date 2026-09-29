// Label pool — reuse across an erase is what stops the blink.
// Run with: node --test test/js/render/label_pool_test.mjs
//
// The regression this guards: `loop … do label x 10; wait 1/24; erase end`
// blinked at every transition. A fresh troika Text is blank until its async
// sync lands; building one per label meant erase disposed the built geometry
// and the next label raced its own rebuild. The pool keeps the Text, so an
// unchanged rewrite is drawable in the same frame.
//
// The pool is importable here because the Text constructor is injected — the
// vendored troika bundle has extensionless imports node cannot resolve.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createLabelPool } from "../../../assets/js/turtling/render/label-pool.js"

// Mirrors troika's contract: tracked setters mark dirty, sync resolves only
// when dirty, and an unchanged rewrite is therefore free. Position/quaternion/
// colour are not tracked (they never cost a typeset).
const TRACKED = ["text", "fontSize", "textAlign", "anchorX", "anchorY", "font"]

function vec3() {
    return {
        x: 0, y: 0, z: 0,
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this },
    }
}

function quat() {
    return {
        x: 0, y: 0, z: 0, w: 1,
        copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this },
    }
}

class FakeText {
    constructor() {
        this.position = vec3()
        this.quaternion = quat()
        this.visible = true
        this.color = null
        this.disposed = false
        this.syncCalls = 0
        this.renders = 0
        this.material = { disposed: false, dispose() { this.disposed = true } }
        this._dirty = true
        for (const key of TRACKED) {
            let value
            Object.defineProperty(this, key, {
                get: () => value,
                set: (next) => { if (next !== value) { value = next; this._dirty = true } },
            })
        }
    }

    sync(cb) {
        this.syncCalls++
        if (!this._dirty) return          // troika: nothing changed, nothing to build
        this._dirty = false
        this.renders++
        cb?.()
    }

    dispose() { this.disposed = true }

    removeFromParent() {
        const p = this.parent
        if (p) p.children.splice(p.children.indexOf(this), 1)
        this.parent = null
    }
}

// A Text whose sync does not resolve on its own — lets a test decide when a
// late completion lands, to prove it only wakes the loop while still wanted.
class HeldText extends FakeText {
    sync(cb) {
        this.syncCalls++
        if (!this._dirty) return
        this._dirty = false
        this.renders++
        this._held = cb
    }
    fire() { const cb = this._held; this._held = null; cb?.() }
}

function fakeGroup() {
    return {
        children: [],
        add(child) { this.children.push(child); child.parent = this },
        remove(child) { this.children.splice(this.children.indexOf(child), 1) },
    }
}

const label = (text, x = 0) => ({
    text,
    textSize: 50,
    color: "#ffffff",
    position: [x, 0, 0],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
})

function poolFor(group = fakeGroup()) {
    const made = []
    const pool = createLabelPool(group, {
        createText: () => { const t = new FakeText(); made.push(t); return t },
        font: "/fonts/paperLang.ttf",
    })
    return { group, pool, made }
}

describe("createLabelPool", () => {
    test("an erase+rewrite reuses the same Text — the blink fix", () => {
        const { group, pool, made } = poolFor()
        pool.write(label("x"), () => {})
        const first = made[0]
        pool.hide()
        assert.equal(first.visible, false)
        pool.write(label("x"), () => {})
        assert.equal(made.length, 1, "no second Text built")
        assert.equal(made[0], first, "the same Text comes back")
        assert.equal(first.visible, true)
        assert.equal(first.disposed, false, "erase must not dispose geometry")
        assert.equal(group.children.length, 1)
    })

    test("a rewrite keeps the glyphs on screen — a drag does not blink", () => {
        const { pool, made } = poolFor()
        pool.write(label("270"), () => {})
        pool.rewrite()
        assert.equal(made[0].visible, true, "rewrite does not hide")
        pool.write(label("271"), () => {})
        pool.trim()
        assert.equal(made.length, 1)
        assert.equal(made[0].visible, true)
        assert.equal(made[0].text, "271")
    })

    test("trim hides leftovers of a shorter pass", () => {
        const { pool, made } = poolFor()
        pool.write(label("a", 1), () => {})
        pool.write(label("b", 2), () => {})
        pool.rewrite()
        pool.write(label("c", 3), () => {})
        pool.trim()
        assert.equal(made[0].visible, true)
        assert.equal(made[1].visible, false)
        assert.equal(pool.live, 1)
    })

    test("an unchanged rewrite does not request a render", () => {
        const { pool } = poolFor()
        let renders = 0
        pool.write(label("x"), () => renders++)
        assert.equal(renders, 1, "first write builds and wakes the loop")
        pool.hide()
        pool.write(label("x"), () => renders++)
        assert.equal(renders, 1, "identical rewrite is already drawable")
    })

    test("a changed rewrite re-syncs and requests a render", () => {
        const { pool, made } = poolFor()
        let renders = 0
        pool.write(label("1"), () => renders++)
        pool.hide()
        pool.write(label("2"), () => renders++)
        assert.equal(made.length, 1)
        assert.equal(renders, 2)
        assert.equal(made[0].text, "2")
    })

    test("labels written before an erase each get their own Text", () => {
        const { pool, made } = poolFor()
        pool.write(label("a", 1), () => {})
        pool.write(label("b", 2), () => {})
        assert.equal(pool.live, 2)
        assert.equal(made.length, 2)
        assert.notEqual(made[0], made[1])
        pool.hide()
        assert.equal(made[0].visible, false)
        assert.equal(made[1].visible, false)
        assert.equal(pool.live, 0)
        // The next pass reuses in order, without building.
        pool.write(label("c", 3), () => {})
        assert.equal(made[0].text, "c")
        assert.equal(made.length, 2)
    })

    test("position, rotation, colour and type are applied", () => {
        const { pool, made } = poolFor()
        const event = label("hi", 7)
        event.rotation = { x: 0.1, y: 0.2, z: 0.3, w: 0.9 }
        pool.write(event, () => {})
        const t = made[0]
        assert.deepEqual([t.position.x, t.position.y, t.position.z], [7, 0, 0])
        assert.deepEqual([t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w],
            [0.1, 0.2, 0.3, 0.9])
        assert.equal(t.color, "#ffffff")
        assert.equal(t.text, "hi")
        assert.equal(t.fontSize, 50)
        assert.equal(t.font, "/fonts/paperLang.ttf")
        assert.equal(t.textAlign, "center")
    })

    test("dispose frees geometry and materials and detaches; idempotent", () => {
        const { group, pool, made } = poolFor()
        pool.write(label("a"), () => {})
        pool.write(label("b"), () => {})
        pool.dispose()
        assert.equal(made[0].disposed, true)
        assert.equal(made[1].disposed, true)
        assert.equal(made[0].material.disposed, true)
        assert.equal(group.children.length, 0)
        pool.dispose()   // second call is a no-op, not a throw
        assert.equal(pool.size, 0)
    })

    test("write after dispose is ignored, never resurrects a freed Text", () => {
        const { pool, made } = poolFor()
        pool.write(label("a"), () => {})
        pool.dispose()
        pool.write(label("b"), () => {})
        assert.equal(made.length, 1)
    })

    test("a late sync wakes the loop only while the label is still wanted", () => {
        const group = fakeGroup()
        const made = []
        const pool = createLabelPool(group, {
            createText: () => { const t = new HeldText(); made.push(t); return t },
            font: "/f",
        })
        let renders = 0
        pool.write(label("x"), () => renders++)
        const t = made[0]
        assert.equal(renders, 0, "nothing to draw until sync resolves")
        t.fire()
        assert.equal(renders, 1, "a visible label wakes the loop")
        // The next sync is still in flight when the erase hides the label.
        pool.write(label("y"), () => renders++)
        pool.hide()
        t.fire()
        assert.equal(renders, 1, "a hidden label stays quiet")
    })

    test("an erase trims the pool to freeCap, freeing the peak", () => {
        const group = fakeGroup()
        const made = []
        const pool = createLabelPool(group, {
            createText: () => { const t = new FakeText(); made.push(t); return t },
            font: "/f",
            freeCap: 2,
        })
        for (let i = 0; i < 5; i++) pool.write(label(String(i), i), () => {})
        assert.equal(pool.size, 5)
        pool.hide()
        assert.equal(pool.size, 2, "kept a working set")
        assert.equal(group.children.length, 2, "the rest detached")
        for (let i = 2; i < 5; i++) assert.equal(made[i].disposed, true, `freed ${i}`)
        // The working set is reused, then a burst grows it again.
        pool.write(label("a"), () => {})
        pool.write(label("b"), () => {})
        assert.equal(made.length, 5, "free slots reused before building")
        pool.write(label("c"), () => {})
        assert.equal(made.length, 6)
    })
})
