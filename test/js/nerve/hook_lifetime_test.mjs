import { test } from "node:test"
import assert from "node:assert/strict"
import NerveHook, { nerve, watchNerve } from "../../../assets/js/hooks/nerve.js"
import { installDom, makeEl } from "./dom-shim.mjs"

function hook() {
    return Object.assign(Object.create(NerveHook), {
        el: makeEl(),
        handleEvent(name, receive) { this.receive = receive },
    })
}

test("a reader can close the new Nerve in its seating fan", (t) => {
    t.after(installDom())
    const owner = hook()
    t.after(() => owner.destroyed())
    const seen = []
    t.after(watchNerve(() => {
        seen.push(nerve() !== null)
        if (nerve()) owner.destroyed()
    }))
    owner.mounted()
    assert.deepEqual(seen, [true, false])
    assert.equal(nerve(), null)
    assert.equal(owner.el.children.length, 0)
    assert.equal(owner.receive, undefined)
})

test("a late incumbent close retires only its own Nerve and callback", (t) => {
    t.after(installDom())
    const first = hook(), next = hook()
    t.after(() => { first.destroyed(); next.destroyed() })
    first.mounted()
    next.mounted()
    const oldPush = t.mock.method(first.nerve, "push", () => {})
    first.receive({ kind: "chat", msg: "superseded before teardown" })
    assert.equal(oldPush.mock.callCount(), 0)
    first.destroyed()
    assert.equal(nerve(), next.nerve)
    assert.equal(first.el.children.length, 0)
    assert.equal(next.el.children.length, 2)
    assert.doesNotThrow(() => first.receive({ kind: "chat", msg: "stale" }))
})
