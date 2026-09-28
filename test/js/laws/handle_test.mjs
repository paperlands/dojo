// The handle's geometry: screen → the frozen view plane → birth coordinates. Pure, so
// the mapping that must be right is testable without a browser.
// (id:laws-decl-handle)
// Run: node --test test/js/laws/handle_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { Versor } from "../../../assets/js/turtling/mafs/versors.js"
import {
    facingPlane, touchPlane, birthLocal, requestedPose, hitTest, knownPose,
    eligibility, GRAZE,
    CLIENT_SPACE, viewMapping,
} from "../../../assets/js/turtling/laws/handle.js"
import { touchCone } from "../../../assets/js/turtling/laws/cone.js"
import { coneRig, coneTurn, magnet } from "../../../assets/js/turtling/laws/hand.js"
import { readout, outcomeOf, OUTCOME, verdictFade } from "../../../assets/js/turtling/laws/outcome.js"
import { CONE_RATE, CONE_EASE, DETENT_BAND, DETENT_HOLD, VERDICT_DECAY_MS } from "../../../assets/js/turtling/laws/feel.js"

const Q90 = Versor.raw(Math.SQRT1_2, 0, 0, -Math.SQRT1_2)   // rt 90: +x → −y
const place = (position, rotation = SE3.identity().rotation) => ({ rotation, position })
const nz = (v) => v.map((n) => { const r = +n.toFixed(6); return r === 0 ? 0 : r })  // fold -0

// A point of a sphere by its own coordinates, for the magnet witnesses.
const spherePoint = (center, radius, az, lat) => [
    center[0] + radius * Math.cos(lat) * Math.cos(az),
    center[1] + radius * Math.cos(lat) * Math.sin(az),
    center[2] + radius * Math.sin(lat),
]

test("the drag plane is the camera-facing plane through the point, and nothing more", () => {
    const plane = facingPlane([10, 4, 0], [0, 0.5, -0.8660254])
    assert.deepEqual(plane.origin, [10, 4, 0], "it passes through the point")
    assert.deepEqual(plane.normal, [0, 0.5, -0.8660254], "it faces the camera's viewing direction")
    // Neither a heading nor a placement chooses it — only the point and the
    // camera do. Freezing it until release is the gesture's job.
})

test("a pointer ray meets the plane, and refuses to invent one", () => {
    const flat = facingPlane([0, 0, 0], [0, 0, 1])
    assert.deepEqual(touchPlane({ origin: [2, 3, 5], direction: [0, 0, -1] }, flat), [2, 3, 0])
    // Parallel to the plane: no touch.
    assert.equal(touchPlane({ origin: [0, 0, 5], direction: [1, 0, 0] }, flat), null)
    // The plane is behind the eye: no touch.
    assert.equal(touchPlane({ origin: [0, 0, 5], direction: [0, 0, 1] }, flat), null)
})

test("a ray meets a cone, keeps its nappe, and a miss lands on the cone", () => {
    const c = { apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 30 }
    const cc2 = Math.cos(Math.PI / 6) ** 2
    const on = (p) => Math.abs(p[0] ** 2 - cc2 * (p[0] ** 2 + p[1] ** 2 + p[2] ** 2)) < 1e-6
    const near = touchCone({ origin: [86.6, 0, 200], direction: [0, 0, -1] }, c)
    assert.ok(near && on(near) && near[2] > 0, `the near hit is on +z, got ${near}`)
    const far = touchCone({ origin: [86.6, 0, 200], direction: [0, 0, -1] }, c, [86.6, 0, -50])
    assert.ok(far && far[2] < 0, `prefer keeps the nappe, got ${far}`)
    const miss = touchCone({ origin: [86.6, 0, 400], direction: [0, 1, 0] }, c)
    assert.ok(miss && on(miss), `a miss rides the cone, got ${miss}`)
})

// A real perspective camera: the drawn cone the hand must answer.
const pinhole = (eye, { width = 800, height = 800, fov = 60 } = {}) => {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const unit = (a) => { const n = Math.hypot(...a) || 1; return a.map((v) => v / n) }
    const f = unit([-eye[0], -eye[1], -eye[2]])
    const r = unit(cross(f, [0, 1, 0]))
    const u = cross(r, f)
    const half = Math.tan((fov * Math.PI) / 360)
    return (world) => {
        const v = sub(world, eye)
        const z = dot(v, f)
        if (z <= 0) return null
        return { x: width / 2 + (dot(v, r) / (z * half)) * (width / 2), y: height / 2 - (dot(v, u) / (z * half)) * (height / 2) }
    }
}

