// One retirement pass per owned ordinary subtree: a single bulk law scan, exact
// identity union, and the four callers keeping their own policy. (id:being-facets-p4-sequence)
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { createLawStore } from "../../../assets/js/turtling/laws/replacement.js"
import { inputFrames } from "../../../assets/js/turtling/laws/authored.js"

const id = (n) => `f${n}`

// --- store: exact union, delegation, no-op -----------------------------------------
test("retractIdentities keeps the exact channel union and delegates one id", () => {
    const store = createLawStore()
    const byFrame = { feature: "position", address: ["by-frame"], frame: id(1), endpoints: [id(1)], owner: "o1" }
    const byEndpoint = { feature: "distance", address: ["by-endpoint"], frame: id(9), endpoints: [id(2), id(3)], owner: "o2",
        expression: { type: "distance", references: [id(2), id(3)], radius: 5 } }
    const byFramed = { feature: "distance", address: ["by-framed"], frame: id(9),
        endpoints: [id(4), id(5)], owner: "o3",
        expression: { type: "distance", references: [id(4), { frame: id(6), value: [0, 0, 0], relative: true }], radius: 5 } }
    const survivor = { feature: "distance", address: ["survivor"], frame: id(9), endpoints: [id(7), id(8)], owner: "o4",
        expression: { type: "distance", references: [id(7), id(8)], radius: 5 } }
    for (const law of [byFrame, byEndpoint, byFramed, survivor]) store.apply(law)
    assert.deepEqual(inputFrames(byFramed), [id(6)], "the framed input is a first-class channel")

    assert.equal(store.retractIdentity(id(1)), "retracted")
    assert.equal(store.lawAt(byFrame.address), null)
    assert.equal(store.retractIdentities(new Set([id(3)])), "retracted")
    assert.equal(store.lawAt(byEndpoint.address), null)
    assert.equal(store.retractIdentities([id(6)]), "retracted")
    assert.equal(store.lawAt(byFramed.address), null)
    assert.ok(store.lawAt(survivor.address), "a law naming no retired id survives")
    assert.equal(store.retractIdentities([]), "noop")
    assert.equal(store.retractIdentity(id(42)), "noop")
})

test("a partial owner replacement retires only the laws that owner still holds", () => {
    const store = createLawStore()
    const first = { feature: "distance", address: "site-x", frame: id(1), endpoints: [id(1), id(2)], owner: "A" }
    const second = { feature: "distance", address: "site-y", frame: id(2), endpoints: [id(2), id(3)], owner: "A" }
    store.apply(first)
    store.apply(second)
    // B supersedes A at the SAME address; A keeps only its other address.
    store.apply({ ...first, owner: "B" })
    assert.equal(store.ownerOf("site-x"), "B")
    assert.equal(store.retract("A"), "retracted")
    assert.equal(store.lawAt("site-x")?.owner, "B", "the replacement survives")
    assert.equal(store.lawAt("site-y"), null, "A's remaining address is gone")
    assert.equal(store.retract("A"), "noop", "a superseded owner owns nothing")
})

// --- engine: one scope removal reads each foreign term once ------------------------
test("one scope removal reads each foreign law's references once", () => {
    const R = 8, L = 8
    const s = buildWorld()
    const victim = Array.from({ length: R }, (_, i) => `goto ${i} 0\nlet p${i}`).join("\n")
    s.hotSwapChild("victim", fork("victim", victim))
    const keep = s.hotSwapChild("keep", fork("keep", "goto 0 0\nlet k0\ngoto 5 0\nlet k1"))
    drive(s)
    const k0 = keep.children.get("k0"), k1 = keep.children.get("k1")

    // Prebound rows with the same typed reference data, but a counting getter: the row
    // itself is the probe. The retired per-id loop would read (R+1)*L times.
    let reads = 0
    for (let i = 0; i < L; i++) {
        const refs = [k0.id, k1.id]
        s.laws.apply({ feature: "distance", address: `foreign-${i}`, frame: k0.id,
            endpoints: [...refs], owner: "foreign",
            expression: { type: "distance", radius: 5, get references() { reads++; return refs } } })
    }
    assert.equal(s.laws.active().length, L, "the foreign rows are installed")
    reads = 0
    s.removeChild("victim")
    assert.equal(reads, L, "each foreign law is probed once, not once per retired frame")
    assert.equal(s.laws.active().length, L, "every foreign law survives")
})

// --- engine: an installation's own laws go with it; the receiver keeps its own ------
test("retiring an installation releases its subtree in one pass", () => {
    const s = buildWorld()
    const host = s.hotSwapChild("host", fork("host", "let A\nlet A.z = 0"))
    const src = s.hotSwapChild("src", fork("src", `def attach receiver do
  as receiver do
    let inner
    let distance(inner, (0,0,0)) = 5
    wait 5
  end
end
attach A`))
    for (let i = 0; i < 3; i++) s.tick(i * 1000)
    const [install] = s.installationsOf(src)
    assert.ok(install, "the installation is seated")
    const innerId = install.frame.children.get("inner")?.id
    assert.ok(innerId != null, "the installed body declared its own point")
    assert.ok(s.laws.active().some((law) => law.endpoints.includes(innerId)), "its law is live")

    s.removeChild("src")
    assert.equal(s.installationsOf(src).length, 0, "the installation is retired")
    assert.ok(!s.laws.active().some((law) => law.endpoints.includes(innerId)), "its law is gone")
    const A = host.children.get("A")
    assert.equal(s.registry.get(A.id), A, "the receiver survives its installer")
    assert.ok(s.laws.active().some((law) => law.endpoints.includes(A.id)), "the receiver keeps its own law")
})
