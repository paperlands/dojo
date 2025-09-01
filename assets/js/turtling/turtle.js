import { Parser } from "./mafs/parse.js"
import { Evaluator } from "./mafs/evaluate.js"
import { Typesetter } from "./mafs/typist.js"
import { Versor } from "./mafs/versors.js"
import * as THREE from '../utils/three.core.min.js';
import  {OrbitControls}  from '../utils/threeorbital';
import  {WebGLRenderer}  from '../utils/threerender';
import {Text} from '../utils/threetext'
import  snapshot  from '../utils/canvas.js';
import Render from "./render/index.js"
import { Line2 } from './render/line/Line2.js';
import { LineMaterial } from './render/line/LineMaterial.js';
import { LineGeometry } from './render/line/LineGeometry.js';
//import { Camera } from "./camera.js"
import {cameraBridge, bridged } from "../bridged.js"

export class Turtle {
    constructor(canvas) {

        this.canvas = canvas;

        this.ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        this.commands = {
            // Add other command references here
            fw: this.forward.bind(this),
            rt: this.right.bind(this),
            lt: this.left.bind(this),
            yaw: this.yaw.bind(this),
            pitch: this.pitch.bind(this),
            dive: this.pitch.bind(this),
            roll: this.roll.bind(this),
            show: this.unhideTurtle.bind(this),
            hd: this.hideTurtle.bind(this),
            jmp: this.jump.bind(this),
            mv: this.move.bind(this),
            glow: this.glow.bind(this),
            fn: this.func.bind(this),
            goto: this.goto.bind(this),
            //iamat: this.iamat.bind(this),
            faceto: this.faceto.bind(this),
            jmpto: this.jmpto.bind(this),
            label: this.label.bind(this),
            erase: this.erase.bind(this),
            home: this.spawn.bind(this),
            fill: this.fill.bind(this),
            wait: this.wait.bind(this),
            limitRecurse: this.setRecurseLimit.bind(this),
            limitCommand: this.setCommandLimit.bind(this),
            beColour: this.setColor.bind(this)
        };

        this.places = {};
        this.bridge = bridged("turtle")
        this.functions = {};
        this.instructions = [];

        this.executionState = {
            x: 0,
            y: 0,
            z: 0,
            rotation: new Versor(1, 0, 0, 0)
        };


        this.pathTemplate = {
            type: "path",
            points: [],
            color: null,
            filled: false,
        };

        this.currentPath=null
        //https://threejs.org/docs/#api/en/core/Object3D
        this.pathGroup = new THREE.Group();

        this.glyphGroup = new THREE.Group();
        this.glyphGroup.elements = []
        //this.glyphist = new Render.Glyph(this.glyphGroup);

        this.shapist = new Render.Shape(this.pathGroup, {layerMethod: 'polygonOffset', polygonOffset: { factor: -0.1, units: -1 }})

        // Temporal state
        this.timeline = {
            currentTime: 0, // Global wait temporal cursor
            endTime: 0,
            frames: new Map(), // Map<timestamp, [PathSegment[]]>
            lastRenderTime: 0,
            lastRenderFrame: 0
        };


        // Set up animation frame for continuous rendering
        // THREEJS
        this.setupScene();
        this.setupCamera();
        this.setupRenderer(canvas)


        this.scene.add(this.pathGroup);
        this.scene.add(this.glyphGroup);

        this.renderLoop = new Render.Loop(null, {
            onRender: (currentTime) => this.renderIncremental(currentTime),
            // camera used to be seperate now tied with rendering
            stopCondition: () => false
        });


        this.head = new Render.Head(this.scene)
        this.reset();
        // Command execution tracking
        this.commandCount = 0;
        this.recurseCount = 0,
        this.maxRecurses = 888888;
        this.maxCommands = 88888888;
        this.maxRecurseDepth = 360

        //mafs
        this.math = {
            parser: new Parser(),
            evaluator: new Evaluator()
        }
    }

    spawn() {
        this.x = 0;
        this.y = 0;
        this.z = 0
    }

    setupScene() {
        this.scene = new THREE.Scene();
    }

    setupCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000000);
        this.camera.lookAt(0, 0, 0);
        this.camera.position.set(0, 0, 500);

        this.camera.updateProjectionMatrix();
        this.controls = new OrbitControls( this.camera, this.canvas );
        this.controls.target.set(0, 0, 0)
        this.controls.mouseButtons = {
	        RIGHT: THREE.MOUSE.ROTATE,
	        MIDDLE: THREE.MOUSE.DOLLY,
	        LEFT: THREE.MOUSE.PAN
        }
        this.controls.enableDamping = true; // an animation loop is required when either damping or auto-rotation are enabled
		this.controls.dampingFactor = 0.2;
        this.controls.zoomToCursor = true
        this.controls.update()

        cameraBridge.sub((payload) => {
            switch (payload[0]) {
            case 'recenter':
                // this.controls.target.set(0, 0, 0)
                //this.controls.update()
                // gotta slerp this
                this.controls.reset();
                break;
            case 'record':
                this.beginRecording()
                break;
            case 'endrecord':
                this.endRecording()
                break;
            default:
            }
        })

        //ensure camera rerenders when window resizes
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    setupRenderer(canvas) {
        this.renderer = new WebGLRenderer({canvas ,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.capabilities.logarithmicDepthBuffer = true;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.renderer.sortObjects = false;
    }

    glow(x=5) {
        this.ctx.shadowBlur = x;
    }

    // turtle interface for renderer
    requestRender() {
        this.renderLoop.start();
    }

    requestRerender() {
        this.timeline.lastRenderTime = 0;
        this.renderLoop.requestClear();
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

        // Ensure matrix is current
        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        // if we want to scale head
        //console.log(this.camera.position.distanceTo(this.head.position()))
        //const scaleFactor = Math.max(0.1, distanceToCamera * 0.02); // Adjust multiplier as needed

        if(this.endTurtle=="start" && t>=this.timeline.endTime){
            if (this.showTurtle) {
                this.head.show()
                this.head.update([this.x, this.y,this.z], this.rotation, this.color)
            } else {
                this.head.hide()
            }
            this.endTurtle="reaching"
        }

        if(this.endTurtle=="reaching") {
            //for some reason needs to be next frame after head render
            if (t>=(100+this.timeline.endTime)) {
                this.hatch()
                this.endTurtle="reached"
            }
        }

        if(this.snapshot==null && t>200) {
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
                this.glyphGroup.elements.map(text => text.dispose())
                break;

            case "head":
                if (path.visible){
                    this.head.show()
                    this.head.update(path.points, path.rotation, path.color)
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
                    console.log(positions)
                    geometry.setPositions(positions);

                    const material = new LineMaterial({
                        color: path.color || 0xff4500, // DarkOrange as hex
                        linewidth: 2, 
                        vertexColors: false,
                        dashed: false,
                    });

                    material.resolution.set(window.innerWidth, window.innerHeight);

                    // Create Line2 mesh
                    const mesh = new Line2(geometry, material);
                    this.pathGroup.add(mesh);
                    // const geometry = new THREE.BufferGeometry().setFromPoints(path.points);
                    // const material = new THREE.LineBasicMaterial({
                    //     color: path.color || 'DarkOrange',
                    //     linewidth: 2
                    // });

                    // const mesh = new THREE.Line(geometry, material);
                    // this.pathGroup.add(mesh);

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
                    console.log(path.rotation)
                    newText.quaternion.copy(path.rotation)

                    newText.color = path.color
                    newText.sync()
                    this.glyphGroup.elements.push(newText);



                    // this.glyphist.setGlyph(path.text, path.text, {position: new THREE.Vector3(...path.points[0]),
                    //                                               rotation: path.rotation,
                    //                                               scale: new THREE.Vector3(...[path.text_size, path.text_size, path.text_size])
                    //                                              });

                     } catch (error) {
                    console.warn('Error writing text:', error);
                }
                break;
            }

        });
    }

    hatch(){
        const width = this.canvas.width;
        const height = this.canvas.height
        const pixels = new Uint8Array(width * height * 4); // RGBA
        this.ctx.readPixels(0, 0, width, height, this.ctx.RGBA, this.ctx.UNSIGNED_BYTE, pixels);
        this.snapshot = pixels
        setTimeout(() => {
            if(this.snapshot) {
            this.bridge.pub(["hatchTurtle", {"commands": this.instructions, "path": processImage(this.snapshot, this.canvas.width, this.canvas.height)}])
            }
        }, 0)
    }

    wait(duration=1) {
        // record a head entry for rendering head at end of timeframe
        this.currentPath = {
            ...this.pathTemplate,
            type: "head",
            points: [this.x, this.y, this.z],
            color: this.color,
            rotation: this.rotation,
            visible: this.showTurtle
        };

        const currentFrame = this.timeline.frames.get(this.timeline.currentTime) || [];
        currentFrame.push(this.currentPath);
        this.timeline.frames.set(this.timeline.currentTime, currentFrame);

        this.timeline.currentTime += duration*1000;
        this.timeline.endTime = Math.max(this.timeline.endTime, this.timeline.currentTime);



        // Create new frame entry if it doesn't exist
        if (!this.timeline.frames.has(this.timeline.currentTime)) {
            this.timeline.frames.set(this.timeline.currentTime, []);
        }
        this.currentPath= null
    }

    goto(x=0, y=0, z=null) {

        const newX = x;
        const newY = y;
        const newZ = z ?? this.z

        if (this.penDown) {
                // Create new path segment
                if (!this.currentPath) {
                    this.currentPath = {
                        ...this.pathTemplate,
                        color: this.color,
                        points: [{x: this.x, y: this.y, z: this.z}]
                    };

                    const currentFrame = this.timeline.frames.get(this.timeline.currentTime) || [];
                    currentFrame.push(this.currentPath);
                    this.timeline.frames.set(this.timeline.currentTime, currentFrame);
                }
                //color transition
                this.currentPath.points.push({x: newX, y: newY, z: newZ});
            }
        else {
            this.currentPath= null
        }

            this.x = newX;
            this.y = newY;
            this.z = newZ;

            // Store current state for recovery if needed
            this.executionState = {
                x: this.x,
                y: this.y,
                z: this.z,
                rotation: new Versor(
                    this.rotation.w,
                    this.rotation.x,
                    this.rotation.y,
                    this.rotation.z
                )
            };

    }

    jmpto(x=0, y=0, z=null) {
        this.noPen();
        this.goto(x, y, z)
        this.oPen()
    }

    faceto(targetX=0, targetY=0, targetZ=null) {
        // Convert target coordinates to the same scale as internal coordinates
        const tx = targetX;
        const ty = targetY;
        const tz = targetZ ?? this.z;

        // Calculate direction vector from current position to target
        const dx = tx - this.x;
        const dy = ty - this.y;
        const dz = tz - this.z;

        // Calculate angle in the XY plane (yaw)
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);

        // Create rotation versor for this angle
        const rotation = Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, angle);

        // Reset current rotation and apply new rotation
        this.rotation = rotation;

        // Update execution state
        this.executionState.rotation = new Versor(
            this.rotation.w,
            this.rotation.x,
            this.rotation.y,
            this.rotation.z
        );
    }


    erase(){
        this.currentPath = {
            ...this.pathTemplate,
            type: "clear"
        };

        const currentFrame = this.timeline.frames.get(this.timeline.currentTime) || [];
        currentFrame.push(this.currentPath);
        this.timeline.frames.set(this.timeline.currentTime, currentFrame);
        this.currentPath = null;
    }


    label(text="⚙", size=10){
        this.currentPath = {
            ...this.pathTemplate,
            type: "text",
            points: [[this.x, this.y, this.z]],
            color: this.color,
            text: text,
            // html canvas cant space numbers accurately below this
            text_size: size,
            rotation: this.rotation
            //id: crypto.getRandomValues(new Uint32Array(1))[0]
        };

        //should outsource to seperate canvas
        const currentFrame = this.timeline.frames.get(this.timeline.currentTime) || [];
        currentFrame.push(this.currentPath);
        this.timeline.frames.set(this.timeline.currentTime, currentFrame);
        this.currentPath = null;
    }

    forward(distance=0) {
            const direction = { x: 1, y: 0, z: 0 };
            const rotatedDirection = this.rotation.rotate(direction);
            const newX = this.x + rotatedDirection.x * distance;
            const newY = this.y + rotatedDirection.y * distance;
            const newZ = this.z + rotatedDirection.z * distance;

        if (this.penDown) {
            // Create new path segment
            if (!this.currentPath) {
                this.currentPath = {
                    ...this.pathTemplate,
                    color: this.color,
                    points: [{x: this.x, y: this.y, z: this.z}]
                };


                const currentFrame = this.timeline.frames.get(this.timeline.currentTime) || [];
                currentFrame.push(this.currentPath);
                this.timeline.frames.set(this.timeline.currentTime, currentFrame);
            }
            //color transition
            this.currentPath.points.push({x: newX, y: newY, z: newZ});
            console.log(this.currentPath)
        }
        else {
            this.currentPath= null
        }

            this.x = newX;
            this.y = newY;
            this.z = newZ;

            // Store current state for recovery if needed
            this.executionState = {
                x: this.x,
                y: this.y,
                z: this.z,
                rotation: new Versor(
                    this.rotation.w,
                    this.rotation.x,
                    this.rotation.y,
                    this.rotation.z
                )
            };

    }

    fill() {
        if (this.currentPath) {
            this.currentPath.filled = true;
            this.currentPath = null;
        }
    }

    clear() {

        this.currentPath = null;
        this.pathGroup.clear()
        this.glyphGroup.clear()
        this.glyphGroup.elements.map(text => text.dispose())
        this.timeline.lastRenderTime = 0;
        this.requestRender();
    }

    defineFunction(name, parameters, body) {
        this.functions[name] = {
            parameters, body
        }
    }

    callFunction(name, args, ctx, depth=0) {
        if (depth > this.maxRecurseDepth) return;
        // get from local scope first
        name = ctx[name] || name
        const func = this.functions[name];
        if (!func)
        {this.callCommand(name, ...args)}
        else
        {
            const context = {};
            func.parameters.forEach((param, index) => {
                context[param] = args[index] || 0;
            });
            context['__depth__'] = depth;
            return this.executeBody(func.body, context);
        }
    }

    callCommand(commandName, ...args) {
        const com = this.commands[commandName];
        if (com) {
            if (this.commandCount >= this.maxCommands) {
                throw new Error(`Maximum command limit of ${this.maxCommands} reached`);
            }
            this.commandCount++;
            com(...args); // Call the command with its arguments
        } else {
            throw new Error(`Function ${commandName} not defined`);
        }
    }

    executeBody(body, context) {
        let matched = false;
        body.forEach(node => {
            switch (node.type) {
            case 'Loop':
                const times = this.evaluateExpression(node.value, context); // is context getting dereferenced fi needed
                for (let i = 0; i < times; i++) {
                    this.executeBody(node.children, context);
                }
                break;
            case 'Call':
                const args = node.children.map(arg => this.evaluateExpression(arg.value, context));
                const currDepth = context['__depth__'] || 0;
                if(currDepth > 1) this.recurseCount++ ;
                if (this.recurseCount >= this.maxRecurses) {
                    throw new Error(`Maximum recurse limit of ${this.maxRecurses} reached`);
                }
                this.callFunction(node.value, args, context, currDepth + 1); // ...args
                break;

            case 'Define':
                const params = node.meta?.args?.map(n => n.value) || []
                this.defineFunction(node.value,  params, node.children)
                break;

            case 'When':
                const pattern = node.value;
                if (!matched && this.evaluateExpression(pattern, context) !== 0 ) {
                    matched = true;
                    this.executeBody(node.children, context);
                }
                break;

                }


        });
    }

    evaluateExpression(expr, context) {
        //string support
        const quoteRegex = /^(['"])(.*?)\1$/;
        const quoteMatch = expr.match(quoteRegex);
        if (quoteMatch) {
            const [_, quote, stringContent] = quoteMatch;

            // process nested interpolations from inside out "sine is [sin[theta]]"
            let processed = stringContent;
            let previous;
            do {
                previous = processed;
                processed = processed.replace(
                    /\[([^[\]](?:[^[\]]|\[(?:\\.|[^[\]])*\])*)\]/g,
                    (match, innerExpr) => {
                        // Skip evaluation if inner expression is wrapped in curly braces
                        if (innerExpr.trim().match(/^\`.*\`$/)) {
                            return match;
                        }
                        const value = this.evaluateExpression(innerExpr.trim(), context);
                        return value !== undefined ? String(value) : match;
                    }
                );
            } while (processed !== previous);

            return processed;
        }

        if (this.math.parser.isNumeric(expr)) return parseFloat(expr);
        if (context[expr] != null) return context[expr];
        const tree = this.math.parser.run(expr)
        if (tree.children.length > 0 || this.math.evaluator.namespace_check(tree.value)) return this.math.evaluator.run(tree, context);
        return tree.value // probably a string
    }

    func(expr, implement){
        console.log(expr)
        console.log(this.math.parser.run(expr))
    }

    reset() {
        this.spawn()
        this.clear();
        this.renderdepth = 0
        //this.glyphist.clear()
        this.shapist.dispose()
        this.timeline = {
            currentTime: 0,
            endTime: 0,
            frames: new Map(),
            lastRenderTime: 0,
            lastRenderFrame: 0
        };
        this.commandCount = 0
        this.recurseCount = 0
        this.maxRecurseDepth = 360
        this.rotation = new Versor(1, 0, 0, 0);
        this.penDown = true;
        this.color = 'DarkOrange';
        this.snapshot = null
        this.endTurtle = "start"
        this.showTurtle = true;
        this.currentPath = null;
        this.renderLoop.requestRestart();
    }




    roll(angle=0) {
        const rotation = Versor.fromAxisAngle({ x: 1, y: 0, z: 0 }, angle);
        this.rotation = rotation.multiply(this.rotation);
    }

    pitch(angle=0) {
        const rotation = Versor.fromAxisAngle({ x: 0, y: 1, z: 0 }, angle);
        this.rotation = rotation.multiply(this.rotation);
    }

    yaw(angle=0) {
        const rotation = Versor.fromAxisAngle({ x: 0, y: 0, z: 1 }, angle);
        this.rotation = rotation.multiply(this.rotation);
    }

    left(angle=0) {
        this.yaw(angle);
    }

    right(angle=0) {
        this.yaw(-angle);
    }

    jump(distance){

        this.noPen();
        this.forward(distance);
        this.oPen();
    }

    move(speed){
        this.speed = speed
    }

    noPen() {
        this.penDown = false;
    }

    oPen() {
        this.penDown = true;
    }



    redraw() {
        // if(this.instructions.length > 0) requestAnimationFrame(this.executeBody(this.instructions, {}));
        if(this.instructions.length > 0)
            requestAnimationFrame(() => {
            this.reset();
            this.requestRender();
            this.executeBody(this.instructions, {})
            });
    }

    draw(instructions, opts= {}) {
        const options = { ...{comms: true}, ...opts };
        this.reset();
        if (options.comms) this.snapshot=null
        this.requestRender();
        this.executeBody(instructions, {});
        this.instructions = instructions


    }


    hideTurtle() {
        this.showTurtle = false;
    }

    unhideTurtle() {
        this.showTurtle = true;
    }

    setRecurseLimit(limit = 361) {
        this.maxRecurseDepth = limit+1
    }

    setCommandLimit(limit = 100000) {
        this.maxCommands = limit
    }

    setColor(color = "silver") {
        this.color = color;
        if (color == "invisible") this.color = "#00000000"
        if (Number.isFinite(color)) this.color = `hsla(${~~(360 * color)}, 70%,  72%, 0.8)`
        if (color == "random") this.color = `hsla(${~~(360 * Math.random())}, 70%,  72%, 0.8)`
        if(/^([0-9a-f]{3}){1,2}$/i.test(color)) this.color = "#" + color
        //break path for new path
        this.currentPath = null;
    }
}

function processImage(pixels, width, height) {
    const halfHeight = Math.floor(height / 2);
    const bytesPerRow = width * 4;
    const temp = new Uint8Array(bytesPerRow);
    //flipPixelsVertically
    for (let y = 0; y < halfHeight; y++) {
        const topOffset = y * bytesPerRow;
        const bottomOffset = (height - y - 1) * bytesPerRow;
        temp.set(pixels.subarray(topOffset, topOffset + bytesPerRow));
        pixels.copyWithin(topOffset, bottomOffset, bottomOffset + bytesPerRow);
        pixels.set(temp, bottomOffset);
    }
    const imagedata = new ImageData(new Uint8ClampedArray(pixels), width, height)
    return trimImage(imagedata, width, height)
}


function trimImage(imageData, width, height) {
    const data = imageData.data;

    let xMin = width, xMax = -1, yMin = height, yMax = -1;

    // Loop through pixels to find the bounding box of non-transparent pixels
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            if (data[index + 3] > 0) { // Check alpha channel
                if (x < xMin) xMin = x;
                if (x > xMax) xMax = x;
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
            }
        }
    }

    // If no pixels found, return early
    if (xMax < xMin || yMax < yMin) return null;

    const newWidth = xMax - xMin + 1;
    const newHeight = yMax - yMin + 1;

    // Create an offscreen canvas
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = newWidth;
    offscreenCanvas.height = newHeight;
    const offscreenCtx = offscreenCanvas.getContext('2d');

    // Create new ImageData for the cropped region
    const croppedImageData = offscreenCtx.createImageData(newWidth, newHeight);
    const croppedData = croppedImageData.data;

    // Copy pixels from original to cropped image data
    for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
            const srcIndex = ((yMin + y) * width + (xMin + x)) * 4;
            const dstIndex = (y * newWidth + x) * 4;

            croppedData[dstIndex] = data[srcIndex];         // R
            croppedData[dstIndex + 1] = data[srcIndex + 1]; // G
            croppedData[dstIndex + 2] = data[srcIndex + 2]; // B
            croppedData[dstIndex + 3] = data[srcIndex + 3]; // A
        }
    }

    // Put the cropped image data into the offscreen canvas
    offscreenCtx.putImageData(croppedImageData, 0, 0);

    // Return the cropped image as a data URL
    return offscreenCanvas.toDataURL();
}

