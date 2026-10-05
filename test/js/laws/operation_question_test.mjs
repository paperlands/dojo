// Reach scaffolding, not new angle grammar: the three-role row is injected only here.
// The real binder, gate and publisher must preserve its question. (D058)
import { test } from "node:test"
import assert from "node:assert/strict"
import { AUTHORED, withPayload } from "../../../assets/js/turtling/laws/authored.js"
import { applyLaw } from "../../../assets/js/turtling/laws/verdict.js"
import { createLawStore } from "../../../assets/js/turtling/laws/replacement.js"
import { angleOf, selectAngle, validateAngle } from "../../../assets/js/turtling/laws/angle.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { buildWorld, fork, drive } from "./harness.mjs"

const stub = () => {
    const poses = new Map([["A", [0, 0, 0]], ["B", [3, 0, 0]], ["O", [0, 0, 0]]]
        .map(([id, position]) => [id, { ...SE3.identity(), position }]))
    const frames = new Map([...poses.keys()].map((id) => [id, { id, name: id,
        transform: { deref: () => poses.get(id) } }]))
    const registry = { get: (id) => frames.get(id) ?? null }
    const world = { transform: () => SE3.identity(),
        read: (frame, overrides) => overrides?.get(frame) ?? poses.get(frame.id) }
    const pump = { registry, laws: createLawStore() }
    const spec = { feature: "distance", target: frames.get("A"), observer: frames.get("O"),
        participants: [frames.get("A"), frames.get("B")],
        term: { type: "distance", references: ["A", "B"], radius: 5 } }
    return { poses, frames, registry, world, pump, spec }
}

test("reach question: the selected mover is not the first mathematical input", () => {
    const s = stub()
    const out = applyLaw({ ...s.spec, operation: { policy: "target-only", movable: ["B"] } }, s.pump, s.world)
    assert.equal(out.kind, "commit", out.message)
    assert.deepEqual(out.poses.map(({ frame, pose }) => [frame.id, pose.position]), [["B", [5, 0, 0]]])
    assert.deepEqual(out.operation.movable, ["B"])
    assert.deepEqual(out.operation.held, ["A"])
    assert.equal(out.operation.request, 5)
})

test("reach question: invalid explicit conditions never silently become defaults", () => {
    for (const operation of ["typo", [], { policy: "typo" }, { policy: null },
        { movable: null }, { movable: ["OUTSIDE"] }]) {
        const s = stub()
        const out = applyLaw({ ...s.spec, operation }, s.pump, s.world)
        assert.notEqual(out.kind, "commit", JSON.stringify(operation))
        assert.equal(s.pump.laws.count(), 0)
        assert.deepEqual(s.poses.get("A").position, [0, 0, 0])
    }
})

test("reach question: the producer sees a frozen snapshot but the gate checks the current world", () => {
    const s = stub(), real = AUTHORED.distance.propose
    let observed
    AUTHORED.distance.propose = (env) => {
        observed = env.operation
        const before = [...env.worldOf("B")]
        assert.throws(() => env.operation.movable.push("B"))
        assert.throws(() => { env.worldOf("B")[0] = 99 })
        s.poses.set("B", { ...SE3.identity(), position: [9, 0, 0] })
        assert.deepEqual(env.worldOf("B"), before)
        return real(env)
    }
    try {
        const out = applyLaw({ ...s.spec, operation: { policy: "target-only", movable: ["A"] } }, s.pump, s.world)
        assert.notEqual(out.kind, "commit", "the stale snapshot cannot certify the current world")
        assert.equal(s.pump.laws.count(), 0)
        assert.deepEqual(observed.snapshot.find((e) => e.id === "B").live.position, [3, 0, 0])
        assert.ok(Object.isFrozen(observed.snapshot))
    } finally { AUTHORED.distance.propose = real }
})

const FEATURE = "threeRoleProbe"
const termOf = (law) => law.expression?.type === FEATURE && law.expression.references.length === 3
    ? law.expression : null
