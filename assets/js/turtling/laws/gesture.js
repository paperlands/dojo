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
    facingPlane, touchPlane,
    birthLocal, requestedPose, hitTest, eligibility,
} from "./handle.js"
import { outcomeOf, readout, OUTCOME } from "./outcome.js"
import { HIT_RADIUS, DRAG_SLOP } from "./feel.js"
import { handFor } from "./hand.js"
export function createGesture(deps) {
    const {
        candidates,      // () => [{ name, frame }] — the places currently offered
        anchorOf,        // (frame) => live world transform — where the point IS
        birthOf,         // (frame) => birth frame — the frame the request is expressed in
        registered,      // (frame) => boolean
        canTouch = () => true, // an empty point may be touched; a walking head owns its point
        requestMotion,   // (frame, pose, revision) => verdict
        onAccepted = null, // ({ frame, from, to }) => void — one accepted hand move
        revision,        // () => number
        wake,            // () => void — an idle canvas must paint an accepted move
        project,         // (worldPosition) => { x, y } in CSS pixels
        rayAt,           // (x, y) => { origin, direction }
        facing,          // () => the camera's world viewing direction
        capture,         // ({ pointerId }) => void
        release,         // ({ pointerId }) => void
        setControls,     // (enabled) => void
        controlsEnabled, // () => boolean — the camera's OWN current state
        onReadout,       // (line) => void
        radius = HIT_RADIUS,
        slop = DRAG_SLOP,
        locusOf = null,      // (frame) => named locus — a sphere's hand is its camera-plane disk
        detents = null,      // { paper, poles, band, hold } — slight stickiness at the ball's landmarks
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
                if (!canTouch(candidate.frame)) continue
                // Behind the camera, clipped, or on a zero-sized canvas: not a target,
                // and never a made-up hit. (id:laws-decl-handle)
                const anchor = anchorOf(candidate.frame).position
                const projected = project(anchor)
                if (!projected) continue
                if (!hitTest(here, projected, radius)) continue
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
                const ray = rayAt(x, y)
                if (!ray) return { claimed: false }
                const face = facing()
                const plane = facingPlane(anchor, face)
                const hit = touchPlane(ray, plane)
                if (!hit) return { claimed: false }
                // A hand is chosen by the locus's own data: a sphere's camera-plane
                // disk, a cone's polar, and the frozen camera plane for everything
                // else. The plane is always frozen, so a hand only overrides it.
                // (id:laws-decl-anchor)
                const locus = locusOf?.(candidate.frame)
                let hand = handFor(locus)
                let handState = null
                if (hand) {
                    handState = hand.freeze({ anchor, ray, facing: face, pointer: { x, y }, project, locus })
                    if (!handState) {
                        if (hand.rejects) return { claimed: false }
                        hand = null
                    }
                }
                grab = {
                    pointerId,
                    name: candidate.name,
                    frame: candidate.frame,
                    plane,
                    hand,
                    handState,
                    origin: [...anchor],
                    offset: [anchor[0] - hit[0], anchor[1] - hit[1], anchor[2] - hit[2]],
                    down: { x, y },
                    armed: false,
                    controlsWasEnabled: controlsEnabled(),
                }
                capture({ pointerId })
                setControls(false)
                // The frame travels back so a cue can be exact: names can repeat
                // across scopes, a frame cannot.
                return { claimed: true, point: candidate.name, frame: candidate.frame }
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
            // The point may gain a walking body while it is held. Release before
            // another pointer move can become head motion.
            if (!gate.ok || !canTouch(grab.frame)) {
                endCapture(gate.ok ? OUTCOME.cancelled : gate.reason, accepted.position ?? null)
                return { moved: false, cancelled: true }
            }

            if (!grab.armed) {
                if (Math.hypot(x - grab.down.x, y - grab.down.y) <= slop) return { moved: false }
                grab.armed = true
            }

            const birth = birthOf(grab.frame)
            const ray = rayAt(x, y)
            if (!ray) return { moved: false }
            // The hand's own point, or the frozen camera plane every locus falls back
            // to. (id:laws-decl-anchor)
            const placed = grab.hand ? grab.hand.place(grab.handState, { ray, pointer: { x, y }, project, detents }) : null
            let request = placed
            if (!request) {
                const hit = touchPlane(ray, grab.plane)
                if (!hit) return { moved: false }        // off the frozen plane: keep the pose
                request = [hit[0] + grab.offset[0], hit[1] + grab.offset[1], hit[2] + grab.offset[2]]
            }
            const requested = requestedPose(accepted, birthLocal(request, birth))
            const verdict = requestMotion(grab.frame, requested, revision())
            const outcome = verdict.kind === 'accept' ? OUTCOME.accepted : outcomeOf(verdict)
            // The move the scheduler actually accepted, not the one requested:
            // a reveal follows a landed displacement, never a proposal.
            if (verdict.kind === 'accept' && onAccepted) {
                onAccepted({ frame: grab.frame, from: accepted.position, to: verdict.pose.position })
            }
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
