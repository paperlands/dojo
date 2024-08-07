import { Parser } from "./mafs/parse.js"
import { Evaluator } from "./mafs/evaluate.js"

export class Turtle {
    constructor(canvas) {
        this.ctx = canvas.getContext('2d');
        this.reset();
        this.commands = {
            // Add other command references here
            fw: this.forward.bind(this),
            rt: this.right.bind(this),
            lt: this.left.bind(this),
            show: this.unhideTurtle.bind(this),
            hd: this.hideTurtle.bind(this),
            jmp: this.jmp.bind(this),
            beColour: this.setColor.bind(this)
        };
        this.functions = {};

        // Command execution tracking
        this.commandCount = 0;
        this.maxCommands = 5000;
        this.maxRecurse = 36


        //mafs
        this.math = {
            parser: new Parser(),
            evaluator: new Evaluator()
        }
    }

    spawn() {
        this.x = this.ctx.canvas.width / 2;
        this.y = this.ctx.canvas.height / 2;
    }

    defineFunction(name, parameters, body) {
        this.functions[name] = { parameters, body };
    }

    callFunction(name, args, depth =0) {
        if (depth >= this.maxRecurse) {
            this.forward(0.01)
            return;
        }
        const func = this.functions[name];
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
                this.callFunction(node.value, args, currDepth + 1); // ...args
                break;

            case 'Define':
                const params = node.meta?.args?.map(n => n.value) || []
                this.defineFunction(node.value,  params, node.children)
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
        if( this.x == undefined ) {
            this.spawn();
        }

        const scrolly = (this.y > window.innerHeight) && (this.y + window.innerHeight / 2) || this.y
        window.scrollTo(this.x , scrolly);
        this.angle = 0;
        this.penDown = true;
        this.color = 'red';
        this.ctx.strokeStyle = this.color;
        this.ctx.beginPath();
        this.ctx.moveTo(this.x, this.y);
        this.showTurtle = true;
    }

    forward(distance) {
        const newX = this.x + distance * Math.cos(this.angle * Math.PI / 180);
        const newY = this.y + distance * Math.sin(this.angle * Math.PI / 180);
        if (this.penDown) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.x, this.y);
            this.ctx.lineTo(newX, newY);
            this.ctx.stroke();
        }
        this.x = newX;
        this.y = newY;
    }

    right(angle) {
        this.angle += angle;
    }

    left(angle) {
        this.angle -= angle;
    }

    jmp(distance){

        this.noPen();
        this.forward(distance);
        this.oPen();
    }

    noPen() {
        this.penDown = false;
    }

    oPen() {
        this.penDown = true;
    }

    drawTurtle() {
        if (this.showTurtle) {
            const headSize = 10;

            this.ctx.save();
            this.ctx.fillStyle = this.color;
            this.ctx.translate(this.x, this.y);
            this.ctx.rotate(this.angle * Math.PI / 180);

            this.ctx.beginPath();
            this.ctx.moveTo(headSize, 0);
            this.ctx.lineTo(-headSize / 2, headSize / 2);
            this.ctx.lineTo(-headSize / 2, -headSize / 2);
            this.ctx.closePath();
            this.ctx.fill();

            this.ctx.restore();

        }}

    hideTurtle() {
        this.showTurtle = false;
    }

    unhideTurtle() {
        this.showTurtle = true;
    }

    setColor(color) {
        this.color = color;
        this.ctx.strokeStyle = this.color;
    }
}