const probeRow = (capture, fault) => ({
    name: FEATURE, kind: "angle",
    address: (ends) => ends,
    endpoints: ({ participants }) => participants.map((f) => f.id),
    normalizeTerm: ({ endpoints, predicate }) => ({ type: FEATURE,
        references: [endpoints[1], endpoints[0], endpoints[2]], degrees: predicate }),
    term: termOf,
    payload: (term) => term.degrees,
    replacePayload: (term, degrees) => ({ ...term, degrees }),
    measure(law, ctx) {
        const t = termOf(law), [b, a, c] = t.references
        const got = angleOf(ctx.worldOf(a), ctx.worldOf(b), ctx.worldOf(c))
        if (!got.ok) return { status: "cannot-measure", law, reason: got.reason }
        const residual = got.radians * 180 / Math.PI - t.degrees
        return Math.abs(residual) <= 1e-6 ? { status: "valid" } : { status: "violation", law, residual }
    },
    propose(env) {
        capture.push(env)
        const [b, a, c] = termOf(env.law).references
        const vertex = env.worldOf(b), other = env.worldOf(c)
        const picked = selectAngle({ apex: vertex, axis: other.map((x, i) => x - vertex[i]),
            degrees: env.operation.request }, env.worldOf(a))
        const proposal = picked.ok ? { ok: true, world: picked.at, selection: picked.selection } : picked
        return fault ? fault(proposal, env, capture.length) : proposal
    },
    validate(env) {
        const [b, , c] = termOf(env.law).references
        return validateAngle(env.world, env.worldOf(b), env.worldOf(c), env.operation.request)
    },
})

const runThree = (fault, revision = false) => {
    const capture = [], scheduler = buildWorld()
    const source = "as B do\n  fw 1\nend\nlet A\nlet C=(3,0,0)\nlet distance(A,C)=45" +
        (revision ? "\nlet distance(A,C)=60" : "")
    const spec = fork("host", source)
    spec.env.scope.P = "A"
    for (const node of spec.code.ast.filter((n) => n.type === "Law" && n.value === "distance")) {
        node.value = FEATURE
        node.meta.subjects = ["P", "B", "C"]
        node.meta.movers = ["P"]
    }
    AUTHORED[FEATURE] = probeRow(capture, fault)
    try {
        const host = scheduler.hotSwapChild("host", spec)
        drive(scheduler, { maxTicks: 80 })
        return { scheduler, host, capture }
    } finally { delete AUTHORED[FEATURE] }
}

test("reach question: three roles, a bound alias and a headed reader cross the real publisher", () => {
    const { scheduler, host, capture } = runThree()
    assert.equal(host.error ?? host.unresolved ?? null, null)
    const [env] = capture
    const A = host.children.get("A"), B = host.children.get("B"), C = host.children.get("C")
    assert.ok(B.actorState && B.done, "B is a settled headed reader")
    assert.deepEqual(env.operation.movable, [A.id], "P resolved to A, not a display-name permission")
    assert.deepEqual(env.operation.held, [B.id, C.id])
    assert.deepEqual(env.law.expression.references, [B.id, A.id, C.id], "term roles are not mover order")
    assert.equal(env.operation.request, 45)
    assert.equal(env.operation.policy, "target-only", "three inputs do not imply three movers")
    assert.deepEqual(env.worldOf(B).position, undefined)
    assert.deepEqual(env.worldOf(B), [1, 0, 0])
    assert.equal(env.operation.snapshot.find((e) => e.id === A.id).live.position[0], 0)
    const a = A.transform.deref().position, b = B.transform.deref().position, c = C.transform.deref().position
    assert.ok(validateAngle(a, b, c, 45).ok)
    assert.deepEqual(b, [1, 0, 0])
    assert.deepEqual(c, [3, 0, 0])
    assert.equal(scheduler.laws.active().filter((law) => law.feature === FEATURE).length, 1)
    const changed = withPayload(env.law.expression, 60)
    assert.equal(changed, null, "the temporary row has retired; no invented fallback schema")
})

test("reach question: smuggling a finite edit for the held reader preserves the accepted prefix", () => {
    let previous, revision
    const result = runThree((proposal, env, calls) => {
        if (calls === 1) return proposal
        previous = [...env.worldOf(env.target)]
        return { ...proposal, worlds: new Map([[env.operation.movable[0], proposal.world],
            [env.operation.held[0], [9, 0, 0]]]) }
    }, true)
    const { scheduler, host } = result
    assert.equal(host.error.kind, "rejected")
    const law = scheduler.laws.active().find((law) => law.feature === FEATURE)
    assert.equal(law.expression.degrees, 45)
    assert.deepEqual(host.children.get("A").transform.deref().position, previous)
    assert.deepEqual(host.children.get("B").transform.deref().position, [1, 0, 0])
    assert.equal(scheduler.root._motionRevision, 3, "B's walk, C's pin and the accepted angle only")
})
