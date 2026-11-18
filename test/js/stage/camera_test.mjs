// Camera commands address one view. A page-global channel is the shell's
// routing choice, not something a stage subscribes to by being constructed.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { applyViewCommand } from "../../../assets/js/turtling/camera_command.js"
import { PerspectiveCamera } from '../../../assets/js/utils/three-entry.js'
import { OrbitControls } from '../../../assets/js/utils/threeorbital.js'
import { DojoOrbitControls } from '../../../assets/js/turtling/orbit.js'

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

// The vendor calls the virtual update() before subclass configuration exists.
// Direct construction must need no stage-side target repair. (id:host-input-wheel)
for (const wheel of ['always', 'modifier', 'none']) {
    test(`constructor keeps a finite, stationary rig under ${wheel}`, () => {
        const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 10000)
        camera.position.set(0, 0, 500)
        const baseline = camera.clone()
        const stock = new OrbitControls(baseline)
        const controls = new DojoOrbitControls(camera, null, { wheel })
        assert.ok(controls.target.toArray().every(Number.isFinite), 'constructor target must be finite')
        assert.deepEqual(controls.target.toArray(), stock.target.toArray())
        assert.deepEqual(camera.position.toArray(), baseline.position.toArray())
        const held = [camera.position.toArray(), controls.target.toArray(), camera.quaternion.toArray()]
        controls.update()
        controls.update()
        assert.deepEqual([camera.position.toArray(), controls.target.toArray(), camera.quaternion.toArray()], held)
    })
}

test('configured dolly-through still floors the pivot, not the camera', () => {
    const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 10000)
    camera.position.set(0, 0, 500)
    const controls = new DojoOrbitControls(camera)
    camera.position.set(0, 0, 5)
    controls.update()
    assert.ok(Math.abs(camera.position.z - 5) < 1e-10)
    assert.ok(Math.abs(controls.target.z + 25) < 1e-10)
    assert.ok(Math.abs(camera.position.distanceTo(controls.target) - 30) < 1e-10)
    const held = camera.position.clone()
    controls.update()
    assert.ok(camera.position.distanceTo(held) < 1e-10)
})

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
