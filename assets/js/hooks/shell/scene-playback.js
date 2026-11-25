import { SELF } from "../../kernel/witness.js"
import { sameIncarnation, seatOf } from "../../turtling/playback.js"
import { captureChoices, copyChoices } from "../../turtling/laws/hand_choices.js"

const DEGREE = { kindled: 1.0, warm: 0.4 }

export function admitChoices(raw) {
    if (raw == null) return { ok: true, choices: raw }
    const choices = copyChoices(raw)
    return choices ? { ok: true, choices } : { ok: false }
}

// Page law names the document root. Only its admitted local play can restart. (id:shell-scene-playback)
export function createScenePlayback(turtle, { law, grantOf }) {
    const admissions = new Map()
    const slotOf = (place, addr) => addr == null ? null : law.seatOf(addr, place)

    function perform(answer, { addr, witness }) {
        const grant = grantOf()
        const place = witness === SELF && grant?.addr === addr ? grant.place : null
        const root = place == null || answer.runs.length === 0 ? null : law.bindingsOf(addr, place, SELF)
            .find(binding => binding.root === "document")?.slot

        for (const slot of answer.gone) {
            admissions.delete(slot)
            turtle.removeAmbient(slot)
        }
        for (const { slot, name, code, vocab, nodes, vocabNodes, choices } of answer.runs) {
            const offered = admitChoices(choices)
            // Stage input is already materialized by page law.
            if (!offered.ok || offered.choices?.inputs.some(({ route }) => route.root !== "document")) continue
            const options = { hatch: false, vocab: vocab ?? null, nodes: nodes ?? null, vocabNodes: vocabNodes ?? null }
            if (offered.choices !== undefined) options.choices = offered.choices
            const before = seatOf(turtle, slot)
            const result = turtle.upsertAmbient(slot, name, code, options)
            const play = seatOf(turtle, slot)
            const fresh = play != null && !sameIncarnation(play, before)
            const prior = admissions.get(slot)
            const local = slot === root && grant === grantOf()
            if (!local) {
                if (!play || fresh || result?.success === true) admissions.delete(slot)
                continue
            }
            if (!fresh && !(result?.success === true && sameIncarnation(prior?.play, play))) continue
            // A green reuse keeps the prior offer unless new choices were materialized.
            const recipe = !fresh && choices === undefined && Object.hasOwn(prior.options, "choices")
                ? { ...options, choices: prior.options.choices } : options
            admissions.set(slot, { addr, place, slot, play, name, code, options: recipe })
        }
        turtle.light(answer.light, DEGREE)
        if (answer.hatch != null) turtle.reflectGate(answer.hatch, { witness })
    }

    function controls(place, selectedAddr) {
        const admission = (play) => {
            const addr = selectedAddr()
            const slot = slotOf(place, addr)
            const grant = grantOf()
            const record = admissions.get(slot)
            return addr != null && grant?.place === place && grant.addr === addr &&
                record?.addr === addr && record.place === place && play?.seat === slot &&
                sameIncarnation(record.play, play) ? record : null
        }
        return {
            seat() {
                const slot = slotOf(place, selectedAddr())
                return slot == null ? null : { slot }
            },
            authority: (play) => admission(play) != null,
            source: (play) => admission(play)?.code,
            prepareReplay(play) {
                const record = admission(play)
                if (!record) return null
                const { slot, name, code, options } = record
                const choices = captureChoices(options.choices, [{ root: "document", slot }],
                    key => turtle.handLocalChoices(key))
                if (choices == null) return null
                return (prepare) => {
                    if (admission(play) !== record || !sameIncarnation(seatOf(turtle, slot), play)) return false
                    turtle.upsertAmbient(slot, name, code, {
                        ...options, choices, fresh: true,
                        preparePlay() {
                            const now = seatOf(turtle, slot)
                            if (now && admissions.get(slot) === record) {
                                admissions.set(slot, { ...record, play: now })
                            }
                            prepare?.()
                        },
                    })
                    const now = seatOf(turtle, slot)
                    return now != null && !sameIncarnation(now, play)
                }
            },
        }
    }

    return { perform, controls }
}
