// Eye / Lens — camera-as-ambient, Phases E0 + E1.
// Run with: node --test test/js/eye_test.mjs
//
// The eye is an ORDINARY ambient (no special origin): it emits `view` events
// instead of `head` (E0), forces the pen up, and REFRAMES THE WORLD at the model
// layer (E1). The camera IS the eye: rather than move the THREE camera, the
// compositor premultiplies every non-eye layer by E⁻¹ (E = eye world pose in
// camera convention), so the live orbit camera C renders as effective camera E·C.
// An empty eye seeds to recenterPose ⇒ E = identity ⇒ today's default view, orbit
// untouched. fw dollies, rt orbits (at the live radius), dive cranes, roll banks
// the horizon (real for the first time), and re-eval is idempotent.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"
import { createScheduler, metaRoot, isLensName, frameAddress, frameWorldTransform } from "../../assets/js/turtling/scheduler.js"
import { execute } from "../../assets/js/turtling/executor.js"
import { parseProgram } from "../../assets/js/turtling/parse.js"
import { Versor } from "../../assets/js/turtling/mafs/versors.js"
import { SE3 } from "../../assets/js/turtling/se3.js"
import { viewVectors, eyeCameraPose } from "../../assets/js/turtling/view.js"

const AXIS_Y = { x: 0, y: 1, z: 0 }
const AXIS_Z = { x: 0, y: 0, z: 1 }

// The default orbit camera C: at [0,0,500], identity rotation, looking −Z. The
// effective camera the user sees is E·C, where E = eyeCameraPose(eye worldPose).
// This is what the compositor's reframe (world ← E⁻¹·world) renders.
const ORBIT_CAMERA = { rotation: Versor.raw(1, 0, 0, 0), position: [0, 0, 500] }
function effectiveCamera(eye) {
    return SE3.compose(eyeCameraPose(frameWorldTransform(eye)), ORBIT_CAMERA)
}
// Camera forward (−Z) and up (+Y) world directions for an effective camera pose.
const camForward = (cam) => cam.rotation.rotateVec(0, 0, -1)
const camUp = (cam) => cam.rotation.rotateVec(0, 1, 0)
// The eye's model-layer reframe E⁻¹, applied to a world point.
function reframe(eye, point) {
    return SE3.apply(SE3.invert(eyeCameraPose(frameWorldTransform(eye))), point)
}

function assertVecClose(actual, expected, eps = 1e-6) {
    for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(actual[i] - expected[i]) < eps,
            `component ${i}: got ${actual[i]}, expected ${expected[i]}`)
    }
}

function realDeps() {
    return { mathParser: new Parser(), mathEvaluator: new Evaluator() }
}

function findChild(root, name) {
    return root.children.get(name) || null
}

// Drive a program in the root frame to completion. Steps `now` by 1s/tick so
// animated programs (one wait = 1000ms) advance one wait per tick.
function runProgram(src, opts = {}) {
    const deps = realDeps()
    const generator = execute(parseProgram(src), deps, { color: '#fff' })
    const scheduler = createScheduler(generator, {
        createDeps: realDeps,
        execOpts: { color: '#fff' },
        rootDeps: deps,
        ...opts
    })
    let ticks = 0
    while (!scheduler.done && ticks < 1000) {
        scheduler.tick(ticks * 1000)
        ticks++
    }
    return scheduler
}

