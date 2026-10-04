// The law-verdict layer's injected WORLD contract, exercised DIRECTLY — not through the
// scheduler. (id:nav-law-verdict, id:laws-activation-order)
//
// A frame has two different readings and they are not the same transform:
//   world.transform(frame) -> the world PLACEMENT: where the frame sits, the composition
//       of ancestor placements. This is what a world position is UNAPPLIED against to get
//       a local one. It is NEVER the live head pose.
//   world.read(frame, overrides) -> the LIVE reading: where the head is now; an override is
//       a LOCAL pose composed onto the placement.
// The module is pure given the world, so the seam can be driven with a stub whose placement
// and live reading deliberately disagree — and the result must follow the PLACEMENT.
// Run: node --test test/js/laws/verdict_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { continueLaws } from "../../../assets/js/turtling/laws/verdict.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"

const near = (a, b, tol = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) <= tol)
const translate = (x, y, z) => ({ rotation: Versor.raw(1, 0, 0, 0), position: [x, y, z] })

// A stub world: `placements` are world placements, `live` is where each head is now.
function stubWorld(placements, live) {
    const transform = (frame) => placements.get(frame.id) ?? SE3.identity()
    return {
        transform,
        read: (frame, overrides) => {
            if (overrides?.has(frame)) {
                const w = SE3.compose(transform(frame), overrides.get(frame))   // local override onto the placement
                return { position: w.position, rotation: w.rotation, time: 0 }
            }
            return { position: live.get(frame.id) ?? [0, 0, 0], rotation: SE3.identity().rotation, time: 0 }
        },
    }
}

// One distance law W–O. W is the moved writer; O is fixed.
function scene(world, pose) {
    const W = { id: "W", name: "W" }
    const O = { id: "O", name: "O" }
    const law = { feature: "distance", endpoints: ["W", "O"], predicate: 5,
        expression: { type: "distance", references: ["W", "O"], radius: 5 } }
    const registry = { get: (id) => (id === "W" ? W : id === "O" ? O : null) }
    const laws = { active: () => [law] }
    const verdict = { kind: "accept", pose, component: [] }
    return { writer: W, verdict, registry, laws, world }
}

test("verdict: world.transform is the PLACEMENT, and the live head does not move the result", () => {
    const head = Versor.raw(Math.SQRT1_2, 0, 0, Math.SQRT1_2)   // rt 90 about z: +x → +y
    const proposed = { position: [3, 0, 0], rotation: head }    // W's proposed LOCAL pose

    // (a) W's placement is translate(+10x): the world wish is [13,0,0]; the law realizes
    //     [5,0,0]; the local answer is the world point UNAPPLIED by the placement → [−5,0,0].
    const placed = stubWorld(new Map([["W", translate(10, 0, 0)]]), new Map([["O", [0, 0, 0]]]))
    const a = scene(placed, { ...proposed })
    continueLaws(a.verdict, a.writer, a.registry, a.laws, a.world)
    assert.ok(near(a.verdict.pose.position, [-5, 0, 0]), `placement-relative, got ${a.verdict.pose.position}`)
    assert.equal(a.verdict.pose.rotation, head, "the rotation stays the proposed head pose, untouched by the placement")

    // (b) The SAME live head far away ([100,0,0]) changes nothing: the position follows the
    //     placement, never the live head reading.
    const farHead = stubWorld(new Map([["W", translate(10, 0, 0)]]), new Map([["W", [100, 0, 0]], ["O", [0, 0, 0]]]))
    const b = scene(farHead, { ...proposed })
    continueLaws(b.verdict, b.writer, b.registry, b.laws, b.world)
    assert.ok(near(b.verdict.pose.position, [-5, 0, 0]), `live head ignored, got ${b.verdict.pose.position}`)

    // (c) Placement identity, same live head: the local answer is the world point itself.
    const flat = stubWorld(new Map([]), new Map([["W", [100, 0, 0]], ["O", [0, 0, 0]]]))
    const c = scene(flat, { ...proposed })
    continueLaws(c.verdict, c.writer, c.registry, c.laws, c.world)
    assert.ok(near(c.verdict.pose.position, [5, 0, 0]), `identity placement, got ${c.verdict.pose.position}`)
})
