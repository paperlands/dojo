// Play a PaperLang program on a canvas (D030)
import { Turtle } from "./turtling/turtle.js"
import { completionOf, createRunWatch, halt, refuse } from "./turtling/run.js"
import { projectPoint, unprojectRay } from "./turtling/view_snapshot.js"

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

function publicAnswer(answer) {
    if (answer.kind !== 'value') return Object.freeze({ ...answer })
    const value = answer.value
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

function sameAnswer(a, b) {
    if (!a || a.kind !== b.kind || a.message !== b.message) return false
    if (Array.isArray(a.value) && Array.isArray(b.value))
        return a.value.length === b.value.length && a.value.every((value, i) => Object.is(value, b.value[i]))
    return Object.is(a.value, b.value)
}

export function createWorld(canvas, { caps, law, interactive = false } = {}) {
    // `law` is the lab seam (id:laws-build-p0); interaction is explicitly opt-in.
    const turtle = new Turtle(canvas, { caps, law, interactive })
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
    }


    return {
        async play(program) {
            if (disposed) throw halt("disposed")
            const gen = ++generation
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
            const run = {
                settled: false,
                resolve: value => { finishReject = null; resolve(value) },
                reject: error => { finishReject = null; reject(error) },
            }
            finishReject = run.reject
            watch.begin(run)
            watch.look()
            return { finished, commandCount: result.commandCount }
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
