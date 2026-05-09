// Stage — THREE.js scene infrastructure.
// Owns scene, camera, renderer, controls, groups, head, recorder, renderLoop.
// Extracted from turtle.js constructor + setupScene/Camera/Renderer.

import * as THREE from '../utils/three.core.min.js'
import { OrbitControls } from '../utils/threeorbital'
import { WebGLRenderer } from '../utils/threerender'
import Render from "./render/index.js"
import { Recorder } from "./export/recorder.js"
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

    const guestPathGroup = new THREE.Group()
    const guestGridGroup = new THREE.Group()
    const guestGlyphGroup = new THREE.Group()
    guestGlyphGroup.elements = []
    guestPathGroup.visible = false

    scene.add(pathGroup)
    scene.add(gridGroup)
    scene.add(glyphGroup)
    scene.add(guestPathGroup)
    scene.add(guestGridGroup)
    scene.add(guestGlyphGroup)

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
    controls.zoomToCursor = true
    controls.update()

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

        // Groups
        groups: {
            pathGroup,
            gridGroup,
            glyphGroup
        },
        guestGroups: {
            pathGroup: guestPathGroup,
            gridGroup: guestGridGroup,
            glyphGroup: guestGlyphGroup
        },

        // Also expose groups directly for backward compat with turtle.js
        pathGroup,
        gridGroup,
        glyphGroup,
        guestPathGroup,
        guestGridGroup,
        guestGlyphGroup,

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
            if (stage.renderLoop) stage.renderLoop.stop()
            renderer.dispose()
            shapist.dispose()
        }
    }

    return stage
}
