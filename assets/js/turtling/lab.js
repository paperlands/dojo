// The laboratory seam. (id:laws-decl-lab)
//
// An allow-list, not a scheduler-option funnel: only the inputs a Phase 0/1
// experiment needs cross from the door into createScheduler. An unknown key is
// refused loudly, so experimental injection cannot quietly become public
// meaning — and unrelated scheduler configuration cannot ride in.
//
// Pure: no DOM, no THREE, so a test can exercise the boundary by behavior.

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
