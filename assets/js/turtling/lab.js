// Experimental: the allow-list limits keys, not the responder's internal frames.
// Unknown keys are refused; this is not a scheduler-option funnel.
// No DOM or THREE crosses this seam. (id:laws-decl-lab)

export const LAB_STABILITY = "experimental"

export const LAB_INPUTS = [
    'motionAdmission', 'motionAdmissionAsync', 'motionValidate', 'refusalStroke', 'observePureGoto',
]

export function labInputs(law) {
    if (law == null) return {}
    const inputs = {}
    for (const key of Object.keys(law)) {
        if (!LAB_INPUTS.includes(key)) throw new Error(`unknown laboratory input: ${key}`)
        inputs[key] = law[key]
    }
    return inputs
}
