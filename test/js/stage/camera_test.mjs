// Camera commands address one view. A page-global channel is the shell's
// routing choice, not something a stage subscribes to by being constructed.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { applyViewCommand } from "../../../assets/js/turtling/camera_command.js"

function view(x) {
    const state = { x, y: 0, z: 0 }
    return {
        camera: {
            position: { set(nx, ny, nz) { state.x = nx; state.y = ny; state.z = nz } },
            desire: null,
        },
        controls: { target: { set() {} }, update() {} },
        level() { this.leveled = true },
        at: () => state.x,
    }
}

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const stageSrc = strip(readFileSync(new URL("../../../assets/js/turtling/stage.js", import.meta.url), "utf8"))
const innerSrc = strip(readFileSync(new URL("../../../assets/js/hooks/shell/inner.js", import.meta.url), "utf8"))

describe("one camera command, one view", () => {
    test("recenter moves the view it is given", () => {
        const a = view(12)
        const b = view(40)
        applyViewCommand(a, "recenter")
        assert.equal(a.at(), 0)
        assert.equal(a.camera.position && a.at(), 0)
        assert.equal(b.at(), 40)
        assert.equal(a.leveled, true)
        assert.equal(b.leveled, undefined)
    })

    test("the stage does not subscribe to the page camera channel", () => {
        assert.equal(/cameraBridge/.test(stageSrc), false)
        assert.match(stageSrc, /async command\(payload\)/)
        assert.match(innerSrc, /cameraBridge\.sub\(/)
        assert.match(innerSrc, /turtle\.stage\.command/)
        assert.match(innerSrc, /arena\.add\(stopCamera\)/)
    })
})