// The cone's hand is the cone's own polar, forward: a screen circle about the
// apex's projection is a pure turn that holds the height, and a pull spends the
// height at a drawn-scale rate, eased. (id:laws-decl-anchor)
test("a cone's hand is its own polar: a circle holds the height, a pull spends it at the rate", () => {
    const cone = { apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 30 }
    const anchor = [86.60254037844388, 0, 50]
    const project = pinhole([150, -450, 600])
    const hub = project(cone.apex)
    const p0 = project(anchor)
    const r0 = Math.hypot(p0.x - hub.x, p0.y - hub.y)
    const psi0 = Math.atan2(p0.y - hub.y, p0.x - hub.x)
    const height = (p) => p[0]                       // the axis is +x
    const azimuth = (p) => Math.atan2(p[2], p[1])
    const at = (f, psi = psi0) => {
        const rig = coneRig(cone, anchor, p0.x, p0.y, project)
        const r = f * r0
        return coneTurn(rig, hub.x + r * Math.cos(psi), hub.y + r * Math.sin(psi))
    }

    assert.deepEqual(nz(at(1)), nz(anchor), "a zero-delta pointer returns the grab exactly")

    // A circle about the hub is a pure dial: the height is held exactly, the
    // azimuth turns a full turn, and the point comes home.
    const rig = coneRig(cone, anchor, p0.x, p0.y, project)
    let turned = 0, previous = null
    for (let i = 0; i <= 12; i++) {
        const psi = psi0 + (i * Math.PI) / 6
        const p = coneTurn(rig, hub.x + r0 * Math.cos(psi), hub.y + r0 * Math.sin(psi))
        assert.ok(Math.abs(height(p) - 86.60254037844388) < 1e-6, `a circle holds the height, got ${height(p)}`)
        assert.ok(Math.abs(Math.hypot(...p) - 100) < 1e-6, "and stays on the cone")
        const az = azimuth(p)
        if (previous !== null) turned += Math.atan2(Math.sin(az - previous), Math.cos(az - previous))
        previous = az
    }
    assert.ok(Math.abs(Math.abs(turned) - 2 * Math.PI) < 1e-6, `a full circle is a full turn, got ${turned}`)

    // A pull spends the height toward the rate's target, eased: the height rises
    // monotonically and stays between the grab and the target. (id:laws-decl-anchor)
    const pull = coneRig(cone, anchor, p0.x, p0.y, project)
    const rOut = 2 * r0
    const first = coneTurn(pull, hub.x + rOut * Math.cos(psi0), hub.y + rOut * Math.sin(psi0))
    const second = coneTurn(pull, hub.x + rOut * Math.cos(psi0), hub.y + rOut * Math.sin(psi0))
    const target = anchor[0] + ((rOut - r0) / pull.scale) * CONE_RATE
    assert.ok(first[0] > anchor[0], `an outward pull raises the height, got ${first[0]}`)
    assert.ok(second[0] > first[0] && second[0] <= target + 1e-9, `it eases toward the rate's target, got ${second[0]}`)
})

test("a cone's hand refuses what is not an open cone", () => {
    const project = pinhole([0, 0, 60])
    assert.equal(coneRig({ apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 90 }, [10, 0, 0], 0, 0, project), null, "90° is a plane")
    assert.equal(coneRig({ apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 0 }, [10, 0, 0], 0, 0, project), null, "0° is a line")
    assert.equal(coneRig({ apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 30 }, [10, 0, 0], 0, 0, () => null), null, "a hidden apex has no hand")
})

test("a world touch becomes the actor's birth coordinates", () => {
    // Placed at (10,0), turned 90°: +x now runs along −y.
    const placed = place([10, 0, 0], Q90)
    assert.deepEqual(nz(birthLocal([10, 1, 0], placed)), [-1, 0, 0])
    assert.deepEqual(nz(birthLocal([10, 0, 0], placed)), [0, 0, 0])

    // Round trip: birth coordinates composed back through the place are the world
    // point again — one meaning of "where", not two.
    for (const world of [[10, 1, 0], [8, -2, 0], [12, 3, 0]]) {
        const local = birthLocal(world, placed)
        const back = SE3.compose(placed, { rotation: SE3.identity().rotation, position: local }).position
        back.forEach((n, i) => assert.ok(Math.abs(n - world[i]) < 1e-9, `${back} != ${world}`))
    }
})

