// A move means EVERY sample it carries.
//
// A browser coalesces the real sub-frame pointer path into one `pointermove`, so a
// handler that reads only `clientX/clientY` samples at the display rate and a fast
// circle becomes a polygon. The expansion and the feed loop live in the gesture — the
// pure state machine, testable without a browser — instead of the DOM handler.
//
// (id:laws-figures-phase34-intent)
//
// Run: node --test test/js/laws/pointer_samples_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { pointerSamples, moveGesture } from "../../../assets/js/turtling/laws/gesture.js"

// A DOM-shaped event: the coalesced samples are the ones a browser buffered between
// frames; the outer fields are the newest, which is all a naive handler would see.
const pointerEvent = (samples, { pointerId = 7, x = 9, y = 9 } = {}) => ({
    pointerId, clientX: x, clientY: y,
    getCoalescedEvents: () => samples,
})

test("every coalesced sample is a move, not just the last", () => {
    const event = pointerEvent([
        { pointerId: 7, clientX: 10, clientY: 0 },
        { pointerId: 7, clientX: 11, clientY: 1 },
        { pointerId: 7, clientX: 12, clientY: 4 },
    ])
    const fed = []
    moveGesture({ pointerMove: (p) => { fed.push([p.x, p.y]); return {} } }, event)
    assert.deepEqual(fed, [[10, 0], [11, 1], [12, 4]],
        "a fast drag keeps its sub-frame path instead of collapsing to a polygon")
})

test("no coalescing support, or an empty list, still moves once", () => {
    const plain = { pointerId: 7, clientX: 3, clientY: 5 }
    const fed = []
    moveGesture({ pointerMove: (p) => { fed.push([p.x, p.y]); return {} } }, plain)
    moveGesture({ pointerMove: (p) => { fed.push([p.x, p.y]); return {} } }, pointerEvent([]))
    assert.deepEqual(fed, [[3, 5], [9, 9]], "the event itself is the sample of last resort")
    assert.deepEqual(pointerSamples(plain), [plain])
})

test("a cancellation anywhere in the batch is not lost", () => {
    const event = pointerEvent([
        { pointerId: 7, clientX: 1, clientY: 0 },
        { pointerId: 7, clientX: 2, clientY: 0 },
    ])
    let calls = 0
    const cancelled = moveGesture({
        pointerMove: () => { calls++; return calls === 2 ? { cancelled: true } : {} },
    }, event)
    assert.equal(cancelled, true, "the later sample's verdict wins — the held frame is dropped")
})
