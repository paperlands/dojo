// Phase 1 command tests — run with: node --test test/js/commands_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { COMMANDS, DEFAULT_PEN_STATE } from "../../assets/js/turtling/commands.js"
import { SE3 } from "../../assets/js/turtling/se3.js"

// Helper: build command context from transform + optional pen overrides
function mkCtx(transform, penOverrides = {}) {
    return {
        transform,
        penState: { ...DEFAULT_PEN_STATE, ...penOverrides }
    }
}

function identity() {
    return SE3.identity()
}

const near = (a, b, eps = 1e-8) => Math.abs(a - b) < eps

// ---------------------------------------------------------------------------
// Movement commands
// ---------------------------------------------------------------------------

describe("fw (forward)", () => {
    const fw = COMMANDS.get("fw")

    test("moves along +x when facing identity", () => {
        const result = fw(mkCtx(identity()), 100)
        assert.ok(near(result.transform.position[0], 100))
        assert.ok(near(result.transform.position[1], 0))
        assert.ok(near(result.transform.position[2], 0))
    })

    test("moves along +y after 90 yaw", () => {
        const t = SE3.rotateLocal(identity(), { x: 0, y: 0, z: 1 }, 90)
        const result = fw(mkCtx(t), 100)
        assert.ok(near(result.transform.position[0], 0))
        assert.ok(near(result.transform.position[1], 100))
    })

    test("extends path when pen is down", () => {
        const result = fw(mkCtx(identity()), 50)
        assert.equal(result.pathAction.type, "extend")
        assert.ok(Array.isArray(result.pathAction.point))
    })

    test("breaks path when pen is up", () => {
        const result = fw(mkCtx(identity(), { down: false }), 50)
        assert.equal(result.pathAction.type, "break")
    })

    test("preserves rotation", () => {
        const t = SE3.rotateLocal(identity(), { x: 0, y: 0, z: 1 }, 45)
        const result = fw(mkCtx(t), 100)
        assert.equal(result.transform.rotation.w, t.rotation.w)
        assert.equal(result.transform.rotation.z, t.rotation.z)
    })

    test("default distance is 0", () => {
        const result = fw(mkCtx(identity()))
        assert.ok(near(result.transform.position[0], 0))
    })
})

describe("goto", () => {
    const goTo = COMMANDS.get("goto")

    test("sets absolute position", () => {
        const result = goTo(mkCtx(identity()), 50, 75)
        assert.ok(near(result.transform.position[0], 50))
        assert.ok(near(result.transform.position[1], 75))
    })

    test("preserves z when not specified", () => {
        const t = { ...identity(), position: [0, 0, 42] }
        const result = goTo(mkCtx(t), 10, 20)
        assert.ok(near(result.transform.position[2], 42))
    })

    test("sets z when specified", () => {
        const result = goTo(mkCtx(identity()), 10, 20, 30)
        assert.ok(near(result.transform.position[2], 30))
    })

    test("extends path when pen is down", () => {
        const result = goTo(mkCtx(identity()), 50, 50)
        assert.equal(result.pathAction.type, "extend")
    })

    test("breaks path when pen is up", () => {
        const result = goTo(mkCtx(identity(), { down: false }), 50, 50)
        assert.equal(result.pathAction.type, "break")
    })
})

describe("jmpto", () => {
    const jmpto = COMMANDS.get("jmpto")

    test("moves to position without drawing", () => {
        const result = jmpto(mkCtx(identity()), 100, 200)
        assert.ok(near(result.transform.position[0], 100))
        assert.ok(near(result.transform.position[1], 200))
        assert.equal(result.pathAction.type, "break")
    })
})

describe("jmp", () => {
    const jmp = COMMANDS.get("jmp")

    test("jumps forward without drawing", () => {
        const result = jmp(mkCtx(identity()), 100)
        assert.ok(near(result.transform.position[0], 100))
        assert.equal(result.pathAction.type, "break")
    })

    test("respects current heading", () => {
        const t = SE3.rotateLocal(identity(), { x: 0, y: 0, z: 1 }, 90)
        const result = jmp(mkCtx(t), 100)
        assert.ok(near(result.transform.position[0], 0))
        assert.ok(near(result.transform.position[1], 100))
    })
})

