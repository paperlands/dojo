// Stage — THREE.js scene infrastructure.
// Owns scene, camera, renderer, controls, groups, head, instruments, renderLoop.
// Extracted from turtle.js constructor + setupScene/Camera/Renderer.

import {
    MOUSE,
    PerspectiveCamera,
    Raycaster,
    Scene,
    TOUCH,
    Vector2,
    Vector3,
    WebGLRenderer,
} from '../utils/three-entry.js'
import { DojoOrbitControls } from './orbit.js'
import Render from "./render/index.js"
import { createMaterialCache } from "./render/line/material-cache.js"
import { surfaceOfCanvas, observeSurface, contentRectOf, projectClient } from "./viewport.js"
import { applyViewCommand } from "./camera_command.js"
// AXIS_Z is the camera's sight axis: E is in camera convention (view.js), where
// the eye looks down local −Z, so a roll is a turn about local Z.
import { SE3, AXIS_Z } from "./se3.js"
import { CLIENT_SPACE } from "./laws/handle.js"
import { fitPose } from "./laws/fit.js"

import { createCapture, copyBody, copyLayers, copyValue, makeSurface } from "./capture.js"
export function createStage(canvas, bridge, instruments = {}) {
    const ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl")

    // Material cache (spec A3) rides the WebGL lifetime. Owned here so
    // stage.dispose() always reclaims — remount cannot leak by forgetting a free.
    const materials = createMaterialCache()

    // Scene
    const scene = new Scene()

    // Camera, bitmap and line resolution share the canvas's content box.
    // The window stands in only for an unavailable surface. (id:host-surface)
    let surface = surfaceOfCanvas(canvas)
    // What the surface was last measured as, and the bitmap that measurement
    // produced. `applySurface` reads them to tell a page-sized canvas from an
    // unsized one that is following its own bitmap (see the echo, below).
    let applied = null
    const aspect = surface && surface.width > 0 && surface.height > 0 ? surface.width / surface.height : 1
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
    // `outputEncoding` was removed in three r152 — setting it here did nothing;
    // colour comes from `outputColorSpace`'s default. Deleting it changes no
    // pixel (three-entry.js made the dead assignment visible).
    //renderer.capabilities.logarithmicDepthBuffer = true
    renderer.sortObjects = false
    applySurface()

    // Video and stills are an instrument, not paper: absent, the encoder stays out.
    // Built on first record or snapshot, never on a status read. It records the
    // Canvas alone; a recording has no pointer. (id:laws-decl-interface)
    let recorder = null
    let recorderResolved = false
    function getRecorder() {
        if (recorderResolved) return recorder
        if (typeof instruments.recorder !== "function") {
            recorderResolved = true
            return null
        }
        recorder = instruments.recorder(canvas) ?? null
        recorderResolved = true
        return recorder
    }

    // Head
    const head = new Render.Head(scene)

    // An unsized canvas follows its bitmap: at DPR 2, each write doubles the box.
    // Pin that echo to the last measured box; page-authored sizes still win.
    // (id:host-surface)
    function applySurface() {
        const next = surfaceOfCanvas(canvas)
        if (!next) return
        // Collapsed is a measured zero. Keep the projection already in hand —
        // camera, buffer — and do not adopt the window or write a size over
        // the page's zero.
        if (next.collapsed) return
        // An echo grows to our last bitmap at the same DPR. A steady box,
        // collapsed surface or CSS transform is not an echo. (id:host-surface)
        const echoed = !!applied && !next.collapsed && !next.transformed
            && next.dpr === applied.dpr
            && (next.width > applied.boxWidth + 1 || next.height > applied.boxHeight + 1)
            && Math.abs(next.width - applied.bufferWidth) < 1
            && Math.abs(next.height - applied.bufferHeight) < 1
        // Pinning is to the box measured BEFORE the echo, never the grown one:
        // the grown one is the artifact being stopped.
        surface = echoed
            ? { ...next, width: applied.boxWidth, height: applied.boxHeight }
            : next
        camera.aspect = surface.width / surface.height
        camera.updateProjectionMatrix()
        renderer.setPixelRatio(surface.dpr)
        // Write layout only for an unavailable box or our own bitmap echo.
        // Otherwise the page owns its width and height. (id:host-surface)
        renderer.setSize(surface.width, surface.height, surface.windowed || echoed)
        applied = {
            boxWidth: surface.width, boxHeight: surface.height, dpr: surface.dpr,
            bufferWidth: canvas.width, bufferHeight: canvas.height,
        }
        // Line width is screen-space — keep cached materials' resolution current.
        materials.updateResolution(surface.width, surface.height)
    }
    const onResize = () => {
        applySurface()
        stage.requestRender?.()
    }
    // A ResizeObserver cannot see a device ratio change, so the ratio is watched
    // too (viewport.js). Both are unsubscribed on dispose.
    const stopSurface = observeSurface(canvas, onResize)

    // Camera commands address THIS stage. The shell may route a page control
    // here; an embedded runtime does not subscribe to a page-global channel.
    // The subscriber owns the unsubscription.

    // One active cut, one unissued demand. dispose settles both.
    const caps = createCapture()
    let disposed = false
    // The picture's surfaces above this canvas, in paint order. Set by whoever
    // draws marks on their own layer; a lazy read, so a disposed layer reads null.
    let overlayOf = () => null

    // Points project into client/CSS pixels against the canvas bounds and the
    // current camera. Invisible points have no marker or hit target.
    const _project = new Vector3()
    const _ndc = new Vector2()
    const _raycaster = new Raycaster()
    const _facing = new Vector3()

    // Assembled stage object
    const stage = {
        canvas,
        // The space this stage projects into, named once. The overlay is built to
        // occupy the same space, so nothing has to assume they agree.
        space: CLIENT_SPACE,
        ctx,
        scene,
        camera,
        renderer,
        controls,

        project(world) {
            const rect = contentRectOf(canvas)
            _project.set(world[0], world[1], world[2]).project(camera)
            if (_project.z > 1) return null                     // behind the eye, or past the far plane
            // CSS transform has no client mapping. An unsupported box projects
            // to nothing rather than to a point in a mixed coordinate space.
            return projectClient(rect, _project.x, _project.y)
        },

        // One command, this instance. Record stays here because the recorder
        // and the save bridge belong to the stage, not to the view arithmetic.
        async command(payload) {
            if (disposed) return
            const name = payload?.[0]
            if (name === "fit") {
                const framed = stage.fitTargets?.()
                if (framed?.bounds) stage.fitTo(framed.bounds, { dir: framed.dir })
            } else if (!applyViewCommand({
                camera,
                controls,
                level() { viewOffset = SE3.identity() },
            }, name)) {
                if (name === "record") {
                    try {
                        const rec = getRecorder()
                        if (rec) await rec.startRecording()
                    } catch (err) {
                        console.error("record failed:", err)
                    }
                } else if (name === "endrecord") {
                    try {
                        const video = recorder ? await recorder.stopRecording() : null
                        if (video) bridge.pub(["saveRecord", { snapshot: video.blob, type: "video" }])
                    } catch (err) {
                        console.error("endrecord failed:", err)
                    }
                }
            }
            stage.requestRender?.()
        },

        // Frame a figure from its world extents. A view change only — no
        // geometry, no law, no revision; the mark keeps its true size.
        // (id:laws-freedom)
        fitTargets: null,
        fitTo(bounds, { dir = null, margin = 1.12 } = {}) {
            const pose = fitPose(bounds, {
                dir: dir ?? undefined,
                fovDeg: camera.fov,
                aspect: camera.aspect,
                floor: controls.dollyStandoff,
                margin,
            })
            if (!pose) return null
            camera.position.set(pose.position[0], pose.position[1], pose.position[2])
            controls.target.set(pose.target[0], pose.target[1], pose.target[2])
            camera.updateProjectionMatrix?.()
            controls.update()
            stage.requestRender?.()
            return pose
        },

        // The camera's world viewing direction. The drag plane faces it — the
        // camera's plane through a point, never the point's line of sight.
        facing() {
            camera.getWorldDirection(_facing)
            return [_facing.x, _facing.y, _facing.z]
        },

        unproject(clientX, clientY) {
            const rect = contentRectOf(canvas)
            if (!rect.width || !rect.height) return null
            const nx = ((clientX - rect.left) / rect.width) * 2 - 1
            const ny = -((clientY - rect.top) / rect.height) * 2 + 1
            if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null
            _raycaster.setFromCamera(_ndc.set(nx, ny), camera)
            const { origin, direction } = _raycaster.ray
            return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] }
        },

        // The marks layer, offered by the turtle that draws it. The stage does not
        // own the picture's top surface; it names the seam every capture consumer
        // asks, so a still is the PICTURE and an empty answer is a canvas alone.
        // (id:host-surface)
        attachOverlay(fn) { overlayOf = fn ?? (() => null) },
        markLayers: () => [overlayOf()].filter(Boolean),

        head,
        get recorder() { return recorder },
        // LineMaterial cache (spec A3) — WebGL-lifetime owner; dispose() frees it.
        materials,

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

        get hatching() { return caps.hatching },

        // Next unissued cut. A keep waits here; it does not join the active one.
        picture() { return caps.picture() },

        // WebGL2 readback is ASYNC: PIXEL_PACK_BUFFER + fence, never a sync
        // readPixels (stalled the main thread). Returns this activation.
        hatch(bridge, lend) {
            if (disposed) return Promise.resolve(null)
            if (caps.hatching) return caps.active().promise
            const which = caps.reserve()
            let cut
            try {
                const lent = lend?.() ?? null
                const body = lent?.body ? copyBody(lent.body) : null
                const layers = copyLayers(stage.markLayers(), makeSurface)
                if (!body || !lent?.claim || layers == null) {
                    caps.fail(which)
                    return which.promise
                }
                cut = {
                    body,
                    claim: lent.claim,
                    save: copyValue(stage.renderstate.snapshot ?? { save: false }),
                    width: canvas.width,
                    height: canvas.height,
                    layers,
                }
            } catch {
                caps.fail(which)
                return which.promise
            }
            which.cut = cut
            if (cut.save?.save) stage.renderstate.snapshot = { save: false }
            const { width, height, layers, save, body } = cut

            // A GPU fault surfaces from the queue, not from the call: the activation
            // owns its readback, so a throw frees the handles and cancels this cut.
            // (id:keep-coherence-capture-cut)
            let sync = null
            let buf = null

            const abandon = () => {
                const held = buf
                buf = null
                if (sync) { try { ctx.deleteSync(sync) } catch {} sync = null }
                if (held) { try { ctx.deleteBuffer(held) } catch {} }
                caps.fail(which)
            }

            // Readback pixels are fresh and owned; the recorder flips this array in place.
            const finish = (pixels) => {
                queueMicrotask(async () => {
                    try {
                        if (disposed) { caps.fail(which); return }
                        const rec = getRecorder()
                        const result = rec
                            ? await rec.takeSnapshot({ pixels, width, height, layers })
                            : null
                        if (!result) { caps.fail(which); return }
                        if (disposed) { caps.fail(which); return }
                        if (save?.save) {
                            bridge.pub(["saveRecord", {
                                snapshot: result.full,
                                type: "image",
                                title: save.title ?? null,
                            }])
                            // A subscriber may dispose inside that callback: a hatch
                            // published after death is not this cut's to send.
                            if (disposed) { caps.fail(which); return }
                        }
                        const path = result.trimmed ?? result.full ?? null
                        bridge.pub(["hatchTurtle", { body, path, claim: cut.claim }])
                        caps.finish(which, path)
                    } catch {
                        caps.fail(which)
                    }
                })
            }

            const poll = () => {
                try {
                    if (disposed || ctx.isContextLost()) {
                        if (!ctx.isContextLost()) abandon()
                        else caps.fail(which)
                        return
                    }
                    const status = ctx.clientWaitSync(sync, 0, 0)
                    if (status === ctx.TIMEOUT_EXPIRED) { setTimeout(poll, 8); return }
                    ctx.deleteSync(sync)
                    sync = null
                    if (status === ctx.WAIT_FAILED) { abandon(); return }
                    const pixels = new Uint8Array(width * height * 4)
                    ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, buf)
                    ctx.getBufferSubData(ctx.PIXEL_PACK_BUFFER, 0, pixels)
                    ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
                    ctx.deleteBuffer(buf)
                    buf = null
                    finish(pixels)
                } catch {
                    abandon()
                }
            }

            // Data/staging allocation validation: this proves the extent WE staged,
            // not that every later GPU read wrote valid bytes. (M2c)
            const read = () => {
                const big = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
                if (!big || ctx.isContextLost()) { abandon(); return }
                const bytes = width * height * 4
                // The synchronous branch stages into our own array: nothing to size here,
                // and no loss-free claim about a GL error it cannot report.
                if (typeof ctx.fenceSync !== "function") {
                    const pixels = new Uint8Array(bytes)
                    ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
                    finish(pixels)
                    return
                }
                buf = ctx.createBuffer()
                if (!buf) { abandon(); return }
                ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, buf)
                ctx.bufferData(ctx.PIXEL_PACK_BUFFER, bytes, ctx.STREAM_READ)
                // ONE query per cut — get*Parameter can flush and round-trip, so this
                // never runs per render, per poll or per join.
                if (ctx.getBufferParameter(ctx.PIXEL_PACK_BUFFER, ctx.BUFFER_SIZE) !== bytes) {
                    abandon()
                    return
                }
                ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, 0)
                ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
                sync = ctx.fenceSync(ctx.SYNC_GPU_COMMANDS_COMPLETE, 0)
                if (!sync) { abandon(); return }
                ctx.flush()
                setTimeout(poll, 0)
            }

            try { read() } catch { abandon() }
            return which.promise
        },

        // Cleanup
        dispose() {
            disposed = true
            caps.close()
            try {
                if (recorderResolved) recorder?.destroy?.()
            } catch (err) {
                console.error('recorder destroy failed:', err)
            }
            stopSurface()
            controls.removeEventListener('twist', onTwist)
            controls.dispose()   // OrbitControls' own pointer/touch listeners
            if (stage.renderLoop) stage.renderLoop.stop()
            // Own the free: remount safety is structural, not a caller checklist.
            materials.dispose()
            head.dispose()
            renderer.dispose()
        }
    }

    return stage
}