test("the request moves position and leaves the accepted heading alone", () => {
    const accepted = place([3, 0, 0], Q90)
    const requested = requestedPose(accepted, [3, -1, 0])
    assert.deepEqual(requested.position, [3, -1, 0])
    assert.equal(requested.rotation, accepted.rotation, "a positional truth does not turn the actor")
})

test("the handle is hit only where it is drawn", () => {
    const projected = { x: 100, y: 50 }
    assert.equal(hitTest({ x: 100, y: 50 }, projected), true)
    assert.equal(hitTest({ x: 112, y: 50 }, projected), true)
    assert.equal(hitTest({ x: 140, y: 50 }, projected), false)
    assert.equal(hitTest({ x: 100, y: 100 }, projected), false)
    assert.equal(hitTest({ x: 105, y: 50 }, projected, 4), false)
})

test("a verdict becomes an outcome in one place", () => {
    const accepted = [1, 0, 0], requested = [2, 0, 0]
    const line = (verdict) => readout({ point: "a", accepted, requested, outcome: outcomeOf(verdict) })

    assert.deepEqual(line({ kind: "accept" }), {
        point: "a", accepted, requested, outcome: "accepted",
    })
    assert.equal(line({ kind: "refuse" }).outcome, "rejected")
    assert.equal(line({ kind: "busy" }).outcome, "busy")
    assert.equal(line({ kind: "unresolved" }).outcome, "unresolved")
    assert.equal(line({ kind: "stale" }).outcome, "obsolete")
    assert.equal(line(undefined).outcome, "unknown")
    // The words that matter must not collapse into one.
    assert.equal(new Set([OUTCOME.rejected, OUTCOME.busy, OUTCOME.unresolved,
        OUTCOME.unsupported, OUTCOME.obsolete, OUTCOME.cancelled]).size, 6)
    // One outcome representation: no line can describe two contradictory answers.
    assert.equal(Object.keys(readout({ point: "a", accepted, requested, outcome: OUTCOME.busy })).length, 4)
})

test("a touch maps through the view plane and back into birth coordinates", () => {
    // The whole chain, exactly as the pointer path runs it.
    const placed = place([10, 0, 0], Q90)
    const hit = touchPlane({ origin: [10, 3, 5], direction: [0, 0, -1] }, facingPlane([10, 0, 0], [0, 0, -1]))
    assert.deepEqual(hit, [10, 3, 0])
    const local = birthLocal(hit, placed)
    assert.deepEqual(nz(local), [-3, 0, 0])
    assert.equal(nz(local)[2], 0, "the plane is where it says it is")
})

test("a genuinely tilted plane is not world z", () => {
    // A tilt about x actually moves the normal; the axis-aligned cases above
    // never show that.
    const QX90 = Versor.raw(Math.SQRT1_2, Math.SQRT1_2, 0, 0)
    const tilted = facingPlane([0, 0, 0], QX90.rotateVec(0, 0, 1))
    assert.notDeepEqual(nz(tilted.normal), [0, 0, 1], "the normal moved")
    assert.ok(Math.abs(Math.hypot(...tilted.normal) - 1) < 1e-9, "and it is still a unit normal")

    // Straight down the normal lands on the origin, whatever the plane's tilt.
    const n = tilted.normal
    const hit = touchPlane({ origin: n.map((v) => v * 5), direction: n.map((v) => -v) }, tilted)
    hit.forEach((v) => assert.ok(Math.abs(v) < 1e-9, `${hit} is not the origin`))
})

test("a near-parallel ray is refused, not stretched into a touch", () => {
    const flat = facingPlane([0, 0, 0], [0, 0, 1])
    // Exactly parallel, and near-parallel: at 1e-7 the intersection lands 10,000
    // units away, which is not a touch on this plane.
    assert.equal(touchPlane({ origin: [0, 0, 0.001], direction: [1, 0, -1e-12] }, flat), null)
    assert.equal(touchPlane({ origin: [0, 0, 0.001], direction: [1, 0, -1e-7] }, flat), null)
    assert.equal(touchPlane({ origin: [0, 0, 0.001], direction: [1, 0, -1e-4] }, flat), null)
    // An ordinary oblique ray still touches: the guard is an angle, not a mood.
    const oblique = touchPlane({ origin: [0, 0, 1], direction: [0.2, 0, -1] }, flat)
    assert.ok(oblique && Math.abs(oblique[0] - 0.2) < 1e-9, `${oblique}`)
})

