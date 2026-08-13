// DojoOrbitControls — every dojo camera behaviour, extending the VENDORED
// OrbitControls without editing it. `assets/js/utils/threeorbital.js` holds no
// dojo-invented code; upgrading three.js is a file swap, not a merge.
//
// Three behaviours live here (specs/decisions/026-two-fingers-one-meaning):
//   1. dolly-through — the standoff floors the PIVOT, never the camera
//   2. gesture arbitration — two fingers mean one thing at a time
//   3. the upstream `clientX`-as-y typo in `_handleMouseDownDolly`
//
// THE RULE: apply what the rig can express, publish what it cannot. Span and
// drift are rig DOF (public pan / rotateLeft / rotateUp / dollyOut — #32810);
// twist has no rig DOF so it leaves as a `twist` event.
//
// We still override a few underscore-private entry points the stock state
// machine dispatches — a rename upstream would leave those overrides simply
// never called. That is what test/js/seams/orbit_seam_test.mjs turns red.

import { Vector3 } from '../utils/three-entry.js'
import { OrbitControls } from '../utils/threeorbital.js'
import { createArbiter, frameOf, wrapAngle, SPAN, DRIFT, TWIST } from '../utils/gesture.js'

const _fwd = new Vector3()
const TWO_PI = Math.PI * 2

export class DojoOrbitControls extends OrbitControls {
    constructor(object, domElement = null) {
        super(object, domElement)

        // How close the pivot may sit to the camera — not a hard wall; past it the
        // rig keeps advancing and flies through what you aimed at. Doubles as the
        // fly-through cruising distance, so it must stay large enough to not crawl.
        this.dollyStandoff = 30

        // Stock's near clamp would stop the camera dead at the pivot. Disarm it
        // and floor the TARGET in update() instead — one rule, applied once,
        // covering cursor-zoom, mouse-drag dolly and ortho alike.
        this.minDistance = 0

        // Pixels of finger travel a channel must accumulate to win a gesture. A
        // live knob: it is passed per decision, never captured, so changing it
        // takes effect on the very next move.
        this.gestureSlop = 10

        this._arbiter = createArbiter()
        this._twistStart = 0
        // Frame baselines for the public-API path (not stock's private starts).
        this._span0 = 1
        this._mid0x = 0
        this._mid0y = 0
    }

    // Dolly-through. With `minDistance = 0` stock already computes the advance we
    // want (`prevRadius − prevRadius·scale`, unclamped) and then parks the target
    // at that unfloored radius ahead of the camera. All that remains is to floor
    // the pivot — which is the whole of the law.
    update(deltaTime = null) {
        const changed = super.update(deltaTime)

        const gap = this.object.position.distanceTo(this.target)
        if (gap >= this.dollyStandoff || !this.object.isPerspectiveCamera) return changed

        this.object.getWorldDirection(_fwd)
        this.target.copy(this.object.position).addScaledVector(_fwd, this.dollyStandoff)
        // super.update() stamped _lastTargetPosition before we moved the target;
        // leaving it stale makes the NEXT update report a change that never happened.
        this._lastTargetPosition.copy(this.target)

        return changed
    }

    // Upstream passes clientX as the y argument, mis-aiming the middle-drag dolly
    // ray. Still unfixed in three.js r185.
    _handleMouseDownDolly(event) {
        this._updateZoomParameters(event.clientX, event.clientY)
        this._dollyStart.set(event.clientX, event.clientY)
    }

    // Two-finger frame in STABLE pointer order — (event, other) flips twist by π.
    _gestureFrame() {
        const a = this._pointerPositions[this._pointers[0]]
        const b = this._pointerPositions[this._pointers[1]]
        if (a === undefined || b === undefined) return null
        return frameOf(a, b)
    }

    // Route one arbitrated gesture. `onDrift` differs by mode: orbit vs pan.
    // Public pan/rotate/dolly each call update(); suspend damping for the batch
    // so rotateLeft+rotateUp don't intermediate-damp (theta twice, phi once).
    _routeGesture(onDrift) {
        const frame = this._gestureFrame()
        const channel = this._arbiter.decide(frame, this.gestureSlop)

        if (channel === SPAN || channel === DRIFT) {
            const damped = this.enableDamping
            this.enableDamping = false
            try {
                if (channel === SPAN && this.enableZoom && frame && this._span0) {
                    // Zoom-to-cursor needs the midpoint set before dollyOut's update.
                    this._updateZoomParameters(frame.cx, frame.cy)
                    this.dollyOut(Math.pow(frame.span / this._span0, this.zoomSpeed))
                    this._span0 = frame.span
                } else if (channel === DRIFT) {
                    onDrift(frame)
                }
            } finally {
                this.enableDamping = damped
            }
        } else if (channel === TWIST) {
            this._emitTwist(frame)
        }

        // Losers re-baseline so the winner measures from NOW — deciding travel
        // is never replayed as a jump at commit.
        if (frame === null) return
        if (channel !== SPAN) this._span0 = frame.span
        if (channel !== DRIFT) { this._mid0x = frame.cx; this._mid0y = frame.cy }
        if (channel !== TWIST) this._twistStart = frame.angle
    }

    // The rig has no roll DOF, so twist leaves as an intent and the consumer
    // lands it (stage.js folds it into the hand's own reframe M).
    _emitTwist(frame) {
        if (frame === null) return
        const delta = wrapAngle(frame.angle - this._twistStart)
        this._twistStart = frame.angle
        if (delta !== 0) this.dispatchEvent({ type: 'twist', angle: delta })
    }

    _armTwoFinger() {
        const frame = this._gestureFrame()
        this._arbiter.begin(frame)
        if (frame === null) return
        this._span0 = frame.span
        this._mid0x = frame.cx
        this._mid0y = frame.cy
        this._twistStart = frame.angle
    }

    _handleTouchStartDollyRotate(_event) { this._armTwoFinger() }
    _handleTouchStartDollyPan(_event) { this._armTwoFinger() }

    _handleTouchMoveDollyRotate(_event) {
        this._routeGesture((frame) => {
            if (!this.enableRotate || !frame) return
            const h = this.domElement.clientHeight
            const dx = (frame.cx - this._mid0x) * this.rotateSpeed
            const dy = (frame.cy - this._mid0y) * this.rotateSpeed
            this.rotateLeft(TWO_PI * dx / h) // yes, height — same as stock
            this.rotateUp(TWO_PI * dy / h)
            this._mid0x = frame.cx
            this._mid0y = frame.cy
        })
    }

    _handleTouchMoveDollyPan(_event) {
        this._routeGesture((frame) => {
            if (!this.enablePan || !frame) return
            this.pan(
                (frame.cx - this._mid0x) * this.panSpeed,
                (frame.cy - this._mid0y) * this.panSpeed
            )
            this._mid0x = frame.cx
            this._mid0y = frame.cy
        })
    }
}
