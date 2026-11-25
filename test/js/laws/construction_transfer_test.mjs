// Core transfer witnesses: real hand edits, portable values, independent worlds.
// This is not a mounted capture/network/Keep journey. (id:laws-construction-input)
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, worldOf } from "./harness.mjs"
import { worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { toLocalPoint, toWorldPoint } from "../../../assets/js/turtling/localize.js"

const near = (actual, expected) => assert.ok(
    Math.hypot(...actual.map((value, i) => value - expected[i])) < 1e-8,
    `${actual} != ${expected}`,
)
const roundTrip = (value) => JSON.parse(JSON.stringify(structuredClone(value)))
const realize = (source, choices = null, key = "coreshell:sender") => {
    const scheduler = buildWorld()
    const options = choices === null ? {} : { choices }
    const host = scheduler.hotSwapChild(key, fork(key, source), options)
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    return { scheduler, host, key, source }
}
const snapshot = ({ scheduler, host, source }) => roundTrip({
    source,
    choices: {
        v: 1,
        inputs: scheduler.handChoices(host).map(({ names, action }) => ({
            route: { root: "document", names },
            action,
        })),
    },
})
const move = ({ scheduler }, frame, world) => {
    const pose = { ...frame.transform.deref(), position: toLocalPoint(worldTransform(frame), world) }
    assert.equal(scheduler.requestMotion(frame, pose, scheduler.motionRevision).kind, "accept")
}
const rebuild = (world, source = world.source) => {
    world.source = source
    world.host = world.scheduler.hotSwapChild(world.key, fork(world.key, source), { fresh: true })
    drive(world.scheduler)
    assert.deepEqual(world.scheduler.errors, [])
    return world.host
}
const point = (world, name = "a") => world.host.children.get(name)

for (const fixture of [
    { kind: "translation", source: "goto 5 0\nlet a", destination: () => [5, 3, 0] },
    { kind: "sphere", source: "let a\nlet a.distance = 5", destination: () => [0, 5, 0] },
    { kind: "circle", source: "let a\nlet a.distance = 5\nlet a.z = 0", destination: () => [0, 5, 0] },
    {
        kind: "cone", source: "goto 5 1 0\nlet a\nlet a.tilt = 30",
        destination: (baseline) => [baseline[0] + 2, 0, (baseline[0] + 2) * Math.tan(Math.PI / 6)],
    },
]) {
    test(`${fixture.kind}: an actual accepted hand choice survives clone/JSON and a fresh foreign root`, () => {
        const sender = realize(fixture.source)
        const baseline = worldOf(point(sender))
        const destination = fixture.destination(baseline)
        move(sender, point(sender), destination)
        near(worldOf(point(sender)), destination)

        const value = snapshot(sender)
        assert.equal(value.choices.inputs[0].action.kind, fixture.kind)
        const receiver = realize(value.source, value.choices, "outershell:receiver#1")
        assert.notEqual(point(sender), point(receiver))
        assert.notEqual(point(sender).id, point(receiver).id)
        near(worldOf(point(receiver)), destination)
        near(toWorldPoint(worldTransform(point(receiver)), receiver.scheduler.handHome(point(receiver)).position), baseline)

        rebuild(receiver)
        near(worldOf(point(receiver)), destination)
        near(worldOf(point(sender)), destination)
    })
}

test("an accepted tiny adjustment is not erased as identity during transfer", () => {
    const sender = realize("let a")
    move(sender, point(sender), [0, 1e-11, 0])
    const value = snapshot(sender)
    assert.deepEqual(value.choices.inputs[0].action.by, [0, 1e-11, 0])
    const receiver = realize(value.source, value.choices, "outershell:tiny")
    assert.deepEqual(worldOf(point(receiver)), [0, 1e-11, 0])
    rebuild(receiver)
    assert.deepEqual(worldOf(point(receiver)), [0, 1e-11, 0])
})

test("a receiver can play, inherit later offers, rebase source, and pass its choice onward", () => {
    const sender = realize("goto 5 0\nlet a\nlet b")
    move(sender, point(sender), [5, 3, 0])
    move(sender, point(sender, "b"), [5, 2, 0])
    const received = snapshot(sender)
    const receiver = realize(received.source, received.choices, "outershell:receiver")

    move(receiver, point(receiver), [5, 4, 0])
    near(worldOf(point(sender)), [5, 3, 0])
    move(sender, point(sender), [5, 6, 0])
    move(sender, point(sender, "b"), [5, 7, 0])
    assert.equal(receiver.scheduler.offerChoices(receiver.host, snapshot(sender).choices).kind, "accept")
    near(worldOf(point(receiver)), [5, 4, 0])
    near(worldOf(point(receiver, "b")), [5, 7, 0])

    rebuild(receiver, "goto 10 0\nlet a\nlet b")
    near(worldOf(point(receiver)), [10, 4, 0])
    near(worldOf(point(receiver, "b")), [10, 7, 0])
    const continued = snapshot(receiver)
    const local = continued.choices.inputs.find(({ route }) => route.names[0] === "a")
    assert.deepEqual(local.action, { kind: "translation", by: [0, 4, 0] })
    const third = realize(continued.source, continued.choices, "coreshell:third#2")
    near(worldOf(point(third)), [10, 4, 0])
    near(worldOf(point(third, "b")), [10, 7, 0])
    near(worldOf(point(sender)), [5, 6, 0])
})

test("quoted route elements remain distinct from a nested participant across transfer", () => {
    const source = 'goto 5 0\nlet "p/q"\nas p do\n  let q\nend'
    const sender = realize(source)
    move(sender, point(sender, "p/q"), [5, 3, 0])
    const value = snapshot(sender)
    assert.deepEqual(value.choices.inputs[0].route.names, ["p/q"])

    const receiver = realize(source, value.choices, "outershell:receiver#quoted")
    near(worldOf(point(receiver, "p/q")), [5, 3, 0])
    near(worldOf(point(receiver, "p").children.get("q")), [5, 0, 0])
    rebuild(receiver)
    near(worldOf(point(receiver, "p/q")), [5, 3, 0])
    near(worldOf(point(receiver, "p").children.get("q")), [5, 0, 0])
})

test("a local identity mask flattens to an empty standalone offer, not an inheritance chain", () => {
    const sender = realize("goto 5 0\nlet a")
    move(sender, point(sender), [5, 3, 0])
    const value = snapshot(sender)
    const receiver = realize(value.source, value.choices, "outershell:receiver")

    move(receiver, point(receiver), [5, 0, 0])
    const continued = snapshot(receiver)
    assert.deepEqual(continued.choices, { v: 1, inputs: [] })
    const third = realize(continued.source, continued.choices, "coreshell:third")
    near(worldOf(point(third)), [5, 0, 0])

    move(sender, point(sender), [5, 6, 0])
    assert.equal(receiver.scheduler.offerChoices(receiver.host, snapshot(sender).choices).kind, "unchanged")
    near(worldOf(point(receiver)), [5, 0, 0])
    rebuild(receiver)
    near(worldOf(point(receiver)), [5, 0, 0])
})
