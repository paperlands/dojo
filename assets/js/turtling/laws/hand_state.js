// Sparse inputs belong to scoped slots; baselines belong to this run's frames.
// Neither a retained action nor a baseline grants publication rights. (id:laws-hand-action)
import { SE3 } from "../se3.js"
import { toLocalPose, toWorldPose, toLocalPoint, toWorldPoint } from "../localize.js"
import { freePoint } from "./batch.js"
import { pointQuery } from "./authored.js"
import { lawContext } from "./candidate.js"
import { meetAll, nearest } from "./meet.js"
import { actionBetween, interpretAction, copyAction } from "./action.js"

// Accepted state is classified EXACTLY, like an installation: a published 1e-11 edit is
// not a reset, not a no-op, and not identity. (id:laws-hand-action-state)
const identicalPosition = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const bodyless = frame => frame.isPlace === true && frame.generator == null && frame.actorState == null

export function createHandState(registry, world) {
    const actions = new Map()   // session-local choices; a present null is an identity MASK
    const offered = new Map()   // a held record's choices; never session intent
    let root = null                                      // discovered from the first slot; stable per world
    const slots = new WeakMap()
    // Partial ordinary-route reader: every nested edge must be the parent's real child,
    // and the top edge is the frame's actual registration key (the display name may differ).
    // An installation seat is deliberately not a child, so it yields no slot — never a
    // coincidental alias. (id:laws-hand-action-state)
    const slotOf = frame => {
        if (slots.has(frame)) return slots.get(frame)
        const path = []
        let node = frame
        while (node.parent?.parent) {
            if (node.parent.children.get(node.name) !== node) return null
            path.unshift(node.name)
            node = node.parent
        }
        const entry = node.parent && [...node.parent.children].find(([, child]) => child === node)
        if (!entry) return null
        root = node.parent
        const slot = JSON.stringify([entry[0], ...path])
        slots.set(frame, slot)
        return slot
    }
    const within = (key, scope) => key === scope || key.startsWith(`${scope.slice(0, -1)},`)
    // Local presence wins, including a null mask; absence inherits the held offer.
    const effective = (slot) => actions.has(slot) ? actions.get(slot) : offered.get(slot)
    // A slot's path is [top registration key, nested names...]. Nested children are keyed
    // by name (seatPlace/spawn); only the top level has a key apart from the display name.
    // Drop only what a SETTLED, HEALTHY parent proves absent; a failed or running run is
    // not evidence, and participation is not liveness. (id:laws-hand-action-state)
    const shouldPrune = ([key, ...names]) => {
        let node = root?.children.get(key)
        if (!node) return true                     // the seat itself is gone; forget() clears it
        for (const name of names) {
            const next = node.children.get(name)
            if (!next) return node.done === true && node.error == null && node.unresolved == null
            node = next
        }
        return registry.get(node.id) !== node || !bodyless(node)
    }
    const locusOf = (frame, laws, overrides) => {
        const q = pointQuery(frame.id, laws, lawContext(registry, overrides, world, { writerId: frame.id }))
        return q.complete ? meetAll(q.sets) : null
    }
    const home = frame => frame.handBase ?? frame.transform.deref()

    // A candidate is only a hand destination when it is bodyless and its pose already
    // speaks the supported convention. Slot probing stays inside that gate. (id:laws-hand-action-state)
    const eligible = entry => bodyless(entry.frame) && !(entry.stated && entry.ref !== 'world')

    function prepare(poses, laws) {
        if (!actions.size && !offered.size) return poses
        // No ELIGIBLE candidate carries a retained input: the source path is unchanged,
        // with no override map and no chart crossing. (id:laws-hand-action-state)
        const slots = poses.map(entry => eligible(entry) ? slotOf(entry.frame) : null)
        if (!slots.some((slot) => slot !== null && effective(slot) != null)) return poses
        // One sampled placement per entry; a stated-world pose crosses once and the same
        // unadjusted value feeds the override map and the output. (id:laws-hand-action-state)
        const sampled = poses.map((entry) => {
            const placement = world.transform(entry.frame)
            const pose = entry.stated && entry.ref === 'world' ? toLocalPose(placement, entry.pose) : entry.pose
            return { entry, placement, pose }
        })
        const overrides = new Map(sampled.map(({ entry, pose }) => [entry.frame, pose]))
        return sampled.map(({ entry, placement, pose }, i) => {
            if (slots[i] === null) return entry
            const action = effective(slots[i])
            if (action === undefined || action === null) return entry
            const basis = toWorldPose(placement, pose)
            const base = basis.position
            const locus = locusOf(entry.frame, laws, overrides)
            const wish = locus && interpretAction(action, locus, base, basis)
            const projected = wish?.ok && nearest(locus, wish.at, { keep: base })
            const placed = projected?.ok
                ? { rotation: pose.rotation, position: toLocalPoint(placement, projected.at) }
                : pose
            // The SAME evaluator that chose the pose reports what it actually did.
            const handOutcome = {
                kind: action.kind,
                interpreted: wish?.ok === true,
                projected: projected?.ok === true,
                reason: wish?.ok ? (projected?.ok ? null : 'unrealized') : (wish?.reason ?? 'locus'),
            }
            return entry.stated
                ? { ...entry, pose: toWorldPose(placement, placed), handBaseWorld: basis, handOutcome }
                : { ...entry, pose: placed, handBase: SE3.clone(pose), handOutcome }
        })
    }

    return {
        get size() { return actions.size + offered.size },
        home,
        prepare,
        // Source proposals choose from their unadjusted baseline, not yesterday's projection.
        // The producer, not the target slot, decides which reference it reads.
        selectionWorld(frame) {
            if (!frame?.handBase || !bodyless(frame)) return world
            return { ...world, read: (f, overrides) => world.read(f,
                f === frame && !overrides?.has(f) ? new Map([...(overrides ?? []), [f, frame.handBase]]) : overrides) }
        },
        // A frame that still carries retained input. It claims nothing about whether that input
        // can be expressed in the field the point now stands in. (id:laws-hand-action-state)
        hasInput(frame) {
            if (!frame || (!actions.size && !offered.size) || !bodyless(frame) || !frame.handBase) return false
            const slot = slotOf(frame)
            return slot !== null && effective(slot) != null
        },
        seed(frame) {
            if ((!actions.size && !offered.size) || !bodyless(frame)) return
            const slot = slotOf(frame)
            if (slot === null || effective(slot) == null) return
            const [entry] = prepare([{ frame, pose: frame.transform.deref() }], [])
            frame.handBase = entry.handBase
            frame.transform.swap(() => entry.pose)
        },
        // Prepare while the old geometry is still available; install only after the gate.
        // Reset is REQUEST intent, not coordinate equality: a clamped point can equal its
        // baseline without anyone asking to clear. (id:laws-hand-action, laws-hand-action-state)
        acceptance(request, verdict, laws) {
            const { frame, reset = false } = request
            if (!freePoint(frame) || !frame.address) return null
            const current = frame.transform.deref(), base = home(frame)
            if (!reset && identicalPosition(current.position, verdict.pose.position)) return null
            const placement = world.transform(frame)
            const basis = toWorldPose(placement, base)
            const overrides = new Map([[frame, verdict.pose], ...verdict.component.map(e => [e.frame, e.pose])])
            const locus = locusOf(frame, laws, overrides)
            const accepted = toWorldPoint(placement, verdict.pose.position)
            // A changed gesture back to the source baseline is a REAL local choice, not
            // reset intent and not a representation failure. It masks inheritance.
            const identity = !reset && locus != null && identicalPosition(basis.position, accepted)
            const action = reset || !locus || identity ? null : actionBetween(locus, basis.position, accepted, basis)
            const slot = slotOf(frame)
            // An unsupported route cannot key an input: the accepted move still publishes,
            // and the plan supplies the one reason. A null slot never touches the map.
            if (slot === null) return action && !reset ? { retention: "unsupported-route" } : null
            // Reset and an exact identity both leave a MASK: deleting would reveal an
            // inherited offer. A missing locus is not authored identity. (id:laws-construction-input)
            if (!action && !reset && !identity && !frame.handBase) return null
            return {
                install: () => {
                    if (action) {
                        actions.set(slot, action)
                        frame.handBase = SE3.clone(base)
                    } else if (reset || identity) {
                        actions.set(slot, null)
                        frame.handBase = null
                    } else {
                        actions.delete(slot)
                        frame.handBase = null
                    }
                },
                slot,
            }
        },
        forget(frame) {
            if (!actions.size && !offered.size) return
            const scope = slotOf(frame)
            if (scope === null) return
            for (const key of actions.keys()) if (within(key, scope)) actions.delete(key)
            for (const key of offered.keys()) if (within(key, scope)) offered.delete(key)
        },
        // A held record offers choices for ONE seat scope. Validate the whole offer
        // before replacing anything: a bad record admits nothing. (id:laws-construction-input)
        offerAt(key, inputs) {
            if (typeof key !== "string" || !key || !Array.isArray(inputs)) return false
            const scope = JSON.stringify([key])
            const next = []
            const seen = new Set()
            for (const entry of inputs) {
                if (!entry || !Array.isArray(entry.names) || entry.names.length === 0) return false
                if (!Array.from({ length: entry.names.length }, (_, i) => entry.names[i]).every((n) => typeof n === "string" && n.length > 0)) return false
                const action = copyAction(entry.action)
                if (!action) return false
                const slot = JSON.stringify([key, ...entry.names])
                if (seen.has(slot)) return false
                seen.add(slot)
                next.push([slot, action])
            }
            for (const slot of offered.keys()) if (within(slot, scope)) offered.delete(slot)
            for (const [slot, action] of next) offered.set(slot, action)
            return true
        },
        offer(frame, inputs) {
            const scope = slotOf(frame)
            if (scope === null) return false
            const key = JSON.parse(scope)[0]
            // A nested frame is not a seat: its path prefix must not be re-rooted at the top.
            return root?.children.get(key) === frame ? this.offerAt(key, inputs) : false
        },
        // Flatten effective choices for ONE seat (or an explicit slot scope). Masks and
        // absence are omitted; local overrides win and a foreign seat is not sampled.
        // (id:laws-construction-input)
        choices(scope = null) {
            if (!actions.size && !offered.size) return []
            // A string scope is an already-resolved JSON slot; a frame is typed.
            const keyScope = typeof scope === "string" ? scope : scope ? slotOf(scope) : null
            const prefix = keyScope ? JSON.parse(keyScope).length : 1
            if (scope && keyScope === null) return []
            const out = []
            for (const slot of new Set([...actions.keys(), ...offered.keys()])) {
                if (keyScope && !within(slot, keyScope)) continue
                const action = effective(slot)
                if (action == null) continue
                const copy = copyAction(action)
                if (!copy) continue
                const names = JSON.parse(slot).slice(prefix)
                out.push({ names, action: copy })
            }
            return out
        },
        // LOCAL overrides only, including null identity masks. This is what capture
        // merges over a held offer; it never reads the offered layer. (id:laws-construction-input)
        localChoices(scope = null) {
            if (!actions.size) return []
            const keyScope = typeof scope === "string" ? scope : scope ? slotOf(scope) : null
            const prefix = keyScope ? JSON.parse(keyScope).length : 1
            if (scope && keyScope === null) return []
            const out = []
            for (const [slot, action] of actions) {
                if (keyScope && !within(slot, keyScope)) continue
                if (action != null && !copyAction(action)) continue
                out.push({
                    names: JSON.parse(slot).slice(prefix),
                    action: action == null ? null : copyAction(action),
                })
            }
            return out
        },
        // A retained slot names a path, not a frame: resolve THAT path in the live tree.
        // Scope filters first, so an untouched seat makes no foreign scene walk; filtering
        // the retained keys themselves still costs their count. (id:laws-hand-action-state)
        prune(scope = null) {
            if (!actions.size || !root) return
            const keyScope = scope ? slotOf(scope) : null
            if (scope && keyScope === null) return   // unkeyable scope owns no retained path
            for (const [key] of actions) {
                if (keyScope && !within(key, keyScope)) continue
                if (shouldPrune(JSON.parse(key))) actions.delete(key)
            }
        },
    }
}
