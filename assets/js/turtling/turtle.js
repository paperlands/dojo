import { Parser } from "./mafs/parse.js"
import { parseProgram } from "./parse.js"
import { Evaluator } from "./mafs/evaluate.js"
import Render from "./render/index.js"
import { bridged } from "../bridged.js"
import { createStage } from "./stage.js"
import { createScheduler, metaRoot } from "./scheduler.js"
import { createCompositor } from "./compositor.js"

// --- Turtle ---

export class Turtle {
    constructor(canvas) {
        this.bridge = bridged("turtle")

        const stage = createStage(canvas, this.bridge)
        this.stage = stage
        this.renderstate = stage.renderstate

        this.renderLoop = new Render.Loop(null, {
            onRender: (t) => this.onFrame(t),
            stopCondition: () => false
        })
        stage.renderLoop = this.renderLoop

        this.color = '#e77808'

        // Unified scheduler + compositor (lazy — created on first upsertAmbient)
        this.scheduler = null
        this.compositor = null
        this._snapshotPending = false
        this._localKeys = new Set()  // buffer IDs of locally-rendered tab ambients

        this._heartbeatTimer = null
        this._onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                this.eagerHatch()
                this._scheduleHeartbeat()
            } else {
                this._stopHeartbeat()
            }
        }

        document.addEventListener('visibilitychange', this._onVisibilityChange)
        this._scheduleHeartbeat()
        this.renderLoop.requestRestart()
    }

    requestRender() {
        this.renderLoop.start()
    }

    _scheduleHeartbeat() {
        if (this._heartbeatTimer) return
        const delay = 10_000 + Math.random() * 5_000
        this._heartbeatTimer = setTimeout(() => {
            this._heartbeatTimer = null
            if (document.visibilityState === 'visible') {
                this.eagerHatch()
                this._scheduleHeartbeat()
            }
        }, delay)
    }

    _stopHeartbeat() {
        clearTimeout(this._heartbeatTimer)
        this._heartbeatTimer = null
    }

    dispose() {
        this._stopHeartbeat()
        document.removeEventListener('visibilitychange', this._onVisibilityChange)
    }

    // Lazy init: one scheduler (meta-root) + one compositor for the lifetime.
    _ensureScheduler() {
        if (this.scheduler) return
        this.scheduler = createScheduler(metaRoot(), {
            rootName: '__meta__',
            createDeps: () => ({
                mathParser: new Parser(),
                mathEvaluator: new Evaluator()
            }),
            execOpts: { color: this.color },
            onShout: (sourceName, msg, payload) => {
                this._onShout?.(this.compositor?.focusedName, sourceName, msg, payload)
            }
        })
        this.compositor = createCompositor(this.scheduler,
            { camera: this.stage.camera, controls: this.stage.controls },
            {
                scene: this.stage.scene,
                renderer: this.stage.renderer,
                recorder: this.stage.recorder,
                renderstate: this.renderstate,
                hatch: () => this.hatch()
            },
            {
                createHead: (parent) => new Render.Head(parent),
                createShapist: (parent) => new Render.Shape(parent, {
                    layerMethod: 'renderOrder',
                    polygonOffset: { factor: -0.1, units: -1 }
                })
            }
        )
        // focusedName left null — set by first draw() call
        this.stage.head.hide()
    }

    onFrame(t) {
        if (this.compositor) {
            try {
                this.compositor.advance(t)
            } catch (error) {
                console.error('Compositor advance error:', error)
            }

            this.stage.controls.update()
            this.stage.renderer.render(this.stage.scene, this.stage.camera)

            if (this.stage.recorder.isRecording) {
                this.stage.recorder.captureFrame()
            }

            if (this.renderstate.snapshot.frame == null && t > 500) {
                this.hatch()
            }

            if (this.scheduler.done && !this._snapshotPending) {
                this._snapshotPending = true
                this.hatch()
            }
        } else {
            // No ambients — idle render (orbit controls, stage head)
            const { head, camera, controls, renderer, scene } = this.stage
            const scaleFactor = camera.position.distanceTo(head.position()) / 250
            head.scale(scaleFactor)
            controls.update()
            renderer.render(scene, camera)
        }
    }

    hatch() {
        this._lastHatchTime = performance.now()
        this.stage.hatch(this.bridge)
    }

    eagerHatch(cooldown = 8_000) {
        if (!this.compositor) return
        if (performance.now() - this._lastHatchTime < cooldown) return
        this._snapshotPending = false
        this.requestRender()
    }

    // --- Multi-ambient API ---

    upsertAmbient(key, displayName, code) {
        try {
            const instructions = parseProgram(code)
            this._ensureScheduler()

            this.scheduler.hotSwapChild(key, {
                name: displayName,
                code: { ast: instructions, functions: null },
                style: { color: this.color },
                env: null
            })

            // Fresh hatch cycle — clear previous snapshot so onFrame re-hatches
            this.renderstate.snapshot = { frame: null, save: this.renderstate.snapshot.save }
            this._snapshotPending = false

            this.compositor.flush()

            const errors = this.scheduler.errors
            if (errors.length > 0) {
                this.renderstate.meta = { state: "error", message: errors[0].message, source: code, commands: instructions }
                this.requestRender()
                return { success: false, error: errors[0].message }
            }

            this.renderstate.meta = { state: "success", commands: instructions }
            this.requestRender()
            return { success: true, commandCount: this.scheduler.commandCount }
        } catch (error) {
            console.error(error)
            this.renderstate.meta = { state: "error", message: error.message, source: code }
            return { success: false, error: error.message }
        }
    }

    removeAmbient(key) {
        if (!this.scheduler) return
        this._localKeys.delete(key)

        // Try by key (buffer ID) first, fall back to name search (outer shell compat)
        if (this.scheduler.root.children.has(key)) {
            this.scheduler.removeChild(key)
        } else {
            for (const [id, child] of this.scheduler.root.children) {
                if (child.name === key) { this.scheduler.removeChild(id); break }
            }
        }

        // If no children left, tear down scheduler and show idle head
        if (this.scheduler.root.children.size === 0) {
            this.compositor.dispose()
            this.compositor = null
            this.scheduler = null
            this.stage.head.show()
            this.stage.head.reset()
        }

        this.requestRender()
    }

    focusAmbient(name) {
        if (this.compositor) {
            this.compositor.focusedName = name
        }
    }

    setAmbientOpacity(name, opacity) {
        if (this.compositor) {
            this.compositor.setOpacityByName(name, opacity)
        }
    }

    // Toggle a tab's ambient: shift+click adds if absent, removes if present.
    // On add, re-upserts ALL local ambients so they restart in sync.
    // resolveBuffer(key) → { name, content } provides sibling code for restart.
    toggleAmbient(id, name, code, resolveBuffer) {
        this._ensureScheduler()
        if (this.scheduler.root.children.has(id)) {
            this.removeAmbient(id)
        } else {
            this._localKeys.add(id)
            for (const key of this._localKeys) {
                const info = key === id ? { name, content: code } : resolveBuffer?.(key)
                if (info) this.upsertAmbient(key, info.name, info.content)
            }
        }
        this.requestRender()
    }

    // --- Backward-compatible API ---

    draw(id, name, code) {
        this._ensureScheduler()
        // Exclusive: remove all other local tab ambients
        for (const key of this._localKeys) {
            if (key !== id) this.removeAmbient(key)
        }
        this._localKeys.clear()
        this._localKeys.add(id)
        this.focusAmbient(name)
        return this.upsertAmbient(id, name, code)
    }

    reset() {
        if (this.scheduler) {
            // Remove all children
            for (const name of [...this.scheduler.root.children.keys()]) {
                this.scheduler.removeChild(name)
            }
            this.compositor.dispose()
            this.compositor = null
            this.scheduler = null
        }
        this._snapshotPending = false

        this.stage.head.show()
        this.stage.head.reset()
        this.renderstate.snapshot = { frame: null, save: false }
        this.renderstate.meta = { state: null, message: null, commands: [] }
        this.renderLoop.requestRestart()
    }
}
