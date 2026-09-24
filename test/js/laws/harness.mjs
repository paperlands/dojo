// Shared harness for the Phase 0 law probes. One fork, one world, one drive,
// one trace — the probes should read as one story, not six copies.
import { createScheduler, metaRoot, frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

export const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
export const IDENT = SE3.identity()
export const at = (x, y = 0) => ({ rotation: IDENT.rotation, position: [x, y, 0] })

export function fork(name, src, origin = IDENT) {
    return {
        name, origin, frame: null,
        style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
        code: { ast: parseProgram(src), functions: {} },
        env: { userspace: new Map(), loopCounter: 0, scope: {} },
    }
}

export function buildWorld({ admit, admitAsync, validate, observeGoto = false, refusalStroke, capacity = 64, strokeMax = 1 } = {}) {
    return createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax, breathEvery: 1 },
        channelCapacity: capacity,
        motionAdmission: admit,
        motionAdmissionAsync: admitAsync,
        motionValidate: validate,
        observePureGoto: observeGoto,
        refusalStroke,
        onShout: () => {},
    })
}

export const world = (name, scheduler) => {
    const frame = scheduler.root.children.get(name)
    return frame && frameWorldTransform(frame).position
}

export const nz = (v) => v.map((n) => (n === 0 ? 0 : n))   // fold -0 from rotateVec

// Drive ticks, draining each child's channel into a per-name trace.
export function drive(scheduler, { maxTicks = 40, after } = {}) {
    const trace = new Map()
    for (let i = 0; i < maxTicks && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        for (const frame of scheduler.registry.values()) {
            if (frame === scheduler.root) continue
            if (!trace.has(frame.name)) trace.set(frame.name, [])
            trace.get(frame.name).push(...frame.channel.drain())
        }
        if (after) after(i)
    }
    return trace
}

export const ends = (trace, name) =>
    (trace.get(name) ?? []).filter((e) => e.type === "path").map((p) => p.points.at(-1))

// The analytic distance hand: A -> 1, B -> 6 (|AB| = 5), B's placement at 5.
export function componentResponder(record, { aName = "a", bName = "b" } = {}) {
    return ({ command, from, requested, frame }) => {
        record?.push({ actor: frame.name, command, from: [...from.position], requested: [...requested.position] })
        if (frame.name !== aName) return { accepted: true, transform: requested }
        const b = frame.parent.children.get(bName)
        if (!b?.batch) return { accepted: true, transform: requested }
        const accepted = { rotation: requested.rotation, position: [1, 0, 0] }
        const origin = b.origin.position
        const localB = { rotation: b.batch.transform.rotation, position: [6 - origin[0], -origin[1], -origin[2]] }
        return { accepted: true, transform: accepted, component: [{ frame: b, transform: localB }] }
    }
}

// One deferred per motion request; beyond `defer` calls, answer at once.
export function delayedResponder({ defer = Infinity } = {}) {
    const calls = []
    let seen = 0
    const admit = (request) => {
        if (seen++ >= defer) return { accepted: true, transform: request.requested }
        let resolve, reject
        const promise = new Promise((res, rej) => { resolve = res; reject = rej })
        calls.push({ request, resolve, reject })
        return promise
    }
    return { calls, admit }
}

export const settle = () => new Promise((done) => setImmediate(done))
export const accept = (x) => ({ accepted: true, transform: { rotation: IDENT.rotation, position: [x, 0, 0] } })
