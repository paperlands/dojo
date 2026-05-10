import { Parser } from "./mafs/parse.js"
import { parseProgram } from "./parse.js"
import { Evaluator } from "./mafs/evaluate.js"
import { Versor } from "./mafs/versors.js"
import Render from "./render/index.js"
import { bridged } from "../bridged.js"
import { execute } from "./executor.js"
import { materializeAll } from "./materializer.js"
import { createStage } from "./stage.js"
import { createScheduler } from "./scheduler.js"
import { createCompositor } from "./compositor.js"

export class Turtle {
    constructor(canvas) {

        this.bridge = bridged("turtle")

        // Stage — all THREE.js infrastructure
        const stage = createStage(canvas, this.bridge)
        this.stage = stage

        this.renderstate = stage.renderstate

        this.renderLoop = new Render.Loop(null, {
            onRender: (t) => this.onFrame(t),
            stopCondition: () => false
        });
        stage.renderLoop = this.renderLoop

        // Math
        this.math = {
            parser: new Parser(),
            evaluator: new Evaluator()
        }

        // Active compositor (set by draw(), used by onFrame())
        this.compositor = null

        this.reset();
    }

    requestRender() {
        this.renderLoop.start();
    }

    onFrame(t) {
        if (this.compositor) {
            this.compositor.frame(t)
        } else {
            // No active program — just render the scene (orbit controls, etc.)
            const { head, camera, controls, renderer, scene } = this.stage
            const scaleFactor = camera.position.distanceTo(head.position()) / 250
            head.scale(scaleFactor)
            controls.update()
            renderer.render(scene, camera)
        }
    }

    hatch() {
        this.stage.hatch(this.bridge)
    }

    clear() {
        this.stage.pathGroup.clear()
        this.stage.gridGroup.clear()
        this.stage.glyphGroup.clear()
        this.stage.glyphGroup.elements.forEach(text => text.dispose())
        this.stage.glyphGroup.elements = []
        this.requestRender();
    }

    reset() {
        this.x = 0; this.y = 0; this.z = 0;
        this.clear();
        this.stage.shapist.dispose()
        this.commandCount = 0
        this.rotation = Versor.raw(1, 0, 0, 0);
        this.color = '#e77808';
        this.showTurtle = 10;
        if (this.compositor) this.compositor.dispose()
        this.compositor = null
        this.renderstate.phase = "start"
        this.renderstate.snapshot = {frame: null, save: false}
        this.renderstate.meta = {state: null, message: null, commands: []}
        this.math.parser.reset()
        this.renderLoop.requestRestart();
    }


    draw(code, opts= {}) {
        try {
            const startTime = performance.now();
            const instructions = parseProgram(code);
            var endTime = performance.now();
            var executionTime = endTime - startTime;
            console.log(`Parser Time took ${executionTime} milliseconds.`);
            this.reset();
            this.requestRender();

            const deps = {
                mathParser: this.math.parser,
                mathEvaluator: this.math.evaluator
            }

            const generator = execute(instructions, deps, { color: this.color })

            // Create scheduler + compositor — unified path for batch and temporal
            const scheduler = createScheduler(generator, {
                createDeps: () => ({
                    mathParser: new Parser(),
                    mathEvaluator: new Evaluator()
                }),
                execOpts: { color: this.color }
            })

            const groups = this.stage.groups
            const ctx = {
                shapist: this.stage.shapist,
                head: this.stage.head,
                camera: this.stage.camera,
                controls: this.stage.controls
            }

            this.compositor = createCompositor(scheduler, groups, ctx, {
                scene: this.stage.scene,
                renderer: this.stage.renderer,
                recorder: this.stage.recorder,
                renderstate: this.renderstate,
                hatch: () => this.hatch()
            }, {
                createHead: (parent) => new Render.Head(parent)
            })

            // Eager flush: drain the generator synchronously for batch programs.
            // Temporal programs (with waits) partially drain here, then the
            // compositor continues ticking in the render loop.
            this.compositor.flush()

            // Execution errors are captured by the scheduler (fault isolation),
            // not thrown. Valid commands' output survives in the scene.
            const errors = this.compositor.scheduler.errors
            if (errors.length > 0) {
                this.renderstate.meta = {state: "error", message: errors[0].message, source: code, commands: instructions}
                return { success: false, error: errors[0].message }
            }

            this.renderstate.meta = {state: "success", commands: instructions}
            endTime = performance.now();
            executionTime = endTime-startTime-executionTime
            console.log(`Drawing Time took ${executionTime} milliseconds.`);
            return { success: true, commandCount: this.compositor.scheduler.commandCount };
        } catch (error) {
            // Parse errors and infrastructure failures still throw
            console.error(error);
            this.renderstate.meta = {state: "error", message: error.message, source: code}
            return { success: false, error: error.message };
        }
    }


    // --- Guest rendering: friend's code in the same scene via separate groups ---

    drawGuest(code) {
        this.clearGuest();
        if (!code) return { success: true, commandCount: 0 };
        this.stage.guestPathGroup.visible = true;
        this.stage.guestGridGroup.visible = true;
        this.stage.guestGlyphGroup.visible = true;

        try {
            const instructions = parseProgram(code);

            // Fresh math context for guest (isolated from host)
            const guestMath = {
                parser: new Parser(),
                evaluator: new Evaluator()
            }

            const deps = {
                mathParser: guestMath.parser,
                mathEvaluator: guestMath.evaluator
            }

            // Execute guest code via executor — no host state mutation
            const events = []
            for (const event of execute(instructions, deps, { color: this.color })) {
                events.push(event)
            }

            // Materialize directly into guest groups
            if (this.guestShapist) this.guestShapist.dispose()
            this.guestShapist = new Render.Shape(this.stage.guestPathGroup, {
                layerMethod: 'renderOrder',
                polygonOffset: { factor: -0.1, units: -1 }
            })
            const groups = {
                pathGroup: this.stage.guestPathGroup,
                gridGroup: this.stage.guestGridGroup,
                glyphGroup: this.stage.guestGlyphGroup
            }
            // No camera/head for guest — skip head events
            const guestEvents = events.filter(e => e.type !== "head")
            materializeAll(guestEvents, groups, {
                shapist: this.guestShapist,
                head: { show() {}, hide() {}, update() {}, position() { return { x: 0, y: 0, z: 0 } } },
                camera: null,
                controls: null
            })

            this.requestRender();
            return { success: true, commandCount: guestEvents.length };
        } catch (error) {
            console.warn('Guest draw failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    clearGuest() {
        if (this.guestShapist) { this.guestShapist.dispose(); this.guestShapist = null }
        this.stage.guestPathGroup.clear();
        this.stage.guestGridGroup.clear();
        this.stage.guestGlyphGroup.elements.forEach(t => t.dispose?.());
        this.stage.guestGlyphGroup.clear();
        this.stage.guestGlyphGroup.elements = [];
        this.stage.guestPathGroup.visible = false;
        this.stage.guestGridGroup.visible = false;
        this.stage.guestGlyphGroup.visible = false;
    }

    setGuestOpacity(opacity) {
        const apply = (group) => {
            group.traverse(child => {
                if (child.material) {
                    child.material.transparent = true;
                    child.material.opacity = opacity;
                }
            });
        };
        apply(this.stage.guestPathGroup);
        apply(this.stage.guestGridGroup);
        apply(this.stage.guestGlyphGroup);
    }

}
