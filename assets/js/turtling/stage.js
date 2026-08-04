// Stage — THREE.js scene infrastructure.
// Owns scene, camera, renderer, controls, groups, head, recorder, renderLoop.
// Extracted from turtle.js constructor + setupScene/Camera/Renderer.

import {
    Group,
    MOUSE,
    PerspectiveCamera,
    Scene,
    TOUCH,
    WebGLRenderer,
} from '../utils/three-entry.js'
import { DojoOrbitControls } from './orbit.js'
import Render from "./render/index.js"
import { Recorder } from "./export/recorder.js"
import { updateMaterialResolution } from "./materializer.js"
import { cameraBridge } from "../bridged.js"
// AXIS_Z is the camera's sight axis: E is in camera convention (view.js), where
// the eye looks down local −Z, so a roll is a turn about local Z.
import { SE3, AXIS_Z } from "./se3.js"

export function createStage(canvas, bridge) {
    const ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl")

    // Scene
    const scene = new Scene()

    // Groups
    const pathGroup = new Group()
    const gridGroup = new Group()
    const glyphGroup = new Group()
    glyphGroup.elements = []

    scene.add(pathGroup)
    scene.add(gridGroup)
    scene.add(glyphGroup)

    // Shapist — polygon fill renderer
    const shapist = new Render.Shape(pathGroup, {
        layerMethod: 'renderOrder',
        polygonOffset: { factor: -0.1, units: -1 }
    })

    // Camera
    const aspect = window.innerWidth / window.innerHeight
    const camera = new PerspectiveCamera(60, aspect, 0.1, 10000000)
    camera.lookAt(0, 0, 0)
    camera.position.set(0, 0, 500)
    camera.updateProjectionMatrix()

    // Controls
    const controls = new DojoOrbitControls(camera, canvas)
    controls.target.set(0, 0, 0)
    controls.mouseButtons = {
        RIGHT: MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        LEFT: MOUSE.PAN
    }
    controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }
    controls.enableDamping = true
    controls.dampingFactor = 0.2
    controls.update()

    // Zoom slides the rig along the ray under the pointer, and the standoff
    // floors the PIVOT rather than the camera — so once you reach the floor you
    // fly straight through the target at a constant step instead of asymptoting
    // at it. One law, every input: wheel, trackpad, middle-drag, two-finger
    // pinch. Arbitration (two fingers mean one thing at a time) comes with the
    // subclass; `gestureSlop` is its one knob. See turtling/orbit.js.
    controls.zoomToCursor = true

    // The manual view offset M. The rig has no roll DOF, so a finger-twist rides
    // the same model-layer seam the eye uses: effective camera = E·M·C, composed
    // in compositor.updateGroupPositions. M belongs to the HAND — the program's
    // eye is never written by a gesture. (view.js: manual orbit composes on top)
    let viewOffset = SE3.identity()
    const onTwist = ({ angle }) => {
        // The event speaks radians (atan2's unit); SE3 speaks degrees.
        viewOffset = SE3.rotateLocal(viewOffset, AXIS_Z, angle * 180 / Math.PI)
        stage.requestRender?.()
    }
    controls.addEventListener('twist', onTwist)

    // Renderer
    const renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    // `outputEncoding = sRGBEncoding` stood here and did NOTHING: three removed
    // sRGBEncoding in r152, so it assigned undefined to a property the renderer
    // no longer reads. Colour has been coming from `outputColorSpace`'s default
    // all along. Deleting it changes no pixel; setting it deliberately is a
    // separate decision nobody has taken. (three-entry.js is what made it visible)
    renderer.capabilities.logarithmicDepthBuffer = true
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.sortObjects = false

    // Recorder
    const recorder = new Recorder(canvas, {})

    // Head
    const head = new Render.Head(scene)

    // Resize handler
    const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
        // Line width is screen-space — keep cached materials' resolution current.
        updateMaterialResolution(window.innerWidth, window.innerHeight)
        stage.requestRender?.()
    }
    window.addEventListener('resize', onResize)

    // Camera bridge — responds to external camera commands.
    // cameraBridge is a module-global EventTarget; the unsub MUST run on
    // dispose, else this closure pins the whole stage (renderer/scene/camera)
    // forever and ghost handlers render stale scenes after a hook remount.
    const cameraUnsub = cameraBridge.sub(async (payload) => {
        switch (payload[0]) {
        case 'recenter':
            camera.position.set(0, 0, 500)
            controls.target.set(0, 0, 0)
            // Level the horizon too. A child who rolled the paper by accident
            // needs ONE way back, and this is it — recenter means the default
            // view, not the default view still banked.
            viewOffset = SE3.identity()
            controls.update()
            break
        case 'snap':
            // Ask for the next hatch to be kept, then say the reflect changed.
            // (This used to clear the `hatched` sentinel to trick the first-light
            // rule into firing — a doorbell wired to a phase flag.)
            stage.renderstate.snapshot = { save: true, title: payload[1].title }
            stage.reflectChanged?.()
            break
        case 'pan':
            camera.desire = (camera.desire !== "pan") ? "pan" : "track"
            break
        case 'track':
            camera.desire = (camera.desire !== "track") ? "track" : "pan"
            break
        case 'endtrack':
            camera.desire = null
            break
        case 'record':
            recorder.startRecording()
            break
        case 'endrecord': {
            const video = await recorder.stopRecording()
            bridge.pub(["saveRecord", { snapshot: video.blob, type: "video" }])
            break
        }
        }
        // Camera/recorder state changed — wake the render loop to reflect it.
        stage.requestRender?.()
    })

    // One capture at a time — hatch() swallows re-entry while the async
    // readback is in flight (the first-light retry calls it every frame).
    // dispose() flips `disposed` so a pending fence poll stands down instead
    // of touching freed GL or publishing to a dead surface.
    let hatchInFlight = false
    let disposed = false

    // Assembled stage object
    const stage = {
        canvas,
        ctx,
        scene,
        camera,
        renderer,
        controls,
        head,
        recorder,
        shapist,

        // Root groups — used only by stage.head idle rendering.
        // Per-ambient groups are created dynamically by turtle.js.
        pathGroup,
        gridGroup,
        glyphGroup,

        renderstate: {
            // `save` alone: whether the next hatch is also kept to disk. WHEN to
            // hatch is not the stage's business (hatch.js owns it).
            snapshot: { save: false },
            // The fault channel is a LIST of wounds, never a sentence — a receiver
            // interprets them (isolating the cells that hurt) without running anything.
            meta: { state: null, message: null, commands: [], diagnostics: [] }
        },

        renderLoop: null,

        // The hand's own reframe, read by the compositor each frame.
        viewOffset: () => viewOffset,

        // Render one frame
        render() {
            const scaleFactor = camera.position.distanceTo(head.position()) / 250
            head.scale(scaleFactor)
            controls.update()
            renderer.render(scene, camera)
        },

        // Snapshot for thumbnail/recording. The readback is ASYNC on WebGL2:
        // readPixels targets a PIXEL_PACK_BUFFER (returns without draining the
        // GPU) and a fence signals when the pixels are ready — a synchronous
        // readPixels here stalled the main thread ~40ms per capture. Returns
        // false when a capture is already in flight, so callers don't count
        // the call as a completed hatch.
        hatch(bridge) {
            if (hatchInFlight) return false
            const width = canvas.width
            const height = canvas.height

            const finish = (pixels) => {
                // NEVER RETAIN THE PIXELS: takeSnapshot consumes the buffer
                // below, and holding it would pin a full-canvas Uint8Array
                // (1920×993×4 ≈ 7.6MB) per tab for the life of the page.
                queueMicrotask(async () => {
                    const result = await recorder.takeSnapshot({ pixels, width, height })
                    if (result) {
                        if (stage.renderstate.snapshot.save) {
                            bridge.pub(["saveRecord", {
                                snapshot: result.full,
                                type: "image",
                                title: stage.renderstate.snapshot.title
                            }])
                            stage.renderstate.snapshot.save = false
                        }
                        stage.renderstate.meta.path = result.trimmed
                        bridge.pub(["hatchTurtle", stage.renderstate.meta])
                    }
                })
            }

            if (typeof ctx.fenceSync !== 'function') {
                // WebGL1 — no fences; the synchronous readback is the only way.
                const pixels = new Uint8Array(width * height * 4)
                ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
                finish(pixels)
                return
            }

            // Enqueue the GPU-side copy now (reads this frame's drawing buffer,
            // same as the old sync path), collect the bytes once the fence says
            // the copy landed — no pipeline stall on this thread.
            hatchInFlight = true
            const buf = ctx.createBuffer()
            ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, buf)
            ctx.bufferData(ctx.PIXEL_PACK_BUFFER, width * height * 4, ctx.STREAM_READ)
            ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, 0)
            ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
            const sync = ctx.fenceSync(ctx.SYNC_GPU_COMMANDS_COMPLETE, 0)
            ctx.flush()

            const poll = () => {
                if (disposed || ctx.isContextLost()) {
                    // Stand down, but hand the GL objects back first: bailing
                    // straight out leaks the fence and the pack buffer.
                    hatchInFlight = false
                    if (!ctx.isContextLost()) { ctx.deleteSync(sync); ctx.deleteBuffer(buf) }
                    return
                }
                const status = ctx.clientWaitSync(sync, 0, 0)
                if (status === ctx.TIMEOUT_EXPIRED) { setTimeout(poll, 8); return }
                ctx.deleteSync(sync)
                hatchInFlight = false
                if (status === ctx.WAIT_FAILED) { ctx.deleteBuffer(buf); return }
                const pixels = new Uint8Array(width * height * 4)
                ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, buf)
                ctx.getBufferSubData(ctx.PIXEL_PACK_BUFFER, 0, pixels)
                ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
                ctx.deleteBuffer(buf)
                finish(pixels)
            }
            setTimeout(poll, 0)
        },

        // Cleanup
        dispose() {
            disposed = true
            window.removeEventListener('resize', onResize)
            controls.removeEventListener('twist', onTwist)
            cameraUnsub()
            controls.dispose()   // OrbitControls' own pointer/touch listeners
            if (stage.renderLoop) stage.renderLoop.stop()
            head.dispose()
            renderer.dispose()
            shapist.dispose()
        }
    }

    return stage
}
