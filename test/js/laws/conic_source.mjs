// Test helper over the ACTUAL conic rung. Narrow asserted substitutions only;
// the cone, cutting plane and point are the authored source, not a JS locus.
import { readFileSync } from 'node:fs'

const RUNG = readFileSync(new URL('../../../scripts/play/rungs/conic-orbit.plang', import.meta.url), 'utf8')

function replaceOne(text, from, to) {
    const parts = text.split(from)
    if (parts.length !== 2) throw new Error(`conic rung drift: expected one ${JSON.stringify(from)}`)
    return parts.join(to)
}

export function conicSource({ pitch = 60, tilt = 30, cut = 1 } = {}) {
    let text = RUNG
    text = replaceOne(text, '  pitch 60', `  pitch ${pitch}`)
    text = replaceOne(text, '    let P.tilt = 30', `    let P.tilt = ${tilt}`)
    text = replaceOne(text, '    let P.z = 1', `    let P.z = ${cut}`)
    return text
}