describe("Phase E0: view Output", () => {
    test("isLensName recognizes the reserved `eye` name", () => {
        assert.ok(isLensName("eye"))
        assert.ok(!isLensName("turtle"))
        assert.ok(!isLensName("dancer"))
    })

    test("`as eye do fw 100 end` emits a view event, never a head", () => {
        const s = runProgram("as eye do\n  fw 100\nend")
        const eye = findChild(s.root, 'eye')
        assert.ok(eye, "eye frame exists")
        assert.ok(eye.isLens, "eye frame is flagged as a Lens")

        const events = eye.channel.drain()
        const views = events.filter(e => e.type === 'view')
        const heads = events.filter(e => e.type === 'head')
        assert.ok(views.length >= 1, "emits at least one view event")
        assert.equal(heads.length, 0, "emits no head events")
    })

    test("a Lens forces the pen up — no path geometry", () => {
        const s = runProgram("as eye do\n  fw 100\n  rt 90\n  fw 50\nend")
        const eye = findChild(s.root, 'eye')
        const events = eye.channel.drain()
        assert.equal(events.filter(e => e.type === 'path').length, 0, "no path events from a Lens")
    })

    test("view event carries the eye's pose (position + rotation)", () => {
        const s = runProgram("as eye do\n  fw 100\nend")
        const eye = findChild(s.root, 'eye')
        const view = eye.channel.drain().find(e => e.type === 'view')
        assert.ok(view, "a view event was emitted")
        assert.ok(Array.isArray(view.position), "view carries a position tuple")
        assert.ok(view.rotation && typeof view.rotation.w === 'number', "view carries a rotation Versor")
        // The eye seeds to recenterPose (camera-oriented frame), so fw advances
        // along the camera's forward = world −Z → eye at z ≈ −100, not x ≈ 100.
        assertVecClose(view.position, [0, 0, -100])
    })

    test("a non-lens ambient still emits head, not view", () => {
        const s = runProgram("as walker do\n  fw 100\nend")
        const walker = findChild(s.root, 'walker')
        assert.ok(walker, "walker frame exists")
        assert.ok(!walker.isLens, "walker is not a Lens")

        const events = walker.channel.drain()
        assert.ok(events.some(e => e.type === 'head'), "walker emits a head")
        assert.equal(events.filter(e => e.type === 'view').length, 0, "walker emits no view")
    })

    test("an animated Lens emits a view per temporal boundary", () => {
        const s = runProgram("as eye do\n  loop 3 do\n    fw 1\n    wait\n  end\nend")
        const eye = findChild(s.root, 'eye')
        const events = eye.channel.drain()
        const views = events.filter(e => e.type === 'view')
        assert.ok(views.length >= 3, `expected >=3 views (one per wait), got ${views.length}`)
        assert.equal(events.filter(e => e.type === 'head').length, 0, "no head events")
        assert.equal(events.filter(e => e.type === 'path').length, 0, "no path events")
    })
})

