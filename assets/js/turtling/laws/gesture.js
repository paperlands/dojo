// The gesture: who owns the pointer, and what a move means. (id:laws-decl-handle)
//
// A pure state machine. The DOM layer feeds it pointer positions and applies its
// instructions; nothing here touches listeners, controls or three.js — so the
// composition (arbitration, grab offset, cancellation, ownership restoration) is
// testable without a browser.
//
// Arbitration is decided BEFORE the camera sees pointerdown: `pointerDown`
// answers `claimed`, and the DOM layer stops propagation on that answer rather
// than disabling the controls after they have already started a gesture.
import {
    birthPlane, touchPlane, birthLocal, requestedPose, hitTest, eligibility,
    outcomeOf, readout, OUTCOME,
} from "./handle.js"

export function createGesture(deps) {
    const {
        candidates,      // () => [{ name, frame }] — the places currently offered
        worldOf,         // (frame) => world transform
        registered,      // (frame) => boolean
        requestMotion,   // (frame, pose, revision) => verdict
        revision,        // () => number
        wake,            // () => void — an idle canvas must paint an accepted move
        project,         // (worldPosition) => { x, y } in CSS pixels
        rayAt,           // (x, y) => { origin, direction }
        capture,         // ({ pointerId }) => void
        release,         // ({ pointerId }) => void
        setControls,     // (enabled) => void
        controlsEnabled, // () => boolean — the camera's OWN current state
        onReadout,       // (line) => void
        radius = 18,
    } = deps

    const poseOf = (frame) => frame.transform.deref()
    let grab = null

    // Every way a capture ends goes through here, so ownership is never left
    // behind: the pointer is released and the CAMERA'S OWN previous state — not an
    // unconditional enable — comes back.
    const endCapture = (reason, acceptedPosition) => {
        if (!grab) return false
        const { pointerId, name, controlsWasEnabled } = grab
        grab = null
        release({ pointerId })
        setControls(controlsWasEnabled)
        if (reason) {
            onReadout(readout({ point: name, accepted: acceptedPosition ?? null, requested: null, outcome: reason }))
        }
        return true
    }

    return {
        // Decide ownership here, before the camera consumes the event.
        pointerDown({ pointerId, x, y }) {
            if (grab) return { claimed: false }   // one pointer owns the hand
            const here = { x, y }
            for (const candidate of candidates()) {
                if (!hitTest(here, project(worldOf(candidate.frame).position), radius)) continue
                const accepted = poseOf(candidate.frame)
                const gate = eligibility({
                    frame: candidate.frame,
                    registered: registered(candidate.frame),
                    accepted,
                })
                if (!gate.ok) {
                    onReadout(readout({
                        point: candidate.name, accepted: accepted.position ?? null,
                        requested: null, outcome: gate.reason,
                    }))
                    return { claimed: false }
                }
                const hit = touchPlane(rayAt(x, y), birthPlane(worldOf(candidate.frame)))
                if (!hit) return { claimed: false }
                const there = birthLocal(hit, worldOf(candidate.frame))
                grab = {
                    pointerId,
                    name: candidate.name,
                    frame: candidate.frame,
                    // Grabbing slightly off centre keeps what the pointer grabbed:
                    // the point follows the pointer's delta instead of snapping to it.
                    offset: [accepted.position[0] - there[0], accepted.position[1] - there[1]],
                    // Read, not told: a caller cannot hand over the wrong 'previous'.
                    controlsWasEnabled: controlsEnabled(),
                }
                capture({ pointerId })
                setControls(false)
                return { claimed: true, point: candidate.name }
            }
            return { claimed: false }
        },

        pointerMove({ pointerId, x, y }) {
            if (!grab || grab.pointerId !== pointerId) return { moved: false }

            const accepted = poseOf(grab.frame)
            const gate = eligibility({
                frame: grab.frame,
                registered: registered(grab.frame),
                accepted,
            })
            // The declaration can go while the pointer is down, and the frame
            // survives it. Liveness first, then the capture ends.
            if (!gate.ok) {
                endCapture(gate.reason, accepted.position ?? null)
                return { moved: false, cancelled: true }
            }

            const world = worldOf(grab.frame)
            const hit = touchPlane(rayAt(x, y), birthPlane(world))
            if (!hit) return { moved: false }        // off the plane: keep the pose
            const there = birthLocal(hit, world)
            const requested = requestedPose(accepted, [
                there[0] + grab.offset[0],
                there[1] + grab.offset[1],
                accepted.position[2],
            ])
            const verdict = requestMotion(grab.frame, requested, revision())
            const outcome = verdict.kind === 'accept' ? OUTCOME.accepted : outcomeOf(verdict)
            onReadout(readout({
                point: grab.name, accepted: accepted.position,
                requested: requested.position, outcome,
            }))
            if (verdict.kind === 'accept') wake()
            return { moved: true, outcome }
        },

        // Release keeps every accepted move and asks for nothing further.
        pointerUp({ pointerId }) {
            if (!grab || grab.pointerId !== pointerId) return { ended: false }
            endCapture(null)
            return { ended: true }
        },

        // Cancellation discards the pending target; accepted movement stands.
        pointerCancel({ pointerId }) {
            if (!grab || grab.pointerId !== pointerId) return { ended: false }
            endCapture(OUTCOME.cancelled, poseOf(grab.frame).position ?? null)
            return { ended: true }
        },

        // Disposal, fresh play and a replaced scope all arrive here.
        dispose() {
            const ended = endCapture(OUTCOME.cancelled, grab ? poseOf(grab.frame).position ?? null : null)
            return { ended }
        },

        get grabbed() {
            return grab ? { name: grab.name, pointerId: grab.pointerId } : null
        },
    }
}