describe("home", () => {
    const home = COMMANDS.get("home")

    test("returns to origin", () => {
        const t = SE3.translateLocal(identity(), 100, 200, 300)
        const result = home(mkCtx(t))
        assert.ok(near(result.transform.position[0], 0))
        assert.ok(near(result.transform.position[1], 0))
        assert.ok(near(result.transform.position[2], 0))
    })
})

// ---------------------------------------------------------------------------
// Rotation commands
// ---------------------------------------------------------------------------

describe("rotation commands", () => {
    const rt = COMMANDS.get("rt")
    const lt = COMMANDS.get("lt")
    const yaw = COMMANDS.get("yaw")
    const pitch = COMMANDS.get("pitch")
    const roll = COMMANDS.get("roll")
    const dive = COMMANDS.get("dive")

    test("rt 90 then fw 100 goes along -y (right turn)", () => {
        const r = rt(mkCtx(identity()), 90)
        // rt is yaw(-angle), so 90 right = -90 yaw
        const fw = COMMANDS.get("fw")
        const m = fw(mkCtx(r.transform), 100)
        assert.ok(near(m.transform.position[0], 0))
        assert.ok(near(m.transform.position[1], -100))
    })

    test("lt 90 then fw 100 goes along +y (left turn)", () => {
        const l = lt(mkCtx(identity()), 90)
        const fw = COMMANDS.get("fw")
        const m = fw(mkCtx(l.transform), 100)
        assert.ok(near(m.transform.position[0], 0))
        assert.ok(near(m.transform.position[1], 100))
    })

    test("yaw 90 == lt 90", () => {
        const y = yaw(mkCtx(identity()), 90)
        const l = lt(mkCtx(identity()), 90)
        assert.ok(near(y.transform.rotation.w, l.transform.rotation.w))
        assert.ok(near(y.transform.rotation.z, l.transform.rotation.z))
    })

    test("dive is alias for pitch", () => {
        const p = pitch(mkCtx(identity()), 45)
        const d = dive(mkCtx(identity()), 45)
        assert.ok(near(p.transform.rotation.w, d.transform.rotation.w))
        assert.ok(near(p.transform.rotation.y, d.transform.rotation.y))
    })

    test("roll rotates around x axis", () => {
        const r = roll(mkCtx(identity()), 90)
        // After 90 roll around x, fw should still go along +x
        const fw = COMMANDS.get("fw")
        const m = fw(mkCtx(r.transform), 100)
        assert.ok(near(m.transform.position[0], 100))
    })

    test("rotation preserves position", () => {
        const t = SE3.translateLocal(identity(), 50, 30, 10)
        const r = rt(mkCtx(t), 45)
        assert.deepEqual(r.transform.position, t.position)
    })

    test("no events from rotation commands", () => {
        const r = rt(mkCtx(identity()), 90)
        assert.equal(r.events, undefined)
        assert.equal(r.pathAction, undefined)
    })
})

// ---------------------------------------------------------------------------
// faceto
// ---------------------------------------------------------------------------

describe("faceto", () => {
    const faceto = COMMANDS.get("faceto")
    const fw = COMMANDS.get("fw")

    test("face along +x direction", () => {
        const t = { ...identity(), position: [0, 0, 0] }
        const result = faceto(mkCtx(t), 100, 0)
        const m = fw(mkCtx(result.transform), 50)
        assert.ok(near(m.transform.position[0], 50))
        assert.ok(near(m.transform.position[1], 0))
    })

    test("face along +y direction", () => {
        const result = faceto(mkCtx(identity()), 0, 100)
        const m = fw(mkCtx(result.transform), 50)
        assert.ok(near(m.transform.position[0], 0))
        assert.ok(near(m.transform.position[1], 50))
    })

    test("face along -x direction", () => {
        const result = faceto(mkCtx(identity()), -100, 0)
        const m = fw(mkCtx(result.transform), 50)
        assert.ok(near(m.transform.position[0], -50))
        assert.ok(near(m.transform.position[1], 0))
    })

    test("no-op when target is at current position", () => {
        const result = faceto(mkCtx(identity()), 0, 0, 0)
        assert.equal(result.transform, undefined)
    })

    test("preserves current z when targetZ is null", () => {
        const t = { ...identity(), position: [0, 0, 42] }
        const result = faceto(mkCtx(t), 100, 0)
        assert.ok(near(result.transform.position[2], 42))
    })
})