describe("Phase E0: the eye is an ordinary ambient", () => {
    function evalTab(scheduler, src) {
        scheduler.hotSwapChild('buf', {
            name: 'tab',
            code: { ast: parseProgram(src), functions: null },
            style: { color: '#fff' },
            env: null
        })
        let ticks = 0
        while (!scheduler.done && ticks < 1000) {
            scheduler.tick(ticks * 1000)
            ticks++
        }
    }

    test("an eye inherits the normal spawn origin — no special-casing", () => {
        // After `loop 5 do fw 100 end` the pen is at (500,0,0); the eye inherits
        // that as its spawn origin exactly as any `as do` ambient would. No
        // lensOrigin, no captured home.
        const scheduler = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#fff' } })
        evalTab(scheduler, "loop 5 do\n  fw 100\nend\nas eye do\nend")
        const eye = scheduler.root.children.get('buf').children.get('eye')
        assert.ok(eye && eye.isLens)
        assert.deepEqual(eye.origin.position, [500, 0, 0], "inherits the pen position like a normal ambient")
    })

    test("an empty eye recenters the default camera on its world pose", () => {
        // The eye rides the inertial frame like any other ambient. After loop 5
        // fw 100 the empty eye inherited the pen's (500,0,0) world offset. With the
        // recenter seed, the effective camera = E·C is the DEFAULT camera recentered
        // on the eye: [0,0,500] from the eye's world head, looking at it.
        const scheduler = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#fff' } })
        evalTab(scheduler, "loop 5 do\n  fw 100\nend\nas eye do\nend")
        const eye = scheduler.root.children.get('buf').children.get('eye')
        const cam = effectiveCamera(eye)
        assertVecClose(cam.position, [500, 0, 500])     // default camera recentered on the eye
        assertVecClose(camForward(cam), [0, 0, -1])     // still looking −Z at the drawing
    })

    test("a nested eye rides its parent's frame — effective camera composes the rig", () => {
        // An eye nested in a placed parent composes the parent's transform
        // (frameWorldTransform), not just its own local motion. base moves fw 300,
        // the eye's own fw 100 dollies in within its seeded (camera-oriented) frame →
        // effective camera at (300,0,400): recentered on the rig AND dollied 100 in.
        const s = runProgram("as base do\n  fw 300\n  as eye do\n    fw 100\n  end\nend")
        const eye = findChild(s.root, 'base').children.get('eye')
        assert.ok(eye && eye.isLens, "nested eye is a Lens")
        const cam = effectiveCamera(eye)
        assertVecClose(cam.position, [300, 0, 400])
    })

    test("sibling `eye` tabs keep independent placements — no name collision", () => {
        // Every camera tab writes the reserved name `eye`, so two tabs hold two
        // distinct Frames that SHARE the name 'eye'. The effective camera is a pure
        // function of each eye's own world pose, so a focus-cut between them can never
        // cross their vantages.
        const scheduler = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#fff' } })
        scheduler.hotSwapChild('bufA', { name: 'tabA', code: { ast: parseProgram("as eye do\n  fw 100\nend"), functions: null }, style: { color: '#fff' }, env: null })
        scheduler.hotSwapChild('bufB', { name: 'tabB', code: { ast: parseProgram("fw 50\nas eye do\n  fw 300\nend"), functions: null }, style: { color: '#fff' }, env: null })
        let ticks = 0
        while (!scheduler.done && ticks < 1000) { scheduler.tick(ticks * 1000); ticks++ }

        const eyeA = scheduler.root.children.get('bufA').children.get('eye')
        const eyeB = scheduler.root.children.get('bufB').children.get('eye')
        assert.ok(eyeA && eyeB && eyeA !== eyeB, "two distinct eye frames")
        assert.equal(eyeA.name, eyeB.name, "both carry the reserved name 'eye'")
        // Independent vantages, not aliased by the shared name. eyeA: born at origin,
        // fw 100 dollies in → (0,0,400). eyeB: born at (50,0,0), fw 300 dollies in
        // from its own recenter → (50,0,200).
        assertVecClose(effectiveCamera(eyeA).position, [0, 0, 400])
        assertVecClose(effectiveCamera(eyeB).position, [50, 0, 200])
    })

    test("frameAddress is stable across re-eval and unique across tabs (idempotency key)", () => {
        // Re-eval RECREATES the eye frame (new identity), so view-tracking state
        // cannot live on the frame — it is keyed by frameAddress, which survives
        // re-eval (→ idempotent camera, no drift) and is unique per tab (→ sibling
        // `eye` cuts never crosstalk). This locks the bug hardware verification
        // caught: frame-held _prevView was lost each eval and the camera drifted.
        const scheduler = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#fff' } })
        const evalTab = (key, name, src) => scheduler.hotSwapChild(key, { name, code: { ast: parseProgram(src), functions: null }, style: { color: '#fff' }, env: null })
        const run = () => { let n = 0; while (!scheduler.done && n < 1000) { scheduler.tick(n * 1000); n++ } }

        evalTab('bufA', 'tabA', "as eye do\n  fw 100\nend")
        evalTab('bufB', 'tabB', "as eye do\n  fw 300\nend")
        run()
        const eyeA1 = scheduler.root.children.get('bufA').children.get('eye')
        const eyeB1 = scheduler.root.children.get('bufB').children.get('eye')
        const addrA = frameAddress(scheduler.root, eyeA1)
        assert.equal(addrA, 'bufA/eye')
        assert.equal(frameAddress(scheduler.root, eyeB1), 'bufB/eye')
        assert.notEqual(addrA, frameAddress(scheduler.root, eyeB1), "sibling eyes: distinct addresses")

        // Re-eval tabA: frame recreated, address stable → tracking persists.
        evalTab('bufA', 'tabA', "as eye do\n  fw 100\nend")
        run()
        const eyeA2 = scheduler.root.children.get('bufA').children.get('eye')
        assert.ok(eyeA2 !== eyeA1, "re-eval recreated the eye frame (distinct instance)")
        assert.equal(frameAddress(scheduler.root, eyeA2), addrA, "address stable across re-eval")
    })
})

describe("Phase E1: the basis seam", () => {
    test("viewVectors: identity eye looks along world +X, up +Z", () => {
        const { forward, up } = viewVectors(Versor.raw(1, 0, 0, 0))
        assertVecClose(forward, [1, 0, 0])
        assertVecClose(up, [0, 0, 1])
    })

    test("viewVectors: rt 90 (yaw −90 about +Z) looks along −Y", () => {
        const { forward } = viewVectors(Versor.fromAxisAngle(AXIS_Z, -90))
        assertVecClose(forward, [0, -1, 0])
    })

    test("viewVectors: dive 90 (pitch +90 about +Y) looks straight down (−Z)", () => {
        const { forward } = viewVectors(Versor.fromAxisAngle(AXIS_Y, 90))
        assertVecClose(forward, [0, 0, -1])
    })

    // End-to-end: the effective camera (E·C) the reframe produces looks the right
    // way. The eye's seeded frame folds the basis into its world pose, so we assert
    // through the effective camera, not the raw view rotation.
    test("`as eye do` → effective camera looks down −Z at the drawing (default)", () => {
        const cam = effectiveCamera(findChild(runProgram("as eye do\nend").root, 'eye'))
        assertVecClose(cam.position, [0, 0, 500])
        assertVecClose(camForward(cam), [0, 0, -1])
        assertVecClose(camUp(cam), [0, 1, 0])
    })

    test("`as eye do dive 90 end` → effective camera cranes overhead, looks down at +X→−Y", () => {
        const cam = effectiveCamera(findChild(runProgram("as eye do\n  dive 90\nend").root, 'eye'))
        assertVecClose(cam.position, [0, 500, 0])     // craned above the subject
        assertVecClose(camForward(cam), [0, -1, 0])   // looking down the +Y axis at the plane
    })
})

