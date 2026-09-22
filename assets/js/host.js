// host-v1 SPIKE — a program and a canvas, and nothing else.
//
// Disposable: this file exists to falsify or confirm the producer boundary (G1)
// before any manifest, pin script, or fallback wiring is written. It is not v1.
//
// NOT here yet: the beat channel from playback (the runtime carries node.span.line,
// so it is threadable), seat() resolution at the end of a finite performance,
// manifest, conformance fixtures.
import { Turtle } from "./turtling/turtle.js"

export function createHatch(canvas, { onBeat } = {}) {
    const turtle = new Turtle(canvas)
    let disposed = false
    return {
        async seat(program) {
            if (disposed) throw new Error("hatch disposed")
            const result = await turtle.upsertAmbient("host", "host", program, { hatch: true, fresh: true })
            if (!result || result.success !== true) {
                const wound = result && result.wounds && result.wounds[0]
                throw new Error(wound ? wound.message : "program failed")
            }
            return result
        },
        dispose() {
            if (disposed) return
            disposed = true
            turtle.dispose?.()
        },
    }
}
