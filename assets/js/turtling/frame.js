// Frame — one coroutine ambient: tree, pose, channel, park, ink bill.
// Prior: green thread / generator process — not a native OS thread.

import { SE3 } from "./se3.js"
import { createAtom } from "../kernel/observable.js"
import { createRingBuffer } from "./ring-buffer.js"
import { createInk } from "./ledger.js"

let _nextId = 0

export function createFrame(name, generator, opts = {}) {
    return {
        id: ++_nextId,
        name,

        parent: opts.parent || null,
        children: new Map(),

        origin: opts.origin || null,  // parent's SE3 at birth (immutable)
        transform: createAtom(opts.transform || SE3.identity()),  // local pose

        // Invalidated via Atom.watch on ancestor transforms.
        _worldCache: null,
        _worldDirty: true,

        generator,            // JS generator = the green-thread body
        resumeAt: 0,          // logical clock when a wait ends (D011)
        logicalBirth: opts.logicalBirth ?? null,  // parent clock at spawn; null at root
        done: false,

        ink: createInk(),  // bag; ledger owns the law (id:output-ledger-r3-stock-flow)

        // PARK — suspend mid-instant, like parking a thread mid-quantum.
        // Siblings must not advance past (instant law). cause: time|credit|residency.
        // null | { cause, owed, since }. Breath = park with nothing owed.
        // (id:output-ledger-r2-instant)
        park: null,

        // Lossless channel ≈ blocking queue (CSP/Go); full → credit park.
        channel: createRingBuffer(opts.channelCapacity || 4096, { lossless: opts.lossless !== false }),
        sync: {},      // conflating head/view slot — last-write-wins, no credit (D027 R2.5)
        mailbox: [],   // actor inbox (Hewitt/Erlang); see listensFor
    }
}