test("no planar domain: a pose off its birth plane is still a known pose", () => {
    // The birth-plane domain is gone (rulings 2026-09-25): a drag follows the
    // frozen view plane, so where the program left the point is not a refusal.
    assert.equal(knownPose(place([3, -1, 0])), true)
    assert.equal(knownPose(place([3, -1, 0.5])), true, "off-plane is still draggable")
    assert.equal(knownPose(place([3, -1, -1])), true, "pitch 90, then fw 1 — still a point")

    // `unsupported` names only a pose that cannot anchor the plane.
    const line = readout({ point: "a", accepted: [3, -1, -1], requested: null, outcome: OUTCOME.unsupported })
    assert.equal(line.outcome, "unsupported")
    assert.notEqual(line.outcome, OUTCOME.busy)
    assert.notEqual(line.outcome, OUTCOME.unresolved)
    assert.notEqual(line.outcome, OUTCOME.rejected)
})

test("scaling a ray cannot change its meaning", () => {
    const flat = facingPlane([0, 0, 0], [0, 0, 1])
    const ray = (direction, origin = [0, 0, 1]) => ({ origin, direction })
    // The same grazing ray, written at two magnitudes, is refused both times.
    assert.equal(touchPlane(ray([1, 0, -0.0005]), flat), null)
    assert.equal(touchPlane(ray([10, 0, -0.005]), flat), null)
    assert.equal(touchPlane(ray([1000, 0, -0.5]), flat), null)
    // And the same ordinary ray at two magnitudes touches the same point.
    const one = touchPlane(ray([0.2, 0, -1]), flat)
    const ten = touchPlane(ray([2, 0, -10]), flat)
    assert.deepEqual(one, ten)
    assert.ok(Math.abs(one[0] - 0.2) < 1e-9 && Math.abs(one[2]) < 1e-9)
    // A degenerate direction has no angle, so it is refused rather than guessed.
    assert.equal(touchPlane(ray([0, 0, 0]), flat), null)
    assert.equal(touchPlane({ origin: [0, 0, 1], direction: [0, 0, -1] },
        { origin: [0, 0, 0], normal: [0, 0, 0] }), null)
    assert.ok(GRAZE > 0)
})

test("missing geometry is not a known pose", () => {
    assert.equal(knownPose(place([3, 4, 0])), true)
    assert.equal(knownPose(null), false, "an unknown pose cannot anchor a plane")
    assert.equal(knownPose({ position: [3, 4] }), false, "a malformed pose cannot anchor a plane")
    assert.equal(knownPose({ position: [3, 4, NaN] }), false)
    assert.equal(knownPose({}), false)
    assert.equal(knownPose(undefined), false)
})

test("eligibility asks liveness first: participation is not registration", () => {
    const frame = { name: "a", parent: { declared: new Set(["a"]) } }
    const accepted = place([1, 0, 0])

    assert.deepEqual(eligibility({ frame, registered: true, accepted }), { ok: true, reason: null })

    // A retained reference whose subtree was removed still holds its old parent's
    // declaration set — so `exposed` alone would say yes while the frame is gone.
    assert.deepEqual(eligibility({ frame, registered: false, accepted }),
        { ok: false, reason: OUTCOME.obsolete })

    const detached = { name: "a", parent: { declared: new Set() } }
    assert.deepEqual(eligibility({ frame: detached, registered: true, accepted }),
        { ok: false, reason: OUTCOME.unresolved })

    assert.deepEqual(eligibility({ frame, registered: true, accepted: place([1, 0, -1]) }),
        { ok: true, reason: null }, "a pose off its birth plane is still draggable")
    assert.deepEqual(eligibility({ frame, registered: true, accepted: { position: [1, 0] } }),
        { ok: false, reason: OUTCOME.unsupported }, "but a pose that cannot anchor the plane is not")

    assert.deepEqual(eligibility({ frame: null, registered: true, accepted }),
        { ok: false, reason: OUTCOME.obsolete })
})

test("the verdict fade is bounded, monotonic, and over at its span", () => {
    assert.equal(verdictFade(0), 1, "the moment of refusal is full strength")
    assert.equal(verdictFade(VERDICT_DECAY_MS / 2), 0.5)
    assert.equal(verdictFade(VERDICT_DECAY_MS), 0, "gone at the span")
    assert.equal(verdictFade(VERDICT_DECAY_MS + 1), 0)
    // A missing or nonsensical age is nothing, not a full-strength ghost.
    assert.equal(verdictFade(NaN), 0)
    assert.equal(verdictFade(-1), 0)
    assert.equal(verdictFade(5, 0), 0, "a zero span has no fade")
    // The ghost only ever dims: one direction, never out of range.
    let prev = 1
    for (let age = 0; age <= VERDICT_DECAY_MS; age++) {
        const f = verdictFade(age)
        assert.ok(f <= prev && f >= 0, "never brightens, never leaves [0,1]")
        prev = f
    }
    assert.equal(prev, 0)
})

