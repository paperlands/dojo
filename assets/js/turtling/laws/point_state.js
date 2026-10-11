// The ONE point-state projection: reader binding, the point query, the eligibility/status
// inputs, and the state itself. WebGL-free, so the display and a behavioural witness read the
// SAME story from the SAME code — never a test-side reconstruction.
// (id:laws-decl-point-agent, id:laws-decl-interface, D058)
import { frameWorldTransform, worldTransform } from "../scheduler.js"
import { bindWorld, constraintsView, pointSubjects } from "./authored.js"
import { stateOf, heldIdentity, hasBody } from "./constraints.js"
import { exposed } from "./batch.js"

// A read pass borrows one unchanged model; discard it before mutation or yielding. (D058)
export function preparePointRead(scheduler) {
    let laws = null
    const states = new Map()
    const held = new Map()
    return (frame) => {
        if (!laws) {
            laws = new Map()
            for (const law of scheduler.laws.active()) {
                for (const id of new Set(pointSubjects(law))) {
                    if (!laws.has(id)) laws.set(id, [])
                    laws.get(id).push(law)
                }
            }
        }
        if (!states.has(frame)) states.set(frame, readPointState(frame, scheduler, laws, (id) => {
            if (!held.has(id)) held.set(id, heldIdentity(scheduler.registry.get(id), laws, scheduler.registry))
            return held.get(id)
        }))
        return states.get(frame)
    }
}

export function pointStateOf(frame, scheduler, active = null) {
    const laws = active ?? scheduler.laws.active()
    return readPointState(frame, scheduler, laws,
        (id) => heldIdentity(scheduler.registry.get(id), laws, scheduler.registry))
}

function readPointState(frame, scheduler, laws, heldOf) {
    const ctx = bindWorld((id) => scheduler.registry.get(id), {
        writerId: frame.id,
        // The display reads the committed live head and the stable placement — the same two
        // readings the solver wires, from its own sources. (id:laws-decl-interface)
        live: (f) => frameWorldTransform(f),
        placement: (f) => worldTransform(f),
        heldOf,
    })
    // ONE query, consumed together: the surviving records and the unavailable contributions
    // share a single interpretation. (D058)
    const view = constraintsView(frame.id, laws, ctx)
    return stateOf({
        at: frameWorldTransform(frame).position,
        headed: hasBody(frame),
        exposed: exposed(frame),
        isPlace: frame.isPlace === true,
        error: frame.error ?? null,
        // A failed attempt's hold is not an offer. The pin still draws (its previous state),
        // but it is not touchable until an edit releases it. (id:laws-activation-verdicts)
        unresolved: frame.unresolved ?? frame.held ?? null,
        // The query's UNAVAILABLE contributions travel to the view with their reasons: the
        // affordance never advertises freedom it has not established. (D058)
        unavailable: view.unavailable,
        constraints: view.constraints,
    })
}