// ---------------------------------------------------------------------------
// Event-producing commands
// ---------------------------------------------------------------------------

describe("label", () => {
    const label = COMMANDS.get("label")

    test("produces label event at current position", () => {
        const t = SE3.translateLocal(identity(), 10, 20, 30)
        const result = label(mkCtx(t), "hello", 2)
        assert.equal(result.events.length, 1)
        assert.equal(result.events[0].type, "label")
        assert.deepEqual(result.events[0].position, [10, 20, 30])
        assert.equal(result.events[0].text, "hello")
        assert.equal(result.events[0].textSize, 10) // 2 * 5
    })

    test("defaults to dot character", () => {
        const result = label(mkCtx(identity()))
        assert.equal(result.events[0].text, ".")
    })

    test("does not modify transform", () => {
        const result = label(mkCtx(identity()), "test")
        assert.equal(result.transform, undefined)
    })
})

describe("grid", () => {
    const grid = COMMANDS.get("grid")

    test("produces grid event", () => {
        const result = grid(mkCtx(identity()), 10, 5)
        assert.equal(result.events.length, 1)
        assert.equal(result.events[0].type, "grid")
        assert.equal(result.events[0].size, 50)    // 10 * 5
        assert.equal(result.events[0].divisions, 10)
    })

    test("applies 90 degree x rotation to grid", () => {
        const result = grid(mkCtx(identity()))
        const rot = result.events[0].rotation
        // Identity * 90x rotation: w ≈ cos(45°), x ≈ sin(45°)
        assert.ok(near(rot.w, Math.cos(Math.PI / 4)))
        assert.ok(near(rot.x, Math.sin(Math.PI / 4)))
    })
})

describe("erase", () => {
    const erase = COMMANDS.get("erase")

    test("produces clear event and breaks path", () => {
        const result = erase(mkCtx(identity()))
        assert.equal(result.events[0].type, "clear")
        assert.equal(result.pathAction.type, "break")
    })
})

describe("fill", () => {
    const fill = COMMANDS.get("fill")

    test("produces fill path action", () => {
        const result = fill(mkCtx(identity()))
        assert.equal(result.pathAction.type, "fill")
    })
})

describe("wait", () => {
    const wait = COMMANDS.get("wait")

    test("produces wait event with duration in ms", () => {
        const result = wait(mkCtx(identity()), 2)
        assert.equal(result.events[0].type, "wait")
        assert.equal(result.events[0].duration, 2000)
    })

    test("captures current position and rotation", () => {
        const t = SE3.translateLocal(identity(), 10, 20, 30)
        const result = wait(mkCtx(t))
        assert.deepEqual(result.events[0].position, [10, 20, 30])
    })
})

// ---------------------------------------------------------------------------
// Pen state commands
// ---------------------------------------------------------------------------

describe("pen state commands", () => {
    const bold = COMMANDS.get("bold")
    const beColour = COMMANDS.get("beColour")
    const show = COMMANDS.get("show")
    const hide = COMMANDS.get("hide")
    const hd = COMMANDS.get("hd")

    test("bold sets thickness * 2", () => {
        const result = bold(mkCtx(identity()), 3)
        assert.equal(result.penState.thickness, 6)
    })

    test("beColour resolves named colors", () => {
        const result = beColour(mkCtx(identity()), "red")
        assert.equal(result.penState.color, "red")
    })

    test("beColour resolves invisible", () => {
        const result = beColour(mkCtx(identity()), "invisible")
        assert.equal(result.penState.color, "#00000000")
    })

    test("beColour resolves numeric to hsla", () => {
        const result = beColour(mkCtx(identity()), 0.5)
        assert.ok(result.penState.color.startsWith("hsla("))
    })

    test("beColour resolves random", () => {
        const result = beColour(mkCtx(identity()), "random")
        assert.ok(result.penState.color.startsWith("hsla("))
    })

    test("beColour resolves hex shorthand", () => {
        const result = beColour(mkCtx(identity()), "ff0")
        assert.equal(result.penState.color, "#ff0")
    })

    test("beColour breaks path for color change", () => {
        const result = beColour(mkCtx(identity()), "red")
        assert.equal(result.pathAction.type, "break")
    })

    test("show sets showTurtle to size", () => {
        const result = show(mkCtx(identity()), 15)
        assert.equal(result.penState.showTurtle, 15)
    })

    test("hide sets showTurtle to false", () => {
        const result = hide(mkCtx(identity()))
        assert.equal(result.penState.showTurtle, false)
    })

    test("hd is alias for hide", () => {
        const r1 = hide(mkCtx(identity()))
        const r2 = hd(mkCtx(identity()))
        assert.deepEqual(r1, r2)
    })
})

