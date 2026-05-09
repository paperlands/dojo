// Pure command functions — no side effects, no this-binding.
// CommandFn = (ctx, ...args) => { transform?, penState?, events?, limits? }
// ctx = { transform: SE3, penState, currentPath }
// Each returns a delta: only changed fields present.

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

    if (ctx.penState.down) {
        return {
            transform,
            pathAction: { type: "extend", point: newPos }
        }
    }
    return { transform, pathAction: { type: "break" } }
}

function goTo(ctx, x = 0, y = 0, z = null) {
    const t = ctx.transform
    const newPos = [x, y, z ?? t.position[2]]
    const transform = { rotation: t.rotation, position: newPos }

    if (ctx.penState.down) {
        return {
            transform,
            pathAction: { type: "extend", point: newPos }
        }
    }
    return { transform, pathAction: { type: "break" } }
}

function jmpto(ctx, x = 0, y = 0, z = null) {
    const t = ctx.transform
    const newPos = [x, y, z ?? t.position[2]]
    const transform = { rotation: t.rotation, position: newPos }
    // jmpto always breaks the path (pen up, move, pen down)
    return { transform, pathAction: { type: "break" } }
}

function jmp(ctx, distance) {
    const t = ctx.transform
    const [wx, wy, wz] = t.rotation.rotateVec(distance, 0, 0)
    const newPos = [t.position[0] + wx, t.position[1] + wy, t.position[2] + wz]
    const transform = { rotation: t.rotation, position: newPos }
    // jmp always breaks the path (pen up, move, pen down)
    return { transform, pathAction: { type: "break" } }
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
    const pos = ctx.transform.position
    const tx = targetX
    const ty = targetY
    const tz = targetZ ?? pos[2]

    const dx = tx - pos[0]
    const dy = ty - pos[1]
    const dz = tz - pos[2]

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
        events: [{
            type: "label",
            position: [pos[0], pos[1], pos[2]],
            color: ctx.penState.color,
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
        events: [{
            type: "grid",
            position: [pos[0], pos[1], pos[2]],
            color: ctx.penState.color,
            size: unit * divisions,
            divisions: divisions,
            rotation: gridRotation
        }]
    }
}

function erase(ctx) {
    return {
        events: [{ type: "clear" }],
        pathAction: { type: "break" }
    }
}

function fill(ctx) {
    return {
        pathAction: { type: "fill" }
    }
}

function wait(ctx, duration = 1) {
    return {
        // Flush current path before temporal boundary
        pathAction: { type: "break" },
        events: [{
            type: "wait",
            duration: duration * 1000,
            position: [ctx.transform.position[0], ctx.transform.position[1], ctx.transform.position[2]],
            color: ctx.penState.color,
            rotation: ctx.transform.rotation,
            headSize: ctx.penState.showTurtle
        }]
    }
}

// --- Pen state commands ---

function bold(ctx, x = 1) {
    return { penState: { thickness: x * 2 } }
}

function beColour(ctx, color = "silver") {
    let resolved = color
    if (color === "invisible") resolved = "#00000000"
    if (Number.isFinite(color)) resolved = `hsla(${~~(360 * color)}, 70%,  72%)`
    if (color === "random") resolved = `hsla(${~~(360 * Math.random())}, 70%,  72%)`
    if (/^([0-9a-f]{3}){1,2}$/i.test(color)) resolved = "#" + color
    return {
        penState: { color: resolved },
        pathAction: { type: "break" }
    }
}

function show(ctx, size = 10) {
    return { penState: { showTurtle: size } }
}

function hide(ctx) {
    return { penState: { showTurtle: false } }
}

function home(ctx) {
    return jmpto(ctx, 0, 0, 0)
}

// --- Limit commands ---

function limitRecurse(ctx, limit = 361) {
    return { limits: { maxRecurseDepth: limit + 1 } }
}

function limitCommand(ctx, limit = 100000) {
    return { limits: { maxCommands: limit } }
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
    ["limitRecurse", limitRecurse],
    ["limitCommand", limitCommand],
    ["beColour", beColour]
])

// Default pen state — used by executor to initialize context
export const DEFAULT_PEN_STATE = Object.freeze({
    down: true,
    color: "silver",
    thickness: 2,
    showTurtle: 10
})
