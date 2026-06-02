// Stage — THREE.js scene infrastructure.
// Owns scene, camera, renderer, controls, groups, head, recorder, renderLoop.
// Extracted from turtle.js constructor + setupScene/Camera/Renderer.

import * as THREE from '../utils/three.core.min.js'
import { OrbitControls } from '../utils/threeorbital'
import { WebGLRenderer } from '../utils/threerender'
import Render from "./render/index.js"
import { Recorder } from "./export/recorder.js"
import { updateMaterialResolution } from "./materializer.js"
import { cameraBridge } from "../bridged.js"

export function createStage(canvas, bridge) {
    const ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl")

    // Scene
    const scene = new THREE.Scene()

    // Groups
    const pathGroup = new THREE.Group()
    const gridGroup = new THREE.Group()
    const glyphGroup = new THREE.Group()
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
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000000)
    camera.lookAt(0, 0, 0)
    camera.position.set(0, 0, 500)
    camera.updateProjectionMatrix()

    // Controls
    const controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 0, 0)
    controls.mouseButtons = {
        RIGHT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        LEFT: THREE.MOUSE.PAN
    }
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    controls.enableDamping = true
    controls.dampingFactor = 0.2
    controls.update()

    // Dolly-through zoom. OrbitControls' built-in zoom multiplies the orbit
    // radius toward the target (radius *= scale). Radius is a spherical distance,
    // always ≥ 0, so it asymptotes at the pivot: each notch is ~5% of an
    // ever-shrinking number and the camera can never reach — let alone pass
    // through — the target. That is the "starts fast, crawls near the target,
    // can't zoom further" bug. Instead we translate the whole rig forward along
    // the view axis with the standoff floored at MIN_STANDOFF: normal zoom keeps
    // the pivot fixed, but once the camera reaches the floor it flies *through*
    // the pivot at constant speed (infinite zoom), carrying the orbit target with
    // it. We own the wheel here, so OrbitControls' own zoom is disabled.
    controls.enableZoom = false
    // The floored standoff doubles as the fly-through cruising distance: the
    // per-notch advance settles to MIN_STANDOFF·(1−k) once you reach it, so it
    // must be large enough that the approach never decays into a crawl near the
    // pivot (≈5 crawls; ≥25 holds a constant step straight through the content).
    const MIN_STANDOFF = 30
    const _fwd = new THREE.Vector3()
    const _ndc = new THREE.Vector3()
    const _cursorDir = new THREE.Vector3()
    const onWheel = (e) => {
        e.preventDefault()
        let dy = e.deltaY
        if (e.deltaMode === 1) dy *= 16        // LINE → px (Firefox/Linux)
        else if (e.deltaMode === 2) dy *= 100  // PAGE → px
        if (e.ctrlKey) dy *= 10                // trackpad pinch

        const dist = camera.position.distanceTo(controls.target)
        const ref = Math.max(dist, MIN_STANDOFF)               // floor the step base
        const k = Math.pow(0.95, controls.zoomSpeed * Math.abs(dy * 0.01))
        const scale = dy < 0 ? k : 1 / k                       // <1 in, >1 out
        const newStandoff = Math.max(ref * scale, MIN_STANDOFF) // floored pivot distance
        const advance = dist - ref * scale  // + forward, − back; stays >0 at the floor → fly-through

        // Aim the dolly at the world point under the cursor: slide the camera along
        // that ray so what you point at grows toward the centre (zoom-to-cursor),
        // orientation unchanged. The target rides the view axis at the floored
        // standoff, so orbiting stays sane and — past the floor — flies through.
        const rect = canvas.getBoundingClientRect()
        _ndc.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
            1
        )
        _cursorDir.copy(_ndc).unproject(camera).sub(camera.position).normalize()
        camera.getWorldDirection(_fwd)

        camera.position.addScaledVector(_cursorDir, advance)
        controls.target.copy(camera.position).addScaledVector(_fwd, newStandoff)
        controls.update() // recompute spherical + wake the render-on-demand loop
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    // Renderer
    const renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.outputEncoding = THREE.sRGBEncoding
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

    // Camera bridge — responds to external camera commands
    cameraBridge.sub(async (payload) => {
        switch (payload[0]) {
        case 'recenter':
            camera.position.set(0, 0, 500)
            controls.target.set(0, 0, 0)
            controls.update()
            break
        case 'snap':
            stage.renderstate.snapshot = { frame: null, save: true, title: payload[1].title }
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
            phase: "start",
            snapshot: { frame: null, save: false },
            meta: { state: null, message: null, commands: [] }
        },

        renderLoop: null,

        // Render one frame
        render() {
            const scaleFactor = camera.position.distanceTo(head.position()) / 250
            head.scale(scaleFactor)
            controls.update()
            renderer.render(scene, camera)
        },

        // Snapshot for thumbnail/recording
        hatch(bridge) {
            const width = canvas.width
            const height = canvas.height
            const pixels = new Uint8Array(width * height * 4)
            ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels)
            stage.renderstate.snapshot.frame = pixels

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
        },

        // Cleanup
        dispose() {
            window.removeEventListener('resize', onResize)
            canvas.removeEventListener('wheel', onWheel)
            if (stage.renderLoop) stage.renderLoop.stop()
            renderer.dispose()
            shapist.dispose()
        }
    }

    return stage
}
