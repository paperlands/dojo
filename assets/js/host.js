// Play a PaperLang program on a canvas (D030)
import { Turtle } from "./turtling/turtle.js"

export function createHatch(canvas, { caps, law } = {}) {
    // `law` is the lab seam (id:laws-build-p0); the door itself stays play/finished.
    const turtle = new Turtle(canvas, { caps, law })
    let disposed = false
    let generation = 0
    let finishReject = null

    function supersede() {
        const reject = finishReject
        finishReject = null
        reject?.(new Error("superseded"))
    }

    function refuse(wound) {
        const line = wound?.span?.line
        const message = wound
            ? (line ? `${wound.message} (line ${line})` : wound.message)
            : "program failed"
        const err = new Error(message)
        if (wound) err.wound = wound
        return err
    }

    return {
        async play(program) {
            if (disposed) throw new Error("hatch disposed")
            const gen = ++generation
            supersede()
            const result = await turtle.upsertAmbient("host", "host", program, { hatch: true, fresh: true })
            if (disposed || generation !== gen) throw new Error("hatch disposed")
            if (!result || result.success !== true) {
                const wound = result && result.wounds && result.wounds[0]
                throw refuse(wound)
            }
            let resolve
            let reject
            const finished = new Promise((res, rej) => { resolve = res; reject = rej })
            finishReject = reject
            const settle = () => {
                if (disposed || generation !== gen) return
                if (!turtle.scheduler?.done) return
                finishReject = null
                resolve({ commandCount: turtle.scheduler.commandCount })
            }
            const prev = turtle.onProgress
            turtle.onProgress = (p) => {
                prev?.(p)
                if (p?.phase === "settled") settle()
            }
            settle()
            return { finished, commandCount: result.commandCount }
        },
        // The beat is a second milestone, never a constructor option (D030).
        // `onLine` reads the line the walk is on, in logical time. (id:host-beat)
        onLine(fn) {
            turtle.onBeat = typeof fn === "function" ? fn : null
        },

        dispose() {
            if (disposed) return
            disposed = true
            generation++
            const reject = finishReject
            finishReject = null
            reject?.(new Error("hatch disposed"))
            turtle.dispose?.()
        },
    }
}
