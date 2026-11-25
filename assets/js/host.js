// Play a PaperLang program on a canvas (D030)
import { Turtle } from "./turtling/turtle.js"
import { completionOf, createRunWatch, halt, refuse } from "./turtling/run.js"
import { projectPoint, unprojectRay } from "./turtling/view_snapshot.js"
import { normalizeInput } from "./turtling/orbit.js"
import { isPath } from "./turtling/geometry.js"

export { projectPoint, unprojectRay }

// Copy a caller's key path once: a retained reading must not be retargetable.
// Frame paths never interpret '/', aliases or serialized execution addresses.
// (id:host-frame-paths)
function framePath(path) {
    if (!Array.isArray(path)) throw new TypeError('a frame target needs a path of string keys')
    const copy = Array.from(path)
    if (!copy.every(key => typeof key === 'string'))
        throw new TypeError('a frame target needs a path of string keys')
    return Object.freeze(copy)
}

function readingTarget(target, property) {
    if (property == null) {
        if (typeof target !== 'string') throw new TypeError('a named value needs a string name; a frame path needs a property')
        return target
    }
    if (typeof property !== 'string') throw new TypeError('a frame reading needs a property name')
    return framePath(target)
}

// A walk crosses as its places. A break is a new run; the path object stays inside.
// (id:path-a-walk-of-places)
function finitePlace(place) {
    return Array.isArray(place) && place.length === 3 && place.every(Number.isFinite)
}

function publicWalk(value) {
    if (!Array.isArray(value.runs)) return null
    const runs = []
    for (const run of value.runs) {
        if (!Array.isArray(run) || !run.every(finitePlace)) return null
        runs.push(Object.freeze(run.map(place => Object.freeze([place[0], place[1], place[2]]))))
    }
    return Object.freeze(runs)
}

function publicAnswer(answer) {
    if (answer.kind !== 'value') return Object.freeze({ ...answer })
    const value = answer.value
    if (isPath(value)) {
        const walk = publicWalk(value)
        if (!walk) return Object.freeze({ kind: 'unsupported', message: 'value is not a walk of finite places' })
        return Object.freeze({ kind: 'value', value: walk })
    }
    if (Array.isArray(value)) {
        const copy = [...value]
        if (!copy.every(Number.isFinite)) return Object.freeze({ kind: 'unsupported', message: 'value is not a finite vector' })
        return Object.freeze({ kind: 'value', value: Object.freeze(copy) })
    }
    if (value !== null && typeof value === 'number' && !Number.isFinite(value))
        return Object.freeze({ kind: 'unsupported', message: 'value is not finite' })
    if (value !== null && !['number', 'string', 'boolean'].includes(typeof value))
        return Object.freeze({ kind: 'unsupported', message: 'value is not a plain scalar' })
    return Object.freeze({ kind: 'value', value })
}

function samePlaces(a, b) {
    return a.length === b.length && a.every((place, i) =>
        place.length === b[i].length && place.every((n, k) => Object.is(n, b[i][k])))
}

function sameAnswer(a, b) {
    if (!a || a.kind !== b.kind || a.message !== b.message) return false
    if (Array.isArray(a.value) && Array.isArray(b.value)) {
        if (a.value.some(Array.isArray) || b.value.some(Array.isArray))
            return a.value.length === b.value.length && a.value.every((run, i) => samePlaces(run, b.value[i]))
        return a.value.length === b.value.length && a.value.every((value, i) => Object.is(value, b.value[i]))
    }
    return Object.is(a.value, b.value)
}

