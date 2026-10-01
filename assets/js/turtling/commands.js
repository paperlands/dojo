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

// A command may not propose an invalid pose. Two failures differ:
//   - a NOTHING component (no world to consult) — a wound live, but a rehearsal
//     tolerates it so vocabulary past an absent-world step still registers;
//   - a NON-FINITE number (the arithmetic overflowed) — invalid on every route,
//     because even a rehearsal's simulated state can be inherited.
// A finite step can still overflow, so admission at the argument is not enough.
// (phase 1: valid resulting state)
function requireFinite(ctx, pos, command) {
    const nonFinite = pos.some((v) => v !== null && v !== undefined && !Number.isFinite(v))
    const nothing = pos.some((v) => v === null || v === undefined)
    if (nonFinite || (nothing && !ctx.rehearsal)) {
        throw new Error(`${command} would leave the figure at a non-finite position`)
    }
}

// --- Movement commands ---

function fw(ctx, distance = 0) {
    const t = ctx.transform
    const [wx, wy, wz] = t.rotation.rotateVec(distance, 0, 0)
    const newPos = [t.position[0] + wx, t.position[1] + wy, t.position[2] + wz]
    requireFinite(ctx, newPos, "fw")
    const transform = { rotation: t.rotation, position: newPos }

    if (ctx.style.down) {
        return { transform, stroke: "extend", point: newPos }
    }
    return { transform, stroke: "break" }
}

// Absolute in the frame that created this ambient (same space as home).
function goTo(ctx, x = 0, y = 0, z = null) {
    const pos = [x, y, z ?? ctx.transform.position[2]]
    requireFinite(ctx, pos, "goto")
    const transform = { rotation: ctx.transform.rotation, position: pos }
    if (ctx.style.down) {
        return { transform, stroke: "extend", point: pos }
    }
    return { transform, stroke: "break" }
}

function jmpto(ctx, x = 0, y = 0, z = null) {
    const pos = [x, y, z ?? ctx.transform.position[2]]
    requireFinite(ctx, pos, "jmpto")
    return {
        transform: { rotation: ctx.transform.rotation, position: pos },
        stroke: "break"
    }
}

function jmp(ctx, distance = 0) {
    const t = ctx.transform
    const [wx, wy, wz] = t.rotation.rotateVec(distance, 0, 0)
    const newPos = [t.position[0] + wx, t.position[1] + wy, t.position[2] + wz]
    requireFinite(ctx, newPos, "jmp")
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
    const dx = x - pos[0]
    const dy = y - pos[1]
    const dz = (z ?? pos[2]) - pos[2]

    const distXY = Math.sqrt(dx * dx + dy * dy)
    const distTotal = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (distTotal < Versor.EPSILON) {
        return {}
    }

    const yawAngle = Math.atan2(dy, dx) * (180 / Math.PI)
    const pitchAngle = -Math.atan2(dz, distXY) * (180 / Math.PI)

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
    return {
        effects: [{
            type: "label",
            position: [pos[0], pos[1], pos[2]],
            color: ctx.style.color,
            text: String(text),
            textSize: size * 5,
            rotation: ctx.transform.rotation
        }]
    }
}

function grid(ctx, divisions = 100, unit = 10) {
    const pos = ctx.transform.position
    const gridRotation = ctx.transform.rotation.multiply(
        Versor.fromAxisAngle(AXIS_X, 90)
    )
    return {
        effects: [{
            type: "grid",
            position: [pos[0], pos[1], pos[2]],
            color: ctx.style.color,
            size: unit * divisions,
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
    return {
        // Flush current path before temporal boundary
        stroke: "break",
        effects: [{
            type: "wait",
            duration: duration * 1000,
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
    return { style: { thickness: x * 2 } }
}

function beColour(ctx, color = "silver") {
    let resolved = color
    if (color === "invisible") resolved = "#00000000"
    if (Number.isFinite(color)) resolved = `hsla(${~~(360 * color)}, 70%,  72%)`
    if (color === "random") resolved = `hsla(${~~(360 * (ctx.random ?? Math.random)())}, 70%,  72%)`
    if (/^([0-9a-f]{3}){1,2}$/i.test(color)) resolved = "#" + color
    return {
        style: { color: resolved },
        stroke: "break"
    }
}

function show(ctx, size = 10) {
    return { style: { showTurtle: size } }
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

// --- Command table ---
//
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
    def(show, ["show"], "measure"),
    def(hide, ["hide", "hd"]),
    def(jmp, ["jmp", "jump"], "finite"),
    def(bold, ["bold"], "measure"),
    def(grid, ["grid"], "measure", "measure"),
    def(goTo, ["goto"], "finite", "finite", "finite"),
    def(faceto, ["faceto"], "finite", "finite", "finite"),
    def(jmpto, ["jmpto", "jumpto"], "finite", "finite", "finite"),
    def(label, ["label"], "word", "measure"),
    def(erase, ["erase"]),
    def(home, ["home"]),
    def(fill, ["fill"]),
    def(wait, ["wait"], "measure"),
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
    thickness: 2,
    showTurtle: 10
})
