import { Parser } from "./mafs/parse.js"
import { parseProgram } from "./parse.js"
import { Evaluator } from "./mafs/evaluate.js"
import { Versor } from "./mafs/versors.js"
import * as THREE from '../utils/three.core.min.js'
import { ColorConverter } from '../utils/color.js'
import { Text } from '../utils/threetext'
import Render from "./render/index.js"
import { Line2 } from './render/line/Line2.js'
import { LineMaterial } from './render/line/LineMaterial.js'
import { LineGeometry } from './render/line/LineGeometry.js'
import { bridged } from "../bridged.js"
import { execute, toLegacyFrame } from "./executor.js"
import { materializeAll } from "./materializer.js"
import { createStage } from "./stage.js"

export class Turtle {
    constructor(canvas) {

        this.bridge = bridged("turtle")

        // Stage — all THREE.js infrastructure
        const stage = createStage(canvas, this.bridge)
        this.stage = stage

        // Expose stage properties for backward compat with existing methods
        this.canvas = stage.canvas
        this.ctx = stage.ctx
        this.scene = stage.scene
        this.camera = stage.camera
        this.renderer = stage.renderer
        this.controls = stage.controls
        this.head = stage.head
        this.recorder = stage.recorder
        this.shapist = stage.shapist
        this.pathGroup = stage.pathGroup
        this.gridGroup = stage.gridGroup
        this.glyphGroup = stage.glyphGroup
        this.guestPathGroup = stage.guestPathGroup
        this.guestGridGroup = stage.guestGridGroup
        this.guestGlyphGroup = stage.guestGlyphGroup
        this.renderstate = stage.renderstate

        // Temporal state
        this.timeline = {
            currentTime: 0,
            endTime: 0,
            frames: new Map(),
            lastRenderTime: 0,
            lastRenderFrame: 0
        };

        this.renderLoop = new Render.Loop(null, {
            onRender: (currentTime) => this.renderIncremental(currentTime),
            stopCondition: () => false
        });
        stage.renderLoop = this.renderLoop

        // Math
        this.math = {
            parser: new Parser(),
            evaluator: new Evaluator()
        }

        this.reset();
    }

    // turtle interface for renderer
    requestRender() {
        this.renderLoop.start();
    }

    requestRestart() {
        this.renderLoop.requestRestart();
    }

    renderIncremental(t) {
        const newPaths = Array.from(this.timeline.frames.entries())
              .filter(([time]) => time >= this.timeline.lastRenderTime && time < t)
              .flatMap(([_, frame]) => frame);

        if (newPaths.length > 0) {
            this.drawPaths(newPaths)
        }

        // scale invariant head
        const scaleFactor = this.camera.position.distanceTo(this.head.position())/250 // Adjust multiplier as needed Math.tan((60 * Math.PI / 180) / 2)
        this.head.scale(scaleFactor)
        // Ensure matrix is current
        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        if(this.renderstate.phase=="start" && t>=this.timeline.endTime){
            if (this.showTurtle) {
                this.head.show()
                this.head.update([this.x, this.y,this.z], this.rotation, this.color, this.showTurtle)
            } else {
                this.head.hide()
            }

            switch (this.camera.desire) {
                case 'track':
                    const deltaMovement = new THREE.Vector3(...[this.x, this.y,this.z]);
                    deltaMovement.sub(this.head.position());
                    this.camera.position.add(deltaMovement)
                    this.controls.target.set(...[this.x, this.y,this.z])
                    break;

                case 'pan':
                    this.controls.target.set(...[this.x, this.y,this.z])
                    break;
                }
            
            this.renderstate.phase="reaching"
        }

        if(this.renderstate.phase=="reaching") {
            //for some reason needs to be next frame after head render
            if (t>=(1000+this.timeline.endTime)) {
                this.hatch()
                this.renderstate.phase="reached"
            }
        }

        if (this.recorder.isRecording) {
            this.recorder.captureFrame()
        }

        if(this.renderstate.snapshot.frame==null && t>500) {
            // needs to snapshot and send immediately after render because no drawing buffer
            this.hatch()
        }

        this.timeline.lastRenderTime = t;

    }

