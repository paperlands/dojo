import { readFileSync } from 'node:fs'

// Replace only the browser owner. Parser, scheduler, readouts and host are real.
const harnessURL = new URL('../laws/harness.mjs', import.meta.url).href
const turtleURL = 'data:text/javascript,' + encodeURIComponent(`
import { buildWorld, fork } from ${JSON.stringify(harnessURL)}
export class Turtle {
    static instances = []
    constructor(canvas, options) {
        this.options = options
        this.scheduler = buildWorld({ strokeMax: 0, breathEvery: 1000 })
        Turtle.instances.push(this)
    }
    upsertAmbient(key, name, source, options) {
        this.scheduler.hotSwapChild(key, fork(name, source), options)
        this.advance(0)
        return { success: !this.scheduler.errors.length,
            wounds: this.scheduler.errors, commandCount: this.scheduler.commandCount }
    }
    advance(now) {
        this.scheduler.tick(now)
        for (const frame of this.scheduler.registry.values()) frame.channel.drain()
        this.onProgress?.({ phase: this.scheduler.done ? 'settled' : 'walking' })
    }
    readScalar(...args) { return this.scheduler.readScalar(...args) }
    readPlace(...args) { return this.scheduler.readPlace(...args) }
    proposePlace(name, position) {
        return this.scheduler.proposePlace(name, position, this.scheduler.motionRevision)
    }
    onAcceptedChange(fn) { return this.scheduler.onAcceptedChange(fn) }
    dispose() { this.disposeCount = (this.disposeCount ?? 0) + 1; this.scheduler.removeChild('host') }
}`)
const { Turtle } = await import(turtleURL)
const hostURL = new URL('../../../assets/js/host.js', import.meta.url)
const runURL = new URL('../../../assets/js/turtling/run.js', import.meta.url).href
const source = readFileSync(hostURL, 'utf8')
    .replace('"./turtling/turtle.js"', JSON.stringify(turtleURL))
    .replace('"./turtling/run.js"', JSON.stringify(runURL))
export const { createWorld } = await import('data:text/javascript,' + encodeURIComponent(source))
export function headlessWorld(options) {
    const world = createWorld({}, options)
    return { world, turtle: Turtle.instances.at(-1) }
}
