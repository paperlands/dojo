import { test } from "node:test"
import assert from "node:assert/strict"
import { createScenePlayback } from "../../../assets/js/hooks/shell/scene-playback.js"
import { SELF, PEER } from "../../../assets/js/kernel/witness.js"

function bench() {
    const slot = (place, addr) => `${place}/${addr}`
    const law = {
        seatOf: (addr, place) => slot(place, addr),
        bindingsOf: (addr, place) => [{ root: "document", slot: slot(place, addr) }],
    }
    const frames = new Map(), calls = []
    let grant, outcome = "fresh", choiceSamples = 0, nextId = 0
    const turtle = {
        scheduler: { root: { children: frames } },
        upsertAmbient(key, name, code, options) {
            calls.push({ key, name, code, options })
            if (outcome === "refuse") return { success: false }
            if (options.fresh || outcome !== "green") frames.set(key, { id: ++nextId, run: 1 })
            options.preparePlay?.()
            return { success: outcome !== "fault" }
        },
        removeAmbient: key => frames.delete(key),
        light() {}, reflectGate() {},
        handLocalChoices() { choiceSamples++; return [] },
    }
    const stage = createScenePlayback(turtle, { law, grantOf: () => grant })
    const perform = (place, addr, options = {}) => {
        const { witness = SELF, ...run } = options
        stage.perform({ gone: [], runs: [{ slot: slot(place, addr), code: addr, name: addr, ...run }] }, { addr, witness })
    }
    const play = (place, addr) => ({ seat: slot(place, addr), ...frames.get(slot(place, addr)) })
    return { stage, perform, play, frames, calls, choiceSamples: () => choiceSamples,
        grant(place, addr) { grant = { place, addr } }, outcome(next) { outcome = next } }
}

test("both surfaces ask the same admission center without sharing a grant or recipe", () => {
    const b = bench()
    const core = b.stage.controls("core", () => "A")
    const outer = b.stage.controls("outer", () => "A")
    b.grant("core", "A")
    b.perform("core", "A", { code: "mine" })
    assert.equal(core.source(b.play("core", "A")), "mine")
    assert.equal(outer.authority(b.play("core", "A")), false)

    b.perform("outer", "A", { witness: PEER, code: "peer" })
    b.grant("outer", "A")
    assert.equal(core.authority(b.play("core", "A")), false)
    assert.equal(outer.prepareReplay(b.play("outer", "A")), null, "the grant does not admit the peer")
    b.outcome("fault")
    b.perform("outer", "A", { code: "draft" })
    assert.equal(outer.source(b.play("outer", "A")), "draft", "a newly admitted fault can restart")
    b.grant("core", "A")
    assert.equal(core.source(b.play("core", "A")), "mine", "same-address places do not overwrite each other")
})

test("prepare captures once; commit binds the new incarnation before the first slice", () => {
    const b = bench()
    const control = b.stage.controls("core", () => "A")
    b.grant("core", "A")
    b.perform("core", "A", { code: "run", vocab: "let a", choices: null })
    const old = b.play("core", "A")
    const restart = control.prepareReplay(old)
    assert.ok(restart)
    assert.equal(b.calls.length, 1, "preparation performs no seating")
    assert.equal(b.choiceSamples(), 1)
    let primed = 0
    assert.equal(restart(() => {
        primed++
        assert.equal(control.source(b.play("core", "A")), "run")
    }), true)
    assert.equal(primed, 1)
    assert.equal(b.choiceSamples(), 1, "commit does not recapture a different offer")
    const { options } = b.calls.at(-1)
    assert.equal(options.vocab, "let a")
    assert.deepEqual(options.choices, { v: 1, inputs: [] })
    assert.equal(restart(), false, "the earlier preparation cannot reset the successor")
})

test("green reuse updates a local recipe but never lends it to a peer using the same frame", () => {
    const b = bench()
    const control = b.stage.controls("outer", () => "A")
    b.grant("outer", "A")
    b.perform("outer", "A", { code: "initial" })
    const play = b.play("outer", "A")
    const restart = control.prepareReplay(play)
    b.outcome("refuse")
    b.perform("outer", "A", { code: "refused" })
    assert.equal(control.source(play), "initial")
    b.outcome("green")
    b.perform("outer", "A", { code: "reused" })
    assert.equal(control.source(play), "reused")
    assert.equal(restart(), false, "a newer recipe displaced the prepared value")
    b.perform("outer", "A", { witness: PEER, code: "reused" })
    assert.equal(control.prepareReplay(play), null, "the frame survived, the local admission did not")
})

test("a prepared restart refuses even when a replaced run retains its frame id", () => {
    const b = bench()
    const control = b.stage.controls("core", () => "A")
    b.grant("core", "A")
    b.perform("core", "A")
    const former = b.play("core", "A")
    const restart = control.prepareReplay(former)
    b.frames.get(former.seat).run++
    assert.equal(control.authority(b.play("core", "A")), false)
    assert.equal(restart(), false)
    assert.equal(b.calls.length, 1)
})

test("a companion cell cannot overwrite the document recipe in the same batch", () => {
    const b = bench()
    const control = b.stage.controls("core", () => "A")
    b.grant("core", "A")
    const root = { slot: control.seat().slot, name: "document", code: "root" }
    const cell = { slot: `${root.slot}/phase`, name: "phase", code: "cell" }
    b.stage.perform({ gone: [], runs: [root, cell] }, { addr: "A", witness: SELF })
    const play = b.play("core", "A")
    assert.equal(control.source(play), "root")
    assert.equal(control.prepareReplay(play)(), true)
    assert.equal(b.calls.at(-1).key, root.slot)
})
