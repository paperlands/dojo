// Stage — THREE.js scene infrastructure.
// Owns scene, camera, renderer, controls, groups, head, instruments, renderLoop.
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
import { createMaterialCache } from "./render/line/material-cache.js"
import { cameraBridge } from "../bridged.js"
// AXIS_Z is the camera's sight axis: E is in camera convention (view.js), where
// the eye looks down local −Z, so a roll is a turn about local Z.
import { SE3, AXIS_Z } from "./se3.js"

export function createStage(canvas, bridge, instruments = {}) {
    const ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl")

    // Material cache (spec A3) rides the WebGL lifetime. Owned here so
    // stage.dispose() always reclaims — remount cannot leak by forgetting a free.
    const materials = createMaterialCache()

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

    // Standoff floors the PIVOT, not the camera — past the floor you fly
    // straight through the target instead of asymptoting at it. One law for
    // every zoom input (wheel/trackpad/pinch); gesture arbitration lives in orbit.js.
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
    // `outputEncoding` was removed in three r152 — setting it here did nothing;
    // colour comes from `outputColorSpace`'s default. Deleting it changes no
    // pixel (three-entry.js made the dead assignment visible).
    //renderer.capabilities.logarithmicDepthBuffer = true
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.sortObjects = false

    // INSTRUMENTS — video and stills are application machinery. A host
    // supplies none, so mediabunny never enters its bundle. Built on the
    // first record or snapshot, never on a status read, never at construction.
    //
    // Duck-typed: { isRecording, captureFrame(), takeSnapshot(),
    // startRecording(), stopRecording() }. A snapshot-only duck is enough
    // for a still; it need not be the video Recorder.
    let recorder = null
    let recorderResolved = false
    function getRecorder() {
        if (recorderResolved) return recorder
        if (typeof instruments.recorder !== "function") {
            recorderResolved = true
            return null
        }
        // A throw leaves the seam unresolved, so the next ask may retry.
        recorder = instruments.recorder(canvas) ?? null
        recorderResolved = true
        return recorder
    }


    // Head
    const head = new Render.Head(scene)

    // Resize handler
    const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
        // Line width is screen-space — keep cached materials' resolution current.
        materials.updateResolution(window.innerWidth, window.innerHeight)
        stage.requestRender?.()
    }
    window.addEventListener('resize', onResize)

    // cameraBridge is a module-global EventTarget — unsub MUST run on dispose,
    // else this closure pins the whole stage (renderer/scene/camera) forever
    // and ghost handlers render stale scenes after a hook remount.
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
        case 'snap': {
            // ASK A FILE, NOT A KEEP (id:kc-p-join). Durability left this
            // command: the keep is minted at the door owner's seat on the
            // child's word. What remains is the download and its filename.
            const p = payload[1] ?? {}
            stage.renderstate.snapshot = { save: true, title: p.title }
            stage.reflectChanged?.()
            break
        }
        case 'pan':
            camera.desire = (camera.desire !== "pan") ? "pan" : "track"
            break
        case 'track':
            camera.desire = (camera.desire !== "track") ? "track" : "pan"
            break
        case 'endtrack':
            camera.desire = null
            break
        case 'record': {
            try {
                const rec = getRecorder()
                if (rec) await rec.startRecording()
            } catch (err) {
                console.error('record failed:', err)
            }
            break
        }
        case 'endrecord': {
            // Peek. Stopping must not construct an encoder that never started.
            try {
                const video = recorder ? await recorder.stopRecording() : null
                if (video) bridge.pub(["saveRecord", { snapshot: video.blob, type: "video" }])
            } catch (err) {
                console.error('endrecord failed:', err)
            }
            break
        }
        }
        // Camera/recorder state changed — wake the render loop to reflect it.
        stage.requestRender?.()
    })

    // One capture: one promise. hatch() starts the work (or joins it).
    // dispose() flips `disposed` so a pending fence poll stands down instead
    // of touching freed GL or publishing to a dead surface.
    let hatchInFlight = false
    let disposed = false
    /** @type {Promise<string | null> | null} */
    let hatchP = null
    /** @type {((path: string | null) => void) | null} */
    let resolveHatch = null

    function picture() {
        if (!hatchP) {
            hatchP = new Promise((r) => { resolveHatch = r })
        }
        return hatchP
    }

    function settle(path) {
        const r = resolveHatch
        hatchP = null
        resolveHatch = null
        hatchInFlight = false
        if (r) r(path)
    }

    // Assembled stage object
    const stage = {
        canvas,
        ctx,
        scene,
        camera,
        renderer,
        controls,
        head,
        get recorder() { return recorder },
        shapist,
        // LineMaterial cache (spec A3) — WebGL-lifetime owner; dispose() frees it.
        materials,

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

        get hatching() { return hatchInFlight },

        // The picture this hatch will produce. A keep borrows this; hatch()
        // starts the work after the frame has been drawn.
        picture() { return picture() },

        // WebGL2 readback is ASYNC: PIXEL_PACK_BUFFER + fence, never a sync
        // readPixels (stalled the main thread). Returns the picture promise.
        // In-flight joins the same promise; lastHatchAt stamps only a start.
        hatch(bridge) {
            const p = picture()
            if (hatchInFlight || disposed) {
                if (disposed) settle(null)
                return p
            }
            hatchInFlight = true
            const width = canvas.width
            const height = canvas.height

            const finish = (pixels) => {
                // NEVER RETAIN THE PIXELS: takeSnapshot consumes the buffer
                // below, and holding it would pin a full-canvas Uint8Array
                // (1920×993×4 ≈ 7.6MB) per tab for the life of the page.
                queueMicrotask(async () => {
                    try {
                        const rec = getRecorder()
                        const result = rec ? await rec.takeSnapshot({ pixels, width, height }) : null
                        if (result) {
                            // The file, if one was asked for — read the flag before
                            // the clear, and clear it whole (id:kb-7-stage).
                            const snap = stage.renderstate.snapshot
                            if (snap.save) {
                                stage.renderstate.snapshot = { save: false }
                                bridge.pub(["saveRecord", {
                                    snapshot: result.full,
                                    type: "image",
                                    title: snap.title ?? null,
                                }])
                            }
                            // The stage returns a PICTURE and world meta — never an
                            // ask (id:kj-types). `full` is the file's; `trimmed` is
                            // the one the keep and the clan share.
                            stage.renderstate.meta.path = result.trimmed
                            bridge.pub(["hatchTurtle", { ...stage.renderstate.meta }])
                            settle(result.trimmed ?? null)
                            return
                        }
                    } catch {
                        /* encode died — a keep waiting on this capture hears null */
                    }
                    settle(null)
                })
            }

            if (typeof ctx.fenceSync !== 'function') {
                // WebGL1 — no fences; the synchronous readback is the only way.
                const pixels = new Uint8Array(width * height * 4)
                ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
                finish(pixels)
                return p
            }

            // Enqueue the GPU-side copy now (reads this frame's drawing buffer,
            // same as the old sync path), collect the bytes once the fence says
            // the copy landed — no pipeline stall on this thread.
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
                    if (!ctx.isContextLost()) { ctx.deleteSync(sync); ctx.deleteBuffer(buf) }
                    settle(null)
                    return
                }
                const status = ctx.clientWaitSync(sync, 0, 0)
                if (status === ctx.TIMEOUT_EXPIRED) { setTimeout(poll, 8); return }
                ctx.deleteSync(sync)
                if (status === ctx.WAIT_FAILED) {
                    ctx.deleteBuffer(buf)
                    settle(null)
                    return
                }
                const pixels = new Uint8Array(width * height * 4)
                ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, buf)
                ctx.getBufferSubData(ctx.PIXEL_PACK_BUFFER, 0, pixels)
                ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
                ctx.deleteBuffer(buf)
                finish(pixels)
            }
            setTimeout(poll, 0)
            return p
        },

        // Cleanup
        dispose() {
            disposed = true
            settle(null)
            // Free the encoder only if one was built. Dispose must not construct one.
            try {
                if (recorderResolved) recorder?.destroy?.()
            } catch (err) {
                console.error('recorder destroy failed:', err)
            }
            window.removeEventListener('resize', onResize)
            controls.removeEventListener('twist', onTwist)
            cameraUnsub()
            controls.dispose()   // OrbitControls' own pointer/touch listeners
            if (stage.renderLoop) stage.renderLoop.stop()
            // Own the free: remount safety is structural, not a caller checklist.
            materials.dispose()
            head.dispose()
            renderer.dispose()
            shapist.dispose()
        }
    }

    return stage
}
