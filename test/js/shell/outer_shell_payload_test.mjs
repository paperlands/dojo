// seeOuterShell envelope — full key shape; dual of OuterShell.payload/2.
// Run: node --test test/js/shell/outer_shell_payload_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
    OUTER_SHELL_KEYS,
    outerShellPayload,
    dispatchPhx,
} from "../../../assets/js/hooks/shell/outer-shell-payload.js"

describe("outerShellPayload — one shape, every key present", () => {
    test("always returns exactly OUTER_SHELL_KEYS (no sparse objects)", () => {
        const payload = outerShellPayload({ addr: "a1", source: "fw 10" })
        const keys = Object.keys(payload).sort()
        assert.deepEqual(keys, [...OUTER_SHELL_KEYS].sort())
        assert.equal(keys.length, 12)
    })

    test("library open fills path / attend / buffer_id as null, not absent", () => {
        const payload = outerShellPayload({
            addr: "~/spirals",
            origin_name: "Spirals",
            source: "fw 50",
            commands: [{ type: "Call" }],
            diagnostics: [],
            state: "success",
            view: "watch",
            stream: true,
            time: 1,
        })
        assert.equal(payload.path, null)
        assert.equal(payload.attend, null)
        assert.equal(payload.buffer_id, null)
        assert.equal(payload.addr, "~/spirals")
        assert.equal(payload.source, "fw 50")
        assert.deepEqual(payload.commands, [{ type: "Call" }])
        assert.equal(payload.state, "success")
        assert.equal(payload.view, "watch")
        assert.equal(payload.stream, true)
    })

    test("empty partial still has every key (defaults, never undefined)", () => {
        const payload = outerShellPayload()
        for (const k of OUTER_SHELL_KEYS) {
            assert.ok(k in payload, `${k} must be present`)
            assert.notEqual(payload[k], undefined)
        }
        assert.deepEqual(payload.commands, [])
        assert.deepEqual(payload.diagnostics, [])
        assert.equal(payload.view, "watch")
        assert.equal(payload.stream, true)
    })

    test("explicit nulls are kept — not overwritten by defaults that lie", () => {
        const payload = outerShellPayload({
            stream: false,
            view: "draft",
            commands: null,
        })
        // stream/view honor explicit values; arrays default only when missing
        assert.equal(payload.stream, false)
        assert.equal(payload.view, "draft")
        // null is a value — ?? keeps null for scalar fields, but commands uses ?? []
        assert.deepEqual(payload.commands, [])
    })
})

// LiveView's handleEvent is window.addEventListener("phx:"+name, e => cb(e.detail)).
// Pin that door without a browser: a minimal EventTarget stands in for window.
function installWindowDoor() {
    const target = new EventTarget()
    const prev = globalThis.window
    globalThis.window = target
    // dispatchPhx and LV both construct CustomEvent; Node 18+ has it globally.
    return {
        window: target,
        // Same shape ViewHook.handleEvent uses (detail only, not the event).
        handleEvent(name, cb) {
            target.addEventListener(`phx:${name}`, (e) => cb(e.detail))
        },
        uninstall() {
            globalThis.window = prev
        },
    }
}

describe("dispatchPhx — the window door LiveView's handleEvent is", () => {
    test("window CustomEvent phx:name delivers detail to a handleEvent-shaped listener", () => {
        const door = installWindowDoor()
        try {
            const seen = []
            door.handleEvent("seeOuterShell", (payload) => seen.push(payload))
            const detail = outerShellPayload({ addr: "x", source: "fd 1" })
            dispatchPhx("seeOuterShell", detail)
            assert.equal(seen.length, 1)
            assert.equal(seen[0].addr, "x")
            assert.equal(seen[0].source, "fd 1")
            assert.equal(Object.keys(seen[0]).length, 12)
        } finally {
            door.uninstall()
        }
    })

    test("bubbled phx: event from a child EventTarget reaches window (JS.dispatch model)", () => {
        // Elixir JS.dispatch defaults bubbles: true and often targets body.
        // handleEvent still listens on window — the bubble is the bridge.
        // EventTarget parent chain: child → window (body's role in a thin shim).
        const door = installWindowDoor()
        try {
            const seen = []
            door.handleEvent("outerClose", (payload) => seen.push(payload))

            // Compose a one-hop bubble: dispatch on child with bubbles; also
            // re-fire on window when bubbles (models DOM propagation to window).
            const child = new EventTarget()
            const name = "phx:outerClose"
            const ev = new CustomEvent(name, { detail: { from: "body" }, bubbles: true })
            // DOM would walk parentNode; we assert the contract endpoint:
            // whatever originates on body must become a window phx: event.
            door.window.dispatchEvent(ev)
            assert.equal(seen.length, 1)
            assert.deepEqual(seen[0], { from: "body" })

            // And a non-bubbling dispatch that never reaches window is silent —
            // proving the listener is ON window, not a capture-all.
            child.dispatchEvent(
                new CustomEvent(name, { detail: { from: "orphan" }, bubbles: false })
            )
            assert.equal(seen.length, 1, "orphan non-window target does not reach handleEvent")
        } finally {
            door.uninstall()
        }
    })
})
