// Ordered query-local incidence: exact row order, explicit selector, identity keys,
// one contribution per row, captured-snapshot lifetime. (D058)
import { test } from "node:test"
import assert from "node:assert/strict"
import { bindLaw } from "../../../assets/js/turtling/laws/replacement.js"
import { bindWorld, indexByIdentities, pointQuery, pointSubjects, boundParticipants, makeDistanceTerm } from "../../../assets/js/turtling/laws/authored.js"

const law = (a, b, line) => bindLaw({ feature: "distance", endpoints: [a, b], scope: "s", frame: "s",
    predicate: 5, expression: makeDistanceTerm([a, b], 5), owner: { line } })
const owners = (xs) => xs.map((x) => x.owner.line)

test("index keeps exact input order and row references", () => {
    const laws = [law(1, 2, 1), law(2, 3, 2), law(1, 3, 3)]
    const index = indexByIdentities(laws, pointSubjects)
    assert.deepEqual(owners(index.get(1)), [1, 3])
    assert.deepEqual(owners(index.get(2)), [1, 2])
    assert.strictEqual(index.get(1)[0], laws[0])
    assert.strictEqual(index.get(1)[1], laws[2])
})

test("selector determines selected memberships", () => {
    const laws = [law(1, 2, 1), law(2, 3, 2)]
    const byPoint = indexByIdentities(laws, pointSubjects)
    const byReady = indexByIdentities(laws, boundParticipants)
    for (const row of laws) for (const id of row.endpoints) {
        assert.ok(byPoint.get(id)?.includes(row), `point membership ${id}`)
        assert.ok(byReady.get(id)?.includes(row), `readiness membership ${id}`)
    }
    const byFirstEndpoint = indexByIdentities(laws, (row) => [row.endpoints[0]])
    assert.deepEqual(owners(byFirstEndpoint.get(1)), [1])
    assert.deepEqual(owners(byFirstEndpoint.get(2)), [2])
    assert.equal(byFirstEndpoint.get(3), undefined)
})

test("one row contributes once when both identities are equal", () => {
    const self = law(1, 1, 9)
    const index = indexByIdentities([self], pointSubjects)
    assert.equal(index.get(1).length, 1)
    assert.strictEqual(index.get(1)[0], self)
})

test("typed identity keys stay distinct", () => {
    const mixed = { feature: "unknown", endpoints: [1, "1"], owner: { line: 4 } }
    const index = indexByIdentities([mixed], (row) => row.endpoints)
    assert.equal(index.get(1).length, 1)
    assert.equal(index.get("1").length, 1)
    assert.strictEqual(index.get(1)[0], mixed)
    assert.strictEqual(index.get("1")[0], mixed)
})

test("geometrically duplicate rows retain both owners", () => {
    const first = law(1, 2, 1)
    const second = law(1, 2, 7)
    const index = indexByIdentities([first, second], pointSubjects)
    assert.deepEqual(owners(index.get(1)), [1, 7])
    assert.notStrictEqual(index.get(1)[0], index.get(1)[1])
})

test("the index is a captured snapshot, not a live view", () => {
    const first = law(1, 2, 1)
    const second = law(2, 3, 2)
    const active = [first]
    const index = indexByIdentities(active, pointSubjects)
    active.push(second)
    assert.equal(index.get(3), undefined, "old index does not grow with the source array")
    const fresh = indexByIdentities(active, pointSubjects)
    assert.deepEqual(owners(fresh.get(3)), [2])
})

test("the index retains rows, while pointQuery resolves live values per query", () => {
    const row = law(1, 2, 1)
    const index = indexByIdentities([row], pointSubjects)
    const positions = new Map([[1, [0, 0, 0]], [2, [5, 0, 0]]])
    const ctx = bindWorld((id) => id, {
        live: (f) => ({ position: [...(positions.get(f.id ?? f) ?? [0, 0, 0])] }),
        placement: (f) => ({ position: [...(positions.get(f.id ?? f) ?? [0, 0, 0])] }),
    })
    const centre = () => pointQuery(2, index, { ...ctx, writerId: 2 })
        .contributions.find((c) => c.feature === "distance").set.center
    assert.deepEqual(centre(), [0, 0, 0])
    positions.set(1, [3, 0, 0])
    assert.deepEqual(centre(), [3, 0, 0], "same index row, fresh point set")
})