export function createWorld(canvas, { caps, law, interactive = false, input = null } = {}) {
    // `law` is the lab seam (id:laws-build-p0); interaction is explicitly opt-in.
    // `input` is refused here, before a Turtle or a WebGL context exists: a bad
    // page policy must cost nothing. (id:host-input-wheel)
    const policy = normalizeInput(input)
    const turtle = new Turtle(canvas, { caps, law, interactive, input: policy })
    let disposed = false
    let generation = 0
    let acceptedGeneration = 0
    let delivering = 0
    let finishReject = null
    const watch = createRunWatch(() => completionOf(turtle.scheduler, "host"))
    const readingDisposers = new Set()
    const retireReadings = () => {
        for (const off of readingDisposers) off()
        readingDisposers.clear()
    }
    turtle.onProgress = () => { if (!disposed) watch.look() }

    function supersede() {
        const reject = finishReject
        finishReject = null
        watch.clear()
        reject?.(halt("superseded"))
        turtle.compositor?.setHeld(false)
    }


    return {
        async play(program) {
            if (disposed) throw halt("disposed")
            const gen = ++generation
            // Let the current drive unwind before a reading can replace its play.
            if (delivering) {
                await undefined
                if (disposed) throw halt("disposed")
                if (generation !== gen) throw halt("superseded")
            }
            retireReadings()
            supersede()
            const result = await turtle.upsertAmbient("host", "host", program, { hatch: true, fresh: true })
            if (disposed) throw halt("disposed")
            if (generation !== gen) throw halt("superseded")
            if (!result || result.success !== true) {
                const wound = result && result.wounds && result.wounds[0]
                throw refuse(wound)
            }
            acceptedGeneration = gen
            let resolve
            let reject
            const finished = new Promise((res, rej) => { resolve = res; reject = rej })
            const settle = (deliver, value) => {
                if (finishReject === run.reject) {
                    finishReject = null
                    turtle.compositor?.setHeld(false)
                }
                deliver(value)
            }
            const run = {
                settled: false,
                resolve: value => settle(resolve, value),
                reject: error => settle(reject, error),
            }
            const setHeld = held => finishReject === run.reject && !(held && turtle.scheduler?.done)
                && (turtle.compositor?.setHeld(held) ?? false)
            finishReject = run.reject
            watch.begin(run)
            watch.look()
            return {
                finished, commandCount: result.commandCount,
                pause: () => setHeld(true), resume: () => setHeld(false),
                scrub: to => finishReject === run.reject && (turtle.scrub(to) ?? false),
            }
        },
        interaction: {
            read(place, property) {
                if (disposed) return publicAnswer({ kind: 'retired' })
                place = readingTarget(place, property)
                if (disposed) return publicAnswer({ kind: 'retired' })
                return publicAnswer(property == null ? turtle.readScalar(place) : turtle.readPlace(place, property))
            },
            propose(place, position) {
                if (disposed) return { kind: 'retired' }
                if (delivering) return { kind: 'busy' }
                const gen = generation
                place = framePath(place)
                if (disposed) return { kind: 'retired' }
                if (generation !== gen) return { kind: 'stale', message: 'source changed while resolving frame path' }
                return turtle.proposePlace(place, position)
            },
            subscribe(place, property, fn) {
                if (typeof property === 'function' && fn == null) { fn = property; property = null }
                if (disposed) return () => {}
                if (typeof fn !== 'function') throw new TypeError('subscription needs a callback')
                const gen = generation
                if (gen === 0 || acceptedGeneration !== gen)
                    throw new Error('play a program before subscribing')
                place = readingTarget(place, property)
                if (disposed) return () => {}
                if (generation !== gen) throw halt('superseded')
                let prior = null
                const deliver = () => {
                    const answer = publicAnswer(property == null
                        ? turtle.readScalar(place) : turtle.readPlace(place, property))
                    if (sameAnswer(prior, answer)) return
                    prior = answer
                    delivering++
                    try { fn(answer) } catch { /* notification is not acceptance */ }
                    finally { delivering-- }
                }
                const off = turtle.onAcceptedChange(deliver)
                const cleanup = () => {
                    readingDisposers.delete(cleanup)
                    off()
                }
                readingDisposers.add(cleanup)
                deliver()
                return cleanup
            },
        },
        // Events carry every walked occurrence since the previous logical joint.
        // Reading subscriptions deduplicate values; beats do not. (id:host-beat)
        onBeat(fn) {
            turtle.onBeat = typeof fn === "function" ? fn : null
        },

        // The last rendered frame's view: frozen data, content-local px. A
        // stored view does not move when the camera later does.
        // (id:host-embedding-slice-1-view)
        view: {
            snapshot() { return disposed ? null : turtle.lastView() },
            project(world) { return disposed ? null : projectPoint(turtle.lastView(), world) },
            unproject(x, y) { return disposed ? null : unprojectRay(turtle.lastView(), x, y) },
            // Request-only framing through the native centre: true when targets
            // were found and applied. No pose is returned, nothing is restored.
            fit() { return disposed ? false : turtle.fit() != null },
        },

        // One observer per rendered frame; `off` is immediate and a play
        // replacement keeps the subscription.
        onFrame(fn) {
            if (disposed) return () => {}
            return turtle.onViewFrame(fn)
        },

        // The one explicit wake verb: render at least one more frame.
        requestFrame() {
            if (disposed) return
            turtle.requestRender()
        },

        dispose() {
            if (disposed) return
            disposed = true
            generation++
            retireReadings()
            const reject = finishReject
            finishReject = null
            watch.clear()
            reject?.(halt("disposed"))
            turtle.onProgress = null
            turtle.dispose?.()
        },
    }
}
