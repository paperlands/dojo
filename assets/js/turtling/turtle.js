import { Parser } from "./mafs/parse.js"
import { parseProgram } from "./parse.js"
import { Evaluator } from "./mafs/evaluate.js"
import Render from "./render/index.js"
import { bridged } from "../bridged.js"
import { execute } from "./executor.js"
import { createStage } from "./stage.js"
import { createScheduler } from "./scheduler.js"
import { createCompositor } from "./compositor.js"
import * as THREE from '../utils/three.core.min.js'

// --- Ambient entry helpers ---

function createAmbientEntry(name, scene) {
    const pathGroup = new THREE.Group()
    const gridGroup = new THREE.Group()
    const glyphGroup = new THREE.Group()
    glyphGroup.elements = []

    scene.add(pathGroup)
    scene.add(gridGroup)
    scene.add(glyphGroup)

    const shapist = new Render.Shape(pathGroup, {
        layerMethod: 'renderOrder',
        polygonOffset: { factor: -0.1, units: -1 }
    })

    const head = new Render.Head(pathGroup)

    return {
        name,
        groups: { pathGroup, gridGroup, glyphGroup },
        shapist,
        head,
        compositor: null
    }
}

function clearAmbientGroups(groups) {
    groups.pathGroup.clear()
    groups.gridGroup.clear()
    if (groups.glyphGroup.elements) {
        groups.glyphGroup.elements.forEach(text => text.dispose())
    }
    groups.glyphGroup.clear()
    groups.glyphGroup.elements = []
}

