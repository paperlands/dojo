// Pure command functions — no side effects, no this-binding.
// CommandFn = (ctx, ...args) => Delta
// ctx   = { transform: SE3, style }
// Delta = { transform?, style?, stroke?, point?, effects?, limits? }
//
// Three orthogonal concerns in the delta:
//   pose:    transform + style   (how the turtle changed)
//   stroke:  "extend"|"break"|"fill" + point  (path accumulation action)
//   output:  effects[]           (events for the renderer/scheduler)

import { Versor } from "./mafs/versors.js"
import { SE3 } from "./se3.js"

// Axes — avoid allocation in hot loops
const AXIS_X = { x: 1, y: 0, z: 0 }
const AXIS_Y = { x: 0, y: 1, z: 0 }
const AXIS_Z = { x: 0, y: 0, z: 1 }

// --- Movement commands ---

function fw(ctx, distance = 0) {
    const t = ctx.transform
    const [wx, wy, wz] = t.rotation.rotateVec(distance, 0, 0)
    const newPos = [t.position[0] + wx, t.position[1] + wy, t.position[2] + wz]
    const transform = { rotation: t.rotation, position: newPos }

    if (ctx.style.down) {
        return { transform, stroke: "extend", point: newPos }
    }
    return { transform, stroke: "break" }
}

function goTo(ctx, x = 0, y = 0, z = null) {
    const wp = ctx.worldPosition
    return {
        world: { position: [x, y, z ?? wp[2]] },
        stroke: ctx.style.down ? "extend" : "break"
    }
}

function jmpto(ctx, x = 0, y = 0, z = null) {
    const wp = ctx.worldPosition
    return {
        world: { position: [x, y, z ?? wp[2]] },
        stroke: "break"
    }
}

function jmp(ctx, distance) {
    const t = ctx.transform
    const [wx, wy, wz] = t.rotation.rotateVec(distance, 0, 0)
    const newPos = [t.position[0] + wx, t.position[1] + wy, t.position[2] + wz]
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

function faceto(ctx, targetX = 0, targetY = 0, targetZ = null) {
    const wp = ctx.worldPosition
    const tx = targetX
    const ty = targetY
    const tz = targetZ ?? wp[2]

    const dx = tx - wp[0]
    const dy = ty - wp[1]
    const dz = tz - wp[2]

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
        world: { rotation }
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
    if (color === "random") resolved = `hsla(${~~(360 * Math.random())}, 70%,  72%)`
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
    return {
        transform: { rotation: ctx.transform.rotation, position: [0, 0, 0] },
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

export const COMMANDS = new Map([
    ["fw", fw],
    ["rt", right],
    ["lt", left],
    ["yaw", yaw],
    ["pitch", pitch],
    ["dive", pitch],
    ["roll", roll],
    ["show", show],
    ["hide", hide],
    ["hd", hide],
    ["jmp", jmp],
    ["bold", bold],
    ["grid", grid],
    ["goto", goTo],
    ["faceto", faceto],
    ["jmpto", jmpto],
    ["label", label],
    ["erase", erase],
    ["home", home],
    ["fill", fill],
    ["wait", wait],
    ["yield", yieldCmd],
    ["limitRecurse", limitRecurse],
    ["limitCommand", limitCommand],
    ["limitMessage", limitMessage],
    ["beColour", beColour]
])

// Default style — used by executor to initialize context
export const DEFAULT_STYLE = Object.freeze({
    down: true,
    color: "silver",
    thickness: 2,
    showTurtle: 10
})