describe("Phase E1: model-layer reframe — effective camera E·C", () => {
    test("an empty eye reframes to the default view (E = identity, orbit untouched)", () => {
        const eye = findChild(runProgram("as eye do\nend").root, 'eye')
        const cam = effectiveCamera(eye)
        assertVecClose(cam.position, [0, 0, 500])   // exactly the default orbit camera
        assertVecClose(camForward(cam), [0, 0, -1])
        // E⁻¹ is identity → world points are not moved (orbit composes untouched).
        assertVecClose(reframe(eye, [100, 0, 0]), [100, 0, 0])
        assertVecClose(reframe(eye, [0, 100, 0]), [0, 100, 0])
    })

    test("fw 100 dollies IN toward the drawing — [0,0,500] → [0,0,400]", () => {
        // fw walks the seeded (camera-oriented) eye along world −Z; through E·C the
        // camera descends from z=500 to z=400 toward the subject (push-in).
        const cam = effectiveCamera(findChild(runProgram("as eye do\n  fw 100\nend").root, 'eye'))
        assertVecClose(cam.position, [0, 0, 400])
        assertVecClose(camForward(cam), [0, 0, -1])
    })

    test("rt 90 orbits around the subject at the orbit radius (keeps facing it)", () => {
        // rt is a yaw of the eye frame; at the live orbit radius (500) this swings
        // the camera around the subject to [−500,0,0] still looking at it (+X).
        const cam = effectiveCamera(findChild(runProgram("as eye do\n  rt 90\nend").root, 'eye'))
        assertVecClose(cam.position, [-500, 0, 0])
        assertVecClose(camForward(cam), [1, 0, 0])    // turned 90° toward world +X
        assertVecClose(camUp(cam), [0, 1, 0])         // horizon stays level (pure yaw)
    })

    test("roll 90 BANKS the horizon — the regression guard for the reported bug", () => {
        // The formerly-dead case: roll is about the eye's look axis. Position is
        // unchanged but the camera up tilts off world-up — banking is now expressed
        // (OrbitControls could never do this).
        const cam = effectiveCamera(findChild(runProgram("as eye do\n  roll 90\nend").root, 'eye'))
        assertVecClose(cam.position, [0, 0, 500])     // pivots in place
        assertVecClose(camForward(cam), [0, 0, -1])   // still looking at the drawing
        assertVecClose(camUp(cam), [1, 0, 0])         // up banked 90° off world +Y
    })

    test("the reframe is idempotent — same program twice yields the same camera", () => {
        // The effective camera is a pure function of the eye's world pose: no stored
        // baseline, no live-camera dependency → re-eval can't drift.
        const a = effectiveCamera(findChild(runProgram("as eye do\n  fw 100\n  rt 90\nend").root, 'eye'))
        const b = effectiveCamera(findChild(runProgram("as eye do\n  fw 100\n  rt 90\nend").root, 'eye'))
        assertVecClose(a.position, b.position)
        assertVecClose(camForward(a), camForward(b))
    })

    test("a nested eye rides its parent rig (MOUNT for free)", () => {
        // base fw 300 → eye born at world (300,0,0); its own fw 100 dollies in →
        // effective camera at (300,0,400): recentered on the rig AND dollied 100 in.
        const eye = findChild(runProgram("as base do\n  fw 300\n  as eye do\n    fw 100\n  end\nend").root, 'base').children.get('eye')
        const cam = effectiveCamera(eye)
        assertVecClose(cam.position, [300, 0, 400])
        assertVecClose(camForward(cam), [0, 0, -1])
    })
})
