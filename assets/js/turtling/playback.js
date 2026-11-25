// The play, not the instrument. Readings are values; a hold is a lease number.
// Elapsed uses the scheduler's end stamp. Scoped facts walk the seat's subtree.
// Release compares the lease, not the slot. (id:nav-core-sill, id:host-run-pause)

// A seat's exhaustion, asked of the scheduler, not inferred. (id:nav-core-sill)
import { allDone } from './scheduler.js'

// Identity is the lease number, not the slot.
let LEASES = 0

const frameOf = (turtle, seat) => turtle?.scheduler?.root?.children?.get(seat) ?? null
const ownsFrame = (owner, frame) =>
    !!owner && owner.frame === frame && owner.run === frame.run

export const sameIncarnation = (a, b) => !!a && !!b && a.id === b.id && a.run === b.run

// This play's frames. Not the registry.
function walkPlay(frame, fn) {
    const stack = [frame]
    while (stack.length > 0) {
        const node = stack.pop()
        fn(node)
        for (const child of node.children.values()) stack.push(child)
        for (const record of node.installations?.values() ?? []) stack.push(record.frame)
    }
}

// What the runtime knows about this seat's play.
// Facts no seat owns. A seat may depict while these refuse a command. (id:nav-core-sill)
export function stageOf(turtle) {
    const scheduler = turtle?.scheduler
    return {
        alone: scheduler?.root?.children?.size === 1,
        end: scheduler?.end ?? null,
        done: (scheduler?.end ?? null) !== null,
        held: scheduler?.held === true,
        holdOwner: turtle?.compositor?.holdOwner ?? null,
    }
}

export function playOf(turtle, seat) {
    const scheduler = turtle?.scheduler
    const frame = scheduler?.root?.children?.get(seat) ?? null
    if (!frame) return null
    const stage = stageOf(turtle)
    // This play's completion, not the stage's.
    const exhausted = allDone(frame)
    let waited = false
    let fault = false
    walkPlay(frame, (node) => {
        if (node.elapsedTime > 0) waited = true
        if (exhausted && node.done && node.error) fault = true
    })
    return {
        seat,
        id: frame.id,
        run: frame.run,
        lease: ownsFrame(stage.holdOwner, frame) ? stage.holdOwner.id : null,
        // Seat facts. Stage facts do not decide what may be seen. (id:nav-core-sill)
        waited,
        fault,
        ms: Math.max(0, (stage.end ?? scheduler.lastTickTime) - frame.logicalBirth),
        alone: stage.alone,
        // Stage time. Do not stamp completion in a projection. (id:nav-core-sill)
        done: exhausted,
        phase: exhausted ? (fault ? 'fault' : 'finished')
            : stage.held ? 'paused' : 'running',
    }
}

// Incarnation only. No live frame crosses this boundary.
export function seatOf(turtle, seat) {
    const frame = frameOf(turtle, seat)
    return frame ? { id: frame.id, run: frame.run } : null
}

// Same incarnation, still alone. Asked at the command, not remembered from the paint.
export function currentPlay(turtle, play) {
    const frame = frameOf(turtle, play?.seat)
    if (!sameIncarnation(frame, play)) return false
    return turtle.scheduler.root.children.size === 1
}

// The one hold for this play. A finished or shared stage is refused here.
// Returns the lease number, or null. (id:host-run-pause)
export function holdPlay(turtle, play, standing = null) {
    const comp = turtle?.compositor
    const scheduler = turtle?.scheduler
    const frame = frameOf(turtle, play?.seat)
    if (!comp || !scheduler || !sameIncarnation(frame, play)) return null
    if (play.done || !play.alone || typeof comp.hold !== 'function') return null
    const witness = () => {
        if (standing && standing() !== true) return false
        const left = turtle.scheduler === scheduler && scheduler.root?.children
        return turtle.compositor === comp &&
            left?.size === 1 && left.get(play.seat) === frame &&
            frame.run === play.run && !scheduler.done
    }
    const token = { id: ++LEASES, seat: play.seat, frame, run: play.run, witness }
    return comp.hold(token) ? token.id : null
}

// Same slot is not identity. A predecessor's lease compares false.
export function releasePlay(turtle, lease) {
    const comp = turtle?.compositor
    const owner = comp?.holdOwner
    if (!owner || typeof lease !== 'number' || owner.id !== lease) return false
    return comp.releaseHold(owner)
}

export function holdsPlay(turtle, lease) {
    const owner = turtle?.compositor?.holdOwner
    return !!owner && typeof lease === 'number' && owner.id === lease
}

// Held by someone other than this lease. A command refuses before it changes
// the world. (id:host-run-pause)
export function foreignHold(turtle, lease) {
    const owner = turtle?.compositor?.holdOwner
    if (owner) return owner.id !== lease
    return turtle?.scheduler?.held === true
}