function disposeAmbientEntry(entry, scene) {
    entry.head.hide()

    const disposeGroup = (group) => {
        group.traverse(child => {
            if (child.geometry) child.geometry.dispose()
            if (child.material) child.material.dispose()
        })
        if (group.elements) {
            group.elements.forEach(text => text.dispose?.())
        }
        scene.remove(group)
    }

    disposeGroup(entry.groups.pathGroup)
    disposeGroup(entry.groups.gridGroup)
    disposeGroup(entry.groups.glyphGroup)
}

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

        // Multi-ambient state
        this.ambients = new Map()   // tabId → AmbientEntry
        this.focusedId = null
        this._snapshotPending = false

        this.renderLoop.requestRestart()
    }

    requestRender() {
        this.renderLoop.start()
    }

    onFrame(t) {
        if (this.ambients.size > 0) {
            for (const entry of this.ambients.values()) {
                try {
                    entry.compositor.advance(t)
                } catch (error) {
                    console.error(`Compositor advance error [${entry.name}]:`, error)
                }
            }

            this.stage.controls.update()
            this.stage.renderer.render(this.stage.scene, this.stage.camera)

            if (this.stage.recorder.isRecording) {
                this.stage.recorder.captureFrame()
            }

            if (this.renderstate.snapshot.frame == null && t > 500) {
                this.hatch()
            }

            const allDone = [...this.ambients.values()].every(e => e.compositor.scheduler.done)
            if (allDone && !this._snapshotPending) {
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
        if (this.ambients.size === 0) return
        if (performance.now() - this._lastHatchTime < cooldown) return
        this._snapshotPending = false
        this.requestRender()
    }

    // --- Multi-ambient API ---

    upsertAmbient(tabId, name, code) {
        try {
            const instructions = parseProgram(code)

            // Reuse or create entry
            let entry = this.ambients.get(tabId)
            if (entry) {
                entry.compositor.dispose()
                entry.shapist.dispose()
                clearAmbientGroups(entry.groups)
                entry.head.reset()
                entry.shapist = new Render.Shape(entry.groups.pathGroup, {
                    layerMethod: 'renderOrder',
                    polygonOffset: { factor: -0.1, units: -1 }
                })
            } else {
                entry = createAmbientEntry(name, this.stage.scene)
                this.ambients.set(tabId, entry)
                if (this.ambients.size === 1) this.stage.head.hide()
            }

            entry.name = name

            const deps = {
                mathParser: new Parser(),
                mathEvaluator: new Evaluator()
            }

            const generator = execute(instructions, deps, { color: this.color })

            const scheduler = createScheduler(generator, {
                createDeps: () => ({
                    mathParser: new Parser(),
                    mathEvaluator: new Evaluator()
                }),
                execOpts: { color: this.color }
            })

            const isFocused = (tabId === this.focusedId)
            const ctx = {
                shapist: entry.shapist,
                head: entry.head,
                camera: this.stage.camera,
                controls: this.stage.controls
            }

            entry.compositor = createCompositor(scheduler, entry.groups, ctx, {
                scene: this.stage.scene,
                renderer: this.stage.renderer,
                recorder: this.stage.recorder,
                renderstate: this.renderstate,
                hatch: () => this.hatch()
            }, {
                createHead: (parent) => new Render.Head(parent)
            })

            entry.compositor.focused = isFocused

            entry.compositor.flush()

            const errors = entry.compositor.scheduler.errors
            if (errors.length > 0) {
                this.renderstate.meta = { state: "error", message: errors[0].message, source: code, commands: instructions }
                this.requestRender()
                return { success: false, error: errors[0].message }
            }

            this.renderstate.meta = { state: "success", commands: instructions }
            this._snapshotPending = false
            this.requestRender()
            return { success: true, commandCount: entry.compositor.scheduler.commandCount }
        } catch (error) {
            console.error(error)
            this.renderstate.meta = { state: "error", message: error.message, source: code }
            return { success: false, error: error.message }
        }
    }

    removeAmbient(tabId) {
        const entry = this.ambients.get(tabId)
        if (!entry) return

        entry.compositor.dispose()
        entry.shapist.dispose()
        disposeAmbientEntry(entry, this.stage.scene)
        this.ambients.delete(tabId)

        if (this.focusedId === tabId) {
            const next = this.ambients.keys().next().value || null
            this.focusAmbient(next)
        }

        if (this.ambients.size === 0) {
            this.stage.head.show()
            this.stage.head.reset()
        }

        this.requestRender()
    }

    focusAmbient(tabId) {
        if (this.focusedId) {
            const old = this.ambients.get(this.focusedId)
            if (old?.compositor) old.compositor.focused = false
        }

        this.focusedId = tabId

        const entry = this.ambients.get(tabId)
        if (entry?.compositor) entry.compositor.focused = true
    }

    setAmbientOpacity(tabId, opacity) {
        const entry = this.ambients.get(tabId)
        if (!entry) return
        const apply = (group) => {
            group.traverse(child => {
                if (child.material) {
                    child.material.transparent = true
                    child.material.opacity = opacity
                }
            })
        }
        apply(entry.groups.pathGroup)
        apply(entry.groups.gridGroup)
        apply(entry.groups.glyphGroup)
    }

    // --- Backward-compatible API ---

    draw(code, opts = {}) {
        this.reset()
        this.focusedId = 'default'
        return this.upsertAmbient('default', 'default', code)
    }

    drawGuest(code) {
        this.removeAmbient('guest')
        if (!code) return { success: true, commandCount: 0 }
        const result = this.upsertAmbient('guest', 'guest', code)
        return result
    }

    clearGuest() {
        this.removeAmbient('guest')
    }

    setGuestOpacity(opacity) {
        this.setAmbientOpacity('guest', opacity)
    }

    reset() {
        for (const [tabId, entry] of this.ambients) {
            entry.compositor.dispose()
            entry.shapist.dispose()
            disposeAmbientEntry(entry, this.stage.scene)
        }
        this.ambients.clear()
        this.focusedId = null
        this._snapshotPending = false

        this.stage.head.show()
        this.stage.head.reset()

        // Clear legacy stage groups
        this.stage.pathGroup.clear()
        this.stage.gridGroup.clear()
        if (this.stage.glyphGroup.elements) {
            this.stage.glyphGroup.elements.forEach(text => text.dispose())
        }
        this.stage.glyphGroup.clear()
        this.stage.glyphGroup.elements = []
        this.stage.shapist.dispose()

        this.renderstate.phase = "start"
        this.renderstate.snapshot = { frame: null, save: false }
        this.renderstate.meta = { state: null, message: null, commands: [] }
        this.renderLoop.requestRestart()
    }
}
