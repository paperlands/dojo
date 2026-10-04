// Pure command functions — no side effects, no this-binding.
// CommandFn = (ctx, ...args) => Delta
// ctx   = { transform: SE3, style }
// Delta = { transform?, style?, stroke?, point?, effects?, limits? }
//
// pose / stroke+point / effects.
// Place (goto/jmpto) and aim (faceto): frame-local — same space as home/fw,
// coords in the ambient's birth frame.

import { Versor } from "./mafs/versors.js"
import { SE3, AXIS_X, AXIS_Y, AXIS_Z } from "./se3.js"
import { conditionOf, demand, measure, format, FINITE } from "./numerics.js"
import { directionBetween } from "./laws/vec3.js"

// A command may not propose an invalid pose. The RESULTING pose is admitted, not
// assumed: a step whose arithmetic overflowed is NOT TAKEN, so a non-finite
// coordinate never becomes state, ink or an event. The command is dropped, never the
// figure, and the preceding valid walk stands. A finite step can still overflow, so
// admission at the argument is not enough. (phase 1: valid resulting state)
//
// The same rule guards whatever else will become geometry — a size, a thickness, a
// duration. A value that cannot be drawn is not drawn.
// A SCALAR's condition is the numerics surface's, not this file's. (conditionOf)
const admitted = (v) => conditionOf(v) === FINITE
const resultMeasure = (ctx, value, expr) => admitted(value) ? value : measure(value, { as: ctx.as, expr })
// A resulting POSE's validity is SE3.isValid's — the one authority the scheduler already
// names at admission. The command carries the accepted rotation, so only a position's
// arithmetic can newly break it. This guard never repairs and never re-decides the fact;
// it NAMES the refused value for the author. (phase 1: valid resulting state)
// (phase 1: valid resulting state)
const refuseBadPose = (ctx, pose, expr) => {
    if (SE3.isValid({ rotation: ctx.transform.rotation, position: pose })) return
    resultMeasure(ctx, pose.find((v) => !admitted(v)), expr)
}

// --- Movement commands ---

function fw(ctx, distance = 0) {
    const t = ctx.transform
    const [wx, wy, wz] = t.rotation.rotateVec(distance, 0, 0)
    const newPos = [t.position[0] + wx, t.position[1] + wy, t.position[2] + wz]
    refuseBadPose(ctx, newPos, "fw position")
    const transform = { rotation: t.rotation, position: newPos }

    if (ctx.style.down) {
        return { transform, stroke: "extend", point: newPos }
    }
    return { transform, stroke: "break" }
}

// Absolute in the frame that created this ambient (same space as home).
function goTo(ctx, x = 0, y = 0, z = null) {
    const pos = [x, y, z ?? ctx.transform.position[2]]
    refuseBadPose(ctx, pos, "goto position")
    const transform = { rotation: ctx.transform.rotation, position: pos }
    if (ctx.style.down) {
        return { transform, stroke: "extend", point: pos }
    }
    return { transform, stroke: "break" }
}

function jmpto(ctx, x = 0, y = 0, z = null) {
    const pos = [x, y, z ?? ctx.transform.position[2]]
    refuseBadPose(ctx, pos, "jmpto position")
    return {
        transform: { rotation: ctx.transform.rotation, position: pos },
        stroke: "break"
    }
}

function jmp(ctx, distance = 0) {
    const t = ctx.transform
    const [wx, wy, wz] = t.rotation.rotateVec(distance, 0, 0)
    const newPos = [t.position[0] + wx, t.position[1] + wy, t.position[2] + wz]
    refuseBadPose(ctx, newPos, "jmp position")
    const transform = { rotation: t.rotation, position: newPos }
    // jmp always breaks the path (pen up, move, pen down)
    return { transform, stroke: "break" }
}

// --- Rotation commands ---

function yaw(ctx, angle = 0) {
    return {
        transform: SE3.rotateLocal(ctx.transform, AXIS_Z, angle)
    }
}

function pitch(ctx, angle = 0) {
    return {
        transform: SE3.rotateLocal(ctx.transform, AXIS_Y, angle)
    }
}

