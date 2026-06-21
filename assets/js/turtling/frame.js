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

        // Spatial cache — invalidated via Atom.watch on ancestor transforms
        _worldCache: null,
        _worldDirty: true,

        // Execution
        generator,
        resumeAt: 0,
        // Logical birth time: the parent's LOGICAL clock at spawn. A spawned child's
        // first wait anchors here (not wall-clock `now`) so it shares its parent's
        // logical grid — coincident events stay coincident (Decision 011, Fix A).
        // NULL means "unset": the frame anchors to the live `now` instead, which
        // self-corrects across resets/reruns. Top-level frames stay null (root has
        // no logical clock to inherit); only spawned children get a real birth.
        logicalBirth: opts.logicalBirth ?? null,
        done: false,

        // Communication
        channel: createRingBuffer(opts.channelCapacity || 4096),
        mailbox: [],
    }
}
