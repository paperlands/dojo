import { asKind, kindOf } from '../mafs/tower.js'

const snapshot = value => Array.isArray(value)
    ? asKind(value.map(snapshot), kindOf(value)) : value

// Context is sampled at definition; live inputs get fresh intrinsic samples when
// their question changes. Capture never draws. (id:laws-reactive-randomness)
export function reactiveReading(initial, evaluate) {
    let samples = snapshot(initial.reads.samples)
    const context = new Map()
    const remember = inputs => {
        for (const [origin, name, value] of inputs) {
            if (origin !== 'scope' && origin !== 'constant') continue
            const key = `${origin}:${name}`
            if (!context.has(key)) context.set(key, snapshot(value))
        }
    }
    remember(initial.reads.inputs)
    const bind = (origin, name, provide) => {
        const key = `${origin}:${name}`
        return context.has(key) ? context.get(key) : provide()
    }
    const questionOf = reading => {
        const inputs = snapshot(reading.reads.inputs)
        if (reading.error) inputs.push(['failure', reading.error.name, reading.error.message])
        return inputs
    }
    const replay = () => {
        let index = 0
        return name => {
            const entry = samples[index++]
            return entry?.[0] === name ? entry[1] : (samples.find(s => s[0] === name)?.[1] ?? 0)
        }
    }
    return {
        initial: { question: questionOf(initial), value: initial.value },
        capture: () => {
            const reading = evaluate(replay(), bind)
            const absent = reading.reads.inputs.some(input =>
                (input[0] === 'external' && input[3] == null) ||
                ((input[0] === 'scope' || input[0] === 'constant') && input[2] == null))
            const domain = ['TowerRefusal', 'DomainRefusal'].includes(reading.error?.name)
            if (absent || (reading.error && !domain)) {
                throw reading.error ?? new Error('a driven input has no current value')
            }
            return questionOf(reading)
        },
        compute: () => {
            const reading = evaluate(null, bind)
            remember(reading.reads.inputs)
            samples = snapshot(reading.reads.samples)
            return { question: questionOf(reading), value: reading.value, error: reading.error }
        },
    }
}