function roll(ctx, angle = 0) {
    return {
        transform: SE3.rotateLocal(ctx.transform, AXIS_X, angle)
    }
}

function right(ctx, angle = 0) {
    return yaw(ctx, -angle)
}

function left(ctx, angle = 0) {
    return yaw(ctx, angle)
}

// --- Absolute orientation ---

function faceto(ctx, x = 0, y = 0, z = null) {
    // Aim at a birth-frame point — same coordinate noun as goto/jmpto/home.
    const pos = ctx.transform.position
    const target = [x, y, z ?? pos[2]]
    // The displacement is admitted BEFORE it is asked: a step whose arithmetic
    // overflowed is not taken, and the author is told. (phase 1: valid resulting state)
    refuseBadPose(ctx, [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]], "faceto direction")
    // Then the question is the kernel's, judged on the displacement alone: where the
    // figure stands is not a policy, so a resolvable separation aims at every placement
    // and the same figure keeps its bearing in every frame. null is exactly the
    // coincident pair — there is nothing to aim at, and no bearing is invented. (P1)
    const dir = directionBetween(pos, target)
    if (dir === null) return {}
    const yawAngle = Math.atan2(dir[1], dir[0]) * (180 / Math.PI)
    const pitchAngle = -Math.atan2(dir[2], Math.hypot(dir[0], dir[1])) * (180 / Math.PI)

    const yawRotation = Versor.fromAxisAngle(AXIS_Z, yawAngle)
    const pitchRotation = Versor.fromAxisAngle(AXIS_Y, pitchAngle)
    const rotation = yawRotation.multiply(pitchRotation)

    return {
        transform: { rotation, position: pos }
    }
}

// --- Event-producing commands ---

function label(ctx, text = ".", size = 1) {
    const pos = ctx.transform.position
    // One home for how big a name prints: the style. (id:notation-coordinate-vector)
    const textSize = resultMeasure(ctx, size * (ctx.style.label ?? 5), "label size")
    // A value lowered into text is DISPLAY: it rounds for the eye, and a non-number is
    // NAMED rather than printed as a numeral — with the author told, since a label is
    // how a figure speaks. (ruling 5)
    const shown = demand(text, { as: "display", expr: "label" })
    const printing = {
        type: "label",
        position: [pos[0], pos[1], pos[2]],
        color: ctx.style.color,
        text: format(text),
        textSize,
        rotation: ctx.transform.rotation
    }
    return { effects: shown.notice ? [shown.notice, printing] : [printing] }
}

function grid(ctx, divisions = 100, unit = 10) {
    const pos = ctx.transform.position
    const size = resultMeasure(ctx, unit * divisions, "grid size")
    const gridRotation = ctx.transform.rotation.multiply(
        Versor.fromAxisAngle(AXIS_X, 90)
    )
    return {
        effects: [{
            type: "grid",
            position: [pos[0], pos[1], pos[2]],
            color: ctx.style.color,
            size,
            divisions: divisions,
            rotation: gridRotation
        }]
    }
}

function erase(ctx) {
    return {
        effects: [{ type: "clear" }],
        stroke: "break"
    }
}

function fill(ctx) {
    return { stroke: "fill" }
}

function wait(ctx, duration = 1) {
    const milliseconds = resultMeasure(ctx, duration * 1000, "wait duration")
    return {
        // Flush current path before temporal boundary
        stroke: "break",
        effects: [{
            type: "wait",
            duration: milliseconds,
            position: [ctx.transform.position[0], ctx.transform.position[1], ctx.transform.position[2]],
            color: ctx.style.color,
            rotation: ctx.transform.rotation,
            headSize: ctx.style.showTurtle
        }]
    }
}

// Language yield — voluntary give-up-turn (coop multitasking). Instant completes.
function yieldCmd(ctx) {
    return {
        effects: [{
            type: 'yield',
            position: [ctx.transform.position[0], ctx.transform.position[1], ctx.transform.position[2]],
            rotation: ctx.transform.rotation
        }]
    }
}

// --- Style commands ---

function bold(ctx, x = 1) {
    return { style: { thickness: resultMeasure(ctx, x * 2, "bold thickness") } }
}

