// Frame — the spatial scope primitive.
//
// A frame is a named coroutine with spatial hierarchy:
// identity (id, name), tree (parent, children), spatial scope (origin, transform),
// execution (generator, resumeAt, done), communication (channel).
//
// The scheduler attaches lifecycle metadata (error, commandCount, actorState,
// targetFrame) as needed — bookkeeping, not part of the primitive contract.

import { SE3 } from "./se3.js"
import { createAtom } from "./atom.js"
import { createRingBuffer } from "./ring-buffer.js"

let _nextId = 0

export function createFrame(name, generator, opts = {}) {
    return {
        // Identity
        id: ++_nextId,
        name,

        // Tree
        parent: opts.parent || null,
        children: new Map(),

        // Spatial
        origin: opts.origin || null,                          // parent's SE3 at birth (immutable)
        transform: createAtom(opts.transform || SE3.identity()),  // local pose (evolving)

        // Execution
        generator,
        resumeAt: 0,
        done: false,

        // Communication
        channel: createRingBuffer(opts.channelCapacity || 4096),
    }
}
