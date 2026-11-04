// Dependency edges are one derived view; cycle membership and preflight ask different questions.
// Compare both with independent transitive closure, including frame-mediated edges.
// (id:tower-laws-readout-outcomes, id:laws-priors-ir)
import { test } from "node:test"
import assert from "node:assert/strict"
import { createReadouts } from "../../../assets/js/turtling/laws/readout.js"

function graphCases(nodeCount, frameCount) {
    const size = nodeCount + frameCount, edges = []
    for (let from = 0; from < size; from++) {
        for (let to = 0; to < size; to++) {
            if (from < nodeCount || to < nodeCount) edges.push([from, to])
        }
    }
    for (let mask = 0; mask < 2 ** edges.length; mask++) {
        const adj = Array.from({ length: size }, () => [])
        edges.forEach(([from, to], bit) => { if (mask & (2 ** bit)) adj[from].push(to) })
        // Positive-length paths: the diagonal is true only when a cycle exists.
        const reach = adj.map((neighbours) => {
            const seen = new Set(), pending = [...neighbours]
            while (pending.length) {
                const next = pending.pop()
                if (seen.has(next)) continue
                seen.add(next)
                pending.push(...adj[next])
            }
            return seen
        })
        const r = createReadouts(), ids = [], frames = Array.from({ length: frameCount }, () => ({}))
        for (let i = 0; i < nodeCount; i++) {
            ids[i] = r.register("source", String(i), () => {
                for (const dep of adj[i]) {
                    if (dep < nodeCount) r.value(ids[dep])
                    else r.readsink(frames[dep - nodeCount])
                }
                return i + 1
            })
        }
        frames.forEach((frame, i) => {
            for (const dep of adj[nodeCount + i]) r.produces(ids[dep], frame)
        })
        const cyclic = r.recompute().filter((change) => change.cycle).map((change) => change.id)
        const expected = ids.filter((_id, i) => reach[i].has(i))
        assert.deepEqual(new Set(cyclic), new Set(expected), `cycle membership: mask ${mask}`)
        const before = r.list()
        frames.forEach((frame, f) => {
            ids.forEach((id, i) => {
                assert.equal(r.dependsOnFrame(() => r.value(id), frame), reach[i].has(nodeCount + f),
                    `preflight from node ${i}: mask ${mask}`)
            })
        })
        assert.deepEqual(r.list(), before, `preflight is observational: mask ${mask}`)
    }
}

test("every three-node scalar topology agrees with independent cycle membership", () => {
    graphCases(3, 0)
})

test("every two-node/one-frame topology agrees on cycles and preflight reachability", () => {
    graphCases(2, 1)
})

test("preflight crosses several producer frames and keeps identities distinct", () => {
    const r = createReadouts(), f = {}, g = {}, target = { id: 17, name: "target" }
    const a = r.register("s", "a", () => { r.readsink(f); return 1 })
    const b = r.register("s", "b", () => { r.readsink(g); return 2 })
    const c = r.register("s", "c", () => { r.readsink(target); return 3 })
    r.produces(b, f); r.produces(c, g)
    assert.equal(r.recompute().some((change) => change.cycle), false)
    assert.equal(r.dependsOnFrame(() => r.value(a), target), true)
    assert.equal(r.dependsOnFrame(() => r.value(a), { ...target }), false,
        "matching names and numeric ids do not substitute for the resolved frame")
    r.retire("s", "c")
    assert.equal(r.dependsOnFrame(() => r.value(a), target), false,
        "the retired producer no longer connects its frame to the target")
})