function beColour(ctx, color = "silver") {
    let resolved = color
    if (color === "invisible") resolved = "#00000000"
    if (conditionOf(color) === FINITE) resolved = `hsla(${~~(360 * color)}, 70%,  72%)`
    if (color === "random") resolved = `hsla(${~~(360 * (ctx.random ?? Math.random)())}, 70%,  72%)`
    if (/^([0-9a-f]{3}){1,2}$/i.test(color)) resolved = "#" + color
    return {
        style: { color: resolved },
        stroke: "break"
    }
}

function show(ctx, size = 10) {
    return { style: { showTurtle: resultMeasure(ctx, size, "show size") } }
}

function hide(ctx) {
    return { style: { showTurtle: false } }
}

function home(ctx) {
    // Home is the default pose, not the origin with the heading still banked:
    // position back to the birth frame's origin and the facing back to right
    // (+x). One way back — the same principle as the camera's recenter.
    return {
        transform: { rotation: SE3.identity().rotation, position: [0, 0, 0] },
        stroke: "break"
    }
}

// --- Limit commands ---

function limitRecurse(ctx, limit = 361) {
    return { limits: { maxRecurseDepth: limit + 1 } }
}

function limitCommand(ctx, limit = 100000) {
    return { limits: { maxCommands: limit } }
}

function limitMessage(ctx, limit = 8192) {
    return {
        effects: [{ type: 'limitMailbox', limit }]
    }
}

// --- Command table ---
// ONE source: a spec per callable — its implementation, every name it answers to,
// and its HOLES (the contract for "how many expressions this place contains, and of
// what kind"). `COMMANDS` (name → implementation) and `contractOf` (name → spec) are
// two views of this one list, so a name, an arity, and a hole kind cannot disagree,
// and a surplus argument is refused — never silently dropped. (id:gw-grammar)
//
// Hole kinds: "word" a name costume; "measure" any scalar reading; "finite" a finite number.
const def = (fn, names, ...holes) => ({ fn, names, holes: Object.freeze(holes) })

const SPECS = [
    def(fw, ["fw", "forward", "fd"], "finite"),
    def(right, ["rt", "right"], "finite"),
    def(left, ["lt", "left"], "finite"),
    def(yaw, ["yaw"], "finite"),
    def(pitch, ["pitch", "dive"], "finite"),
    def(roll, ["roll"], "finite"),
    def(show, ["show"], "finite"),
    def(hide, ["hide", "hd"]),
    def(jmp, ["jmp", "jump"], "finite"),
    def(bold, ["bold"], "finite"),
    def(grid, ["grid"], "finite", "finite"),
    def(goTo, ["goto"], "finite", "finite", "finite"),
    def(faceto, ["faceto"], "finite", "finite", "finite"),
    def(jmpto, ["jmpto", "jumpto"], "finite", "finite", "finite"),
    def(label, ["label"], "word", "finite"),
    def(erase, ["erase"]),
    def(home, ["home"]),
    def(fill, ["fill"]),
    def(wait, ["wait"], "finite"),
    def(yieldCmd, ["yield"]),
    def(limitRecurse, ["limitRecurse"], "measure"),
    def(limitCommand, ["limitCommand"], "measure"),
    def(limitMessage, ["limitMessage"], "measure"),
    def(beColour, ["beColour", "color", "colour"], "word"),
    def(null, ["shout"], "word", "measure"),   // a directive the executor answers itself
]

export const COMMANDS = new Map()
export const CONTRACTS = new Map()
for (const spec of SPECS) {
    for (const name of spec.names) {
        if (spec.fn) COMMANDS.set(name, spec.fn)   // a directive (fn: null) owns holes, not an implementation
        CONTRACTS.set(name, spec)
    }
}
export const contractOf = (name) => CONTRACTS.get(name)

// Default style — used by executor to initialize context
export const DEFAULT_STYLE = Object.freeze({
    down: true,
    color: "silver",
    // How big a NAME prints, in the head's own units. Display policy lives with the
    // style, not with the walk that happens to want a label. (id:notation-coordinate-vector)
    label: 5,
    thickness: 2,
    showTurtle: 10
})
