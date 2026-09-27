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
    facingPlane, touchPlane, figureRadius, polarOf, polarPoint,
    birthLocal, requestedPose, hitTest, eligibility,
    outcomeOf, readout, OUTCOME, HIT_RADIUS,
} from "./handle.js"
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
        locusOf = null,      // (frame) => named locus — a closed surface's outward push is geared
    } = deps

    const poseOf = (frame) => frame.transform.deref()
    let grab = null

    // A sphere's hand, in the ball's own polar frame about the paper's z. The hand's angle
    // around the pole turns the azimuth — a dial is a dial, exact and with no drift from the
    // hand's step size — and its horizontal reach, measured against the ball's drawn radius,
    // spends latitude: outward walks toward the paper and the paper is a floor, inward climbs
    // toward the pole. Nothing is hyperbolic, so no gear is needed; the frame is frozen at
    // the grab, so an identical pixel is an identical point. (id:laws-decl-anchor)
    const polarLat = (drag) => {
        const mag = Math.max(0, Math.min(Math.PI / 2, Math.abs(drag.polar.lat0) - drag.polar.f))
        return (drag.polar.lat0 < 0 ? -1 : 1) * mag
    }
    const polarMove = (drag, hit) => {
        const { center, radius } = drag.sphere
        const dx = hit[0] - center[0], dy = hit[1] - center[1]
        const rho = Math.hypot(dx, dy)
        if (Math.hypot(hit[0] - drag.downHit[0], hit[1] - drag.downHit[1], hit[2] - drag.downHit[2]) < 1e-9) {
            return [...drag.origin]                 // an identical pixel is an identical point
        }
        if (rho > 1e-9 * radius && drag.polar.rho0 > 1e-9 * radius) {
            const ang = Math.atan2(dy, dx)
            drag.polar.az += Math.atan2(Math.sin(ang - drag.polar.ang), Math.cos(ang - drag.polar.ang))
            drag.polar.ang = ang
            drag.polar.f = (rho - drag.polar.rho0) / drag.reach
        }
        return polarPoint(center, radius, drag.polar.az, polarLat(drag))
    }

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
                // Frozen camera plane through the accepted point, until release.
                // One rule for every locus: the anchor and the whole grab offset are
                // kept, so no camera angle classifies the interaction and no depth
                // falls out of the grab. A zero-delta pointer moves nothing.
                // (id:laws-decl-anchor)
                const face = facing()
                const plane = facingPlane(anchor, face)
                const hit = touchPlane(ray, plane)
                if (!hit) return { claimed: false }
                // A sphere's hand is its own coordinates: the pole is +z through the centre,
                // so the hand dials an azimuth and spends reach on a latitude. Freeze the
                // frame, the drawn size that one radius of reach is measured against, and the
                // point's own azimuth and latitude at the grab.
                const locus = locusOf?.(candidate.frame)
                const sphere = locus?.kind === 'sphere' && locus.radius > 0 && Array.isArray(locus.center)
                    ? { center: [...locus.center], radius: locus.radius }
                    : null
                const polar = sphere ? polarOf(sphere.center, anchor) : null
                const drawn = sphere ? figureRadius(project, sphere.center, sphere.radius, plane.normal) : null
                const beside = touchPlane(rayAt(x + 1, y), plane)
                const perPx = beside ? Math.hypot(beside[0] - hit[0], beside[1] - hit[1], beside[2] - hit[2]) : 0
                // One drawn radius out in world units: the finger at the figure's edge.
                const reach = drawn && perPx > 1e-9 ? drawn * perPx : sphere?.radius ?? null
                grab = {
                    pointerId,
                    name: candidate.name,
                    frame: candidate.frame,
                    plane,
                    planeNormal: [...plane.normal],
                    sphere,
                    reach,
                    polar: polar ? {
                        az: polar.az,
                        lat0: polar.lat,
                        ang: Math.atan2(anchor[1] - sphere.center[1], anchor[0] - sphere.center[0]),
                        rho0: Math.hypot(anchor[0] - sphere.center[0], anchor[1] - sphere.center[1]),
                        f: 0,
                    } : null,
                    downHit: [...hit],
                    origin: [...anchor],
                    // Grabbing slightly off centre keeps what the pointer grabbed.
                    offset: [anchor[0] - hit[0], anchor[1] - hit[1], anchor[2] - hit[2]],
                    // Read, not told: a caller cannot hand over the wrong 'previous'.
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

            const birth = birthOf(grab.frame)
            const ray = rayAt(x, y)
            if (!ray) return { moved: false }        // clipped: no target, no request
            // The plane FROZEN at pointer-down: a look mid-drag never retargets
            // the drag, and the accepted pose never feeds the next request. (id:laws-decl-anchor)
            const hit = touchPlane(ray, grab.plane)
            if (!hit) return { moved: false }        // off the frozen plane: keep the pose
            // The plane names the request for every locus but a sphere, whose own
            // coordinates take over. (id:laws-decl-anchor)
            const request = grab.polar
                ? polarMove(grab, hit)
                : [hit[0] + grab.offset[0], hit[1] + grab.offset[1], hit[2] + grab.offset[2]]
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