// ---------------------------------------------------------------------------
// Limit commands
// ---------------------------------------------------------------------------

describe("limit commands", () => {
    const limitRecurse = COMMANDS.get("limitRecurse")
    const limitCommand = COMMANDS.get("limitCommand")

    test("limitRecurse sets maxRecurseDepth + 1", () => {
        const result = limitRecurse(mkCtx(identity()), 500)
        assert.equal(result.limits.maxRecurseDepth, 501)
    })

    test("limitCommand sets maxCommands", () => {
        const result = limitCommand(mkCtx(identity()), 50000)
        assert.equal(result.limits.maxCommands, 50000)
    })
})

// ---------------------------------------------------------------------------
// COMMANDS map completeness
// ---------------------------------------------------------------------------

describe("COMMANDS map", () => {
    const expected = [
        "fw", "rt", "lt", "yaw", "pitch", "dive", "roll",
        "show", "hide", "hd", "jmp", "bold", "grid",
        "goto", "faceto", "jmpto", "label", "erase", "home",
        "fill", "wait", "limitRecurse", "limitCommand", "beColour"
    ]

    test("contains all expected commands", () => {
        for (const name of expected) {
            assert.ok(COMMANDS.has(name), `missing command: ${name}`)
        }
    })

    test("all entries are functions", () => {
        for (const [name, fn] of COMMANDS) {
            assert.equal(typeof fn, "function", `${name} is not a function`)
        }
    })

    test("matches turtle.js command count (24)", () => {
        assert.equal(COMMANDS.size, 24)
    })
})

// ---------------------------------------------------------------------------
// Integration: L-shape via pure commands
// ---------------------------------------------------------------------------

describe("integration", () => {
    const fw = COMMANDS.get("fw")
    const rt = COMMANDS.get("rt")
    const lt = COMMANDS.get("lt")

    test("fw 100 rt 90 fw 100 produces L-shape (right turn)", () => {
        let t = identity()
        t = fw(mkCtx(t), 100).transform       // at [100, 0, 0]
        t = rt(mkCtx(t), 90).transform         // facing -y
        t = fw(mkCtx(t), 100).transform        // at [100, -100, 0]
        assert.ok(near(t.position[0], 100))
        assert.ok(near(t.position[1], -100))
        assert.ok(near(t.position[2], 0))
    })

    test("fw 100 lt 90 fw 100 produces L-shape (left turn)", () => {
        let t = identity()
        t = fw(mkCtx(t), 100).transform
        t = lt(mkCtx(t), 90).transform
        t = fw(mkCtx(t), 100).transform
        assert.ok(near(t.position[0], 100))
        assert.ok(near(t.position[1], 100))
        assert.ok(near(t.position[2], 0))
    })

    test("square: 4x (fw 100 rt 90) returns near origin", () => {
        let t = identity()
        for (let i = 0; i < 4; i++) {
            t = fw(mkCtx(t), 100).transform
            t = rt(mkCtx(t), 90).transform
        }
        assert.ok(near(t.position[0], 0))
        assert.ok(near(t.position[1], 0))
        assert.ok(near(t.position[2], 0))
    })

    test("circle: 360x (fw 1 rt 1) returns near origin", () => {
        let t = identity()
        for (let i = 0; i < 360; i++) {
            t = fw(mkCtx(t), 1).transform
            t = rt(mkCtx(t), 1).transform
        }
        assert.ok(Math.abs(t.position[0]) < 2, `x=${t.position[0]}`)
        assert.ok(Math.abs(t.position[1]) < 2, `y=${t.position[1]}`)
    })

    test("path events track pen state correctly", () => {
        const ctx = mkCtx(identity())
        const r1 = fw(ctx, 50)
        assert.equal(r1.pathAction.type, "extend")

        const ctxUp = mkCtx(r1.transform, { down: false })
        const r2 = fw(ctxUp, 50)
        assert.equal(r2.pathAction.type, "break")
    })
})