test("the projection space has one name (the overlay refuses any other)", () => {
    assert.equal(CLIENT_SPACE, 'client')
})

test("viewMapping: the drawn mark and the hand share one world frame", () => {
    const stage = {
        project: (p) => ({ x: p[0] * 100, y: p[1] * 100 }),
        unproject: (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [0, 0, -1] }),
        facing: () => [0, 0, -1],
    }
    // Identity: the stage is the world.
    const flat = viewMapping(null, stage)
    assert.deepEqual(flat.project([1, 2, 3]), stage.project([1, 2, 3]))
    assert.deepEqual(flat.rayAt(30, 40), stage.unproject(30, 40))
    assert.deepEqual(flat.facing(), [0, 0, -1])

    // A reframe (an eye, or a finger-twist): a quarter-turn about z.
    const reframe = { rotation: Q90, position: [0, 0, 0] }
    const view = viewMapping(reframe, stage)
    const world = [2, 0, 0]
    const scene = SE3.apply(reframe, world)          // +x → −y
    assert.deepEqual(nz(scene), [0, -2, 0])
    assert.deepEqual(view.project(world), stage.project(scene),
        "the mark projects where the reframed scene point does")

    // The screen ray maps back through the reframe's inverse, so the world ray
    // and the world drag plane live in one frame and meet at the world point.
    const at = view.project(world)
    const hit = touchPlane(view.rayAt(at.x, at.y), { origin: world, normal: view.facing() })
    assert.ok(hit, "the world ray meets the world plane")
    assert.deepEqual(nz(hit.map((n, i) => n - world[i])), [0, 0, 0],
        "the ray through a projected point passes through that point")
    assert.deepEqual(nz(view.facing()), [0, 0, -1],
        "the sight axis, expressed in world coordinates")
})

test("the magnet holds inside the hold and releases by the band", () => {
    const center = [0, 0, 0], radius = 5
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    const held = spherePoint(center, radius, 0.3, DETENT_HOLD * 0.5)
    const onPaper = magnet(center, radius, held, { paper: true })
    assert.ok(Math.abs(dist(onPaper, center) - radius) < 1e-9, "still on the sphere")
    assert.ok(Math.abs(onPaper[2]) < 1e-9, `inside the hold the point sits on the paper, got z = ${onPaper[2]}`)
    assert.ok(Math.abs(Math.atan2(onPaper[1], onPaper[0]) - Math.atan2(held[1], held[0])) < 1e-9, "azimuth held")
    const mid = spherePoint(center, radius, 0.3, (DETENT_HOLD + DETENT_BAND) / 2)
    const pulled = magnet(center, radius, mid, { paper: true })
    assert.ok(pulled[2] < mid[2] && pulled[2] > 0, `the release band pulls it down, got z = ${pulled[2]}`)
    const far = spherePoint(center, radius, 0.3, DETENT_BAND * 1.5)
    assert.deepEqual(magnet(center, radius, far, { paper: true }), far, "outside the band is untouched")
    assert.deepEqual(magnet(center, radius, mid, {}), mid, "no detents armed, no bend")
})

test("the magnet never folds: the bent z is monotone through the band", () => {
    const center = [0, 0, 0], radius = 5
    let last = -Infinity
    for (let i = 0; i <= 40; i++) {
        const lat = (i / 40) * DETENT_BAND
        const bent = magnet(center, radius, spherePoint(center, radius, 0.2, lat), { paper: true })
        assert.ok(bent[2] >= last - 1e-12, `monotone at lat = ${lat}: ${bent[2]} after ${last}`)
        last = bent[2]
    }
})

test("the poles are a detent behind a flag", () => {
    const center = [0, 0, 0], radius = 5
    const near = spherePoint(center, radius, 0.3, Math.PI / 2 - 0.02)
    assert.deepEqual(magnet(center, radius, near, { paper: true }), near, "no pole detent armed")
    const up = magnet(center, radius, near, { poles: true })
    assert.ok(Math.abs(Math.hypot(...up.map((v, i) => v - center[i])) - radius) < 1e-9, "still on the sphere")
    assert.ok(up[2] > near[2], `the pole pulls it up, got z = ${up[2]}`)
})