    drawPaths(paths) {
        paths.forEach(path => {
            switch(path.type) {
            case "clear":
                this.pathGroup.clear()
                this.glyphGroup.clear()
                this.gridGroup.clear()
                this.glyphGroup.elements.forEach(text => text.dispose())
                break;

            case "head":
                switch (this.camera.desire) {
                case 'track':
                    const deltaMovement = new THREE.Vector3(...path.points);
                    deltaMovement.sub(this.head.position());
                    this.camera.position.add(deltaMovement)
                    this.controls.target.set(...path.points)
                    break;

                case 'pan':
                    this.controls.target.set(...path.points)
                    break;
                }

                if (path.headsize){
                    this.head.show()
                    this.head.update(path.points, path.rotation, path.color, path.headsize)
                } else {
                    this.head.hide()
                }
                
                break;

            case "path" :
                try {
                    if (!path.points || path.points.length === 0) return;
                    // Start drawing a new path
                    //flattne position
                    const positions = [];
                    path.points.forEach(point => {
                        positions.push(point.x, point.y, point.z);
                    });

                    // Create LineGeometry and set positions
                    const geometry = new LineGeometry();

                    geometry.setPositions(positions);

                    const material = new LineMaterial({
                        color: path.color || 0xe77808, //0xff4500, // DarkOrange as hex
                        linewidth: path.thickness || 2,
                        vertexColors: false,
                        dashed: false,
                    });

                    material.resolution.set(window.innerWidth, window.innerHeight);

                    // Create Line2 mesh
                    const mesh = new Line2(geometry, material);
                    this.pathGroup.add(mesh);
                    

                    if(path.filled) {


                        this.shapist.addPolygon(path.points,  {color: path.color,
                                                               //wireframe: true,
                                                               forceTriangulation: true});

                    }


                } catch (error) {
                    console.warn('Error drawing path:', error);
                }
                break;
            case "text":
                try {
                    const newText = new Text()
                    this.glyphGroup.add(newText)

                    // Set properties to configure:
                    newText.text = path.text
                    newText.fontSize = path.text_size
                    newText.textAlign = 'center'
                    newText.anchorX = 'center'
                    newText.anchorY = '45%'
                    newText.font= '/fonts/paperLang.ttf'
                    newText.position.x= path.points[0][0]
                    newText.position.y= path.points[0][1]
                    newText.position.z= path.points[0][2]
                    newText.quaternion.copy(path.rotation)

                    newText.color = path.color
                    newText.sync()
                    this.glyphGroup.elements.push(newText);


                     } catch (error) {
                    console.warn('Error writing text:', error);
                }
                break;

            case "grid":
                const gridHelper = new THREE.GridHelper( path.size, path.division, path.color,  ColorConverter.toHex(ColorConverter.adjust(path.color, 0.25)));
                gridHelper.position.set(...path.point)
                gridHelper.quaternion.copy(path.rotation)
                this.gridGroup.add( gridHelper );
                break;
            }

        });
    }

    hatch(){
        this.stage.hatch(this.bridge)
    }

    clear() {
        this.pathGroup.clear()
        this.gridGroup.clear()
        this.glyphGroup.clear()
        this.glyphGroup.elements.forEach(text => text.dispose())
        this.glyphGroup.elements = []
        this.timeline.lastRenderTime = 0;
        this.requestRender();
    }

    reset() {
        this.x = 0; this.y = 0; this.z = 0;
        this.clear();
        this.shapist.dispose()
        this.timeline = {
            currentTime: 0,
            endTime: 0,
            frames: new Map(),
            lastRenderTime: 0,
            lastRenderFrame: 0
        };
        this.commandCount = 0
        this.rotation = Versor.raw(1, 0, 0, 0);
        this.color = '#e77808';
        this.showTurtle = 10;
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

            // Drain executor, check if temporal (has waits)
            const events = []
            let hasWaits = false
            for (const event of execute(instructions, deps, { color: this.color })) {
                if (event.type === "wait") hasWaits = true
                events.push(event)
            }

            if (hasWaits) {
                // Temporal program: use timeline for renderIncremental animation
                const { frames, endTime: tEnd } = toLegacyFrame(events)
                this.timeline.frames = frames
                this.timeline.endTime = tEnd
            } else {
                // Batch program: materialize directly, bypass timeline entirely
                const groups = {
                    pathGroup: this.pathGroup,
                    gridGroup: this.gridGroup,
                    glyphGroup: this.glyphGroup
                }
                const ctx = {
                    shapist: this.shapist,
                    head: this.head,
                    camera: this.camera,
                    controls: this.controls
                }
                materializeAll(events, groups, ctx)
                // Head already placed by materializer — skip renderIncremental's
                // phase=="start" block to avoid redundant update / flicker
                this.renderstate.phase = "reaching"
            }

            // Sync turtle state from final head event for camera/hatch
            const headEvent = events.findLast(e => e.type === "head")
            if (headEvent) {
                this.x = headEvent.position[0]
                this.y = headEvent.position[1]
                this.z = headEvent.position[2]
                this.rotation = headEvent.rotation
                this.color = headEvent.color
                this.showTurtle = headEvent.headSize
            }

            this.commandCount = events.filter(e => e.type !== "head").length
            this.renderstate.meta = {state: "success", commands: instructions}
            endTime = performance.now();
            executionTime = endTime-startTime-executionTime
            console.log(`Drawing Time took ${executionTime} milliseconds.`);
            return { success: true, commandCount: this.commandCount };
        } catch (error) {
            console.error(error);
            this.renderstate.meta = {state: "error", message: error.message, source: code}
            return { success: false, error: error.message };
        }
    }


    // --- Guest rendering: friend's code in the same scene via separate groups ---

    drawGuest(code) {
        this.clearGuest();
        if (!code) return { success: true, commandCount: 0 };
        this.guestPathGroup.visible = true;
        this.guestGridGroup.visible = true;
        this.guestGlyphGroup.visible = true;

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
            this.guestShapist = new Render.Shape(this.guestPathGroup, {
                layerMethod: 'renderOrder',
                polygonOffset: { factor: -0.1, units: -1 }
            })
            const groups = {
                pathGroup: this.guestPathGroup,
                gridGroup: this.guestGridGroup,
                glyphGroup: this.guestGlyphGroup
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
        this.guestPathGroup.clear();
        this.guestGridGroup.clear();
        this.guestGlyphGroup.elements.forEach(t => t.dispose?.());
        this.guestGlyphGroup.clear();
        this.guestGlyphGroup.elements = [];
        this.guestPathGroup.visible = false;
        this.guestGridGroup.visible = false;
        this.guestGlyphGroup.visible = false;
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
        apply(this.guestPathGroup);
        apply(this.guestGridGroup);
        apply(this.guestGlyphGroup);
    }

}
