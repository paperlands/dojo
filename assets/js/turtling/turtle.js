import { Parser } from "./mafs/parse.js"
import { Evaluator } from "./mafs/evaluate.js"
import { Versor } from "./mafs/versors.js"
import { Camera } from "./camera.js"
import { seaBridge, cameraBridge } from "../bridged.js"

export class Turtle {
    constructor(canvas) {
        this.ctx = canvas.getContext('2d');
        this.canvas = canvas;
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
            home: this.spawn.bind(this),
            fill: this.fill.bind(this),
            // wait: this.wait.bind(this),
            clear: this.clear.bind(this),
            beColour: this.setColor.bind(this)
        };
        this.functions = {};
        this.instructions = [];
        this.paths = []; // Store drawing operations
        this.executionState = {
            x: 0,
            y: 0,
            z: 10,
            rotation: new Versor(1, 0, 0, 0)
        };

        this.nowtime = 0
        this.comingtime = 0

        this.setupContinuousRendering();
        this.reset();

        // Set up animation frame for continuous rendering

        this.camera = new Camera(canvas, {
            pub: () => this.requestRender()
        })
        this.speed = 0

        // Camera can intervene on the view of the world
        cameraBridge.sub(() =>
            this.redraw()
        )
        this.rotation = new Versor(1, 0, 0, 0); // Identity quaternion
        // Command execution tracking
        this.commandCount = 0;
        this.recurseCount = 0,
        this.maxRecurses = 888888;
        this.maxCommands = 88888;
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
        this.z = 10
        this.currentPath=null
    }

    setupContinuousRendering() {
        let renderRequested = false;

        const renderLoop = () => {
            if (renderRequested) {
                this.render();
                renderRequested = false;
            }
            requestAnimationFrame(renderLoop);
        };

        this.requestRender = () => {
            renderRequested = true;
        };

        renderLoop();
    }

       render() {
        const cam = this.camera.now();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Save the current transform state
        this.ctx.save();

        // Apply camera transform
        this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);

        // Apply perspective scale based on camera Z position
        const scale = 100 / Math.max(cam.z, 1); // Prevent division by zero
        this.ctx.scale(scale, scale);

        // Apply camera position offset
        this.ctx.translate(-cam.x, -cam.y);

        // Draw all stored paths (even if there were errors)
        this.drawStoredPaths(scale);

        // Always draw the turtle at its current position
        if (this.showTurtle) {
            this.drawTurtle(scale);
        }

        this.ctx.restore();
    }

    drawStoredPaths(scale) {
    this.paths.forEach(path => {
        if (!path.points || path.points.length === 0) return;

        // Start drawing a new path
        this.ctx.beginPath();
        this.ctx.strokeStyle = path.color || 'red';
        this.ctx.lineWidth = (path.lineWidth || 2) / scale;

        try {
            // Iterate through each point in the path
            path.points.forEach((point, index) => {
                // Move to or draw line to the current point
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });

            // Final stroke for the last segment
            this.ctx.stroke();

            // Fill if necessary
            if (path.filled) {
                this.ctx.fillStyle = path.color || 'red';
                this.ctx.fill();
            }
        } catch (error) {
            console.warn('Error drawing path:', error);
        }
    });}


    drawTurtle(scale) {
        const headSize = 15 / scale;
        this.ctx.save();

        this.ctx.fillStyle = this.color;
        this.ctx.translate(this.x, this.y);

        // Apply turtle rotation with error handling
        try {
            const transformValues = this.rotation.getTransformValues();
            this.ctx.transform(
                transformValues.a, transformValues.b,
                transformValues.c, transformValues.d,
                transformValues.e, transformValues.f
            );
        } catch (error) {
            console.warn('Error applying turtle rotation:', error);
            // Use identity transform if rotation fails
            this.ctx.transform(1, 0, 0, 1, 0, 0);
        }

        // Draw turtle head
        this.ctx.beginPath();
        this.ctx.moveTo(headSize, 0);
        this.ctx.lineTo(-headSize / 2, headSize / 2);
        this.ctx.lineTo(-headSize / 2, -headSize / 2);
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.restore();
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
                        points: [{x: this.x, y: this.y}],
                        color: this.color,
                        lineWidth: this.ctx.lineWidth,
                        filled: false
                    };
                    this.paths.push(this.currentPath);
                }
                //color transition
                this.currentPath.points.push({x: newX, y: newY});
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
        this.paths = [];
        this.currentPath = null;
        this.requestRender();
        // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }



    defineFunction(name, parameters, body) {
        this.functions[name] = { parameters, body };
    }

    callFunction(name, args, ctx, depth =0) {
        if (depth >= this.maxRecurseDepth) {
            this.forward(0.01)
            return;
        }
        //console.log(name , args ,ctx , depth)
        const func = this.functions[name] || (ctx[name] && this.functions[ctx[name]]);
        if (!func)
        {this.callCommand(name, ...args)}
        else
        {
            const context = {};
            func.parameters.forEach((param, index) => {
                context[param] = args[index];
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
        if (this.math.parser.isNumeric(expr)) return parseFloat(expr);
        if (context[expr]) return context[expr];
        const tree = this.math.parser.run(expr)
        if (tree.children.length > 1) return this.math.evaluator.run(tree, context);
        return tree.value // probably a string
    }

    reset() {
        this.spawn()
        this.clear();
        this.commandCount = 0
        this.recurseCount = 0
        this.rotation = new Versor(1, 0, 0, 0);
        this.penDown = true;
        this.color = 'red';
        this.ctx.strokeStyle = this.color;
        this.ctx.lineWidth = 2;
        // this.ctx.shadowBlur = 8;
        // this.ctx.shadowColor = "white";
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(this.x, this.y);
        this.showTurtle = true;
        this.currentPath = null;

        this.requestRender();
    }


    projectX(x, z) {
        const cam = this.camera.now()
        const perspective = cam.z > z ? cam.z / (cam.z - z) : 0;
        return (x - cam.x) * perspective + this.ctx.canvas.width / 2;
    }

    projectY(y, z) {
        const cam = this.camera.now()
        const perspective = cam.z > z ? cam.z / (cam.z - z) : 0;
        return (y - cam.y) * perspective + this.ctx.canvas.height / 2;
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

    left(angle) {
        this.yaw(-angle);
    }

    right(angle) {
        this.yaw(angle);
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
        if(this.instructions.length > 0) requestAnimationFrame(() => {

            this.reset();
            this.executeBody(this.instructions, {})
            this.head()});
    }

    draw(instructions) {
        this.reset();
        this.executeBody(instructions, {});

        this.instructions = instructions

        setTimeout(() => {
            seaBridge.pub(["hatchTurtle", {"commands": instructions, "path": this.canvas.toDataURL()}])
        }, 1000)



    }
    hideTurtle() {
        this.showTurtle = false;
    }

    unhideTurtle() {
        this.showTurtle = true;
    }

    setColor(color = "silver") {
        this.color = color;
        if (color == "invisible") this.color = "#00000000"
        this.ctx.strokeStyle = this.color;
        //break path for new path
        this.currentPath = null;
    }
}
