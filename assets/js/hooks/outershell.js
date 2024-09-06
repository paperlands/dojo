/*
 * Hook to boot Outershells and manage its buffers
 */

import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import {printAST, parseProgram } from "../turtling/parse.js"
import {seaBridge} from "../bridged.js"
import { computePosition, offset, inline, autoUpdate } from "../../vendor/floating-ui.dom.umd.min";

OuterShell = {
    mounted() {
        this.handleEvent("seeOuterShell", (sight) => {
          if (this.active) {
            this.createBuffer(sight.ast);
          } else {
            this.initOuterShell(this.el, sight.ast);
          }
        });

    this.buffers = {}; // Store buffers
    this.activeBuffer = null; // Track the currently active buffer
  },
  beforeUpdate() { // gets called synchronously, prior to update

  },
  updated() { // gets called when the elem changes

  },
  //...other in methods
  //
    initOuterShell(el, ast){
        const canvas = document.getElementById('outercanvas');
        const turtle = new Turtle(outercanvas);
        this.shell = new Terminal(el, CodeMirror).init();

        const debouncedRunCode = debounce(this.run, 180);

        this.active = true

        this.shell.on('change', function(cm, change) {
        const val = cm.getValue()
        debouncedRunCode(val, canvas, turtle)

      })

        this.createBuffer(ast);
    },

  createBuffer(ast) {
      const buffer = printAST(ast)
      const doc = CodeMirror.Doc(buffer, "apl"); // Create a new document
    this.buffers["test"] = doc; // Store the document in buffers
    this.switchBuffer("test"); // Switch to the new buffer
  },

  switchBuffer(name) {
    if (this.buffers[name]) {
      const oldDoc = this.shell.getDoc(); // Get the current document
      this.shell.swapDoc(this.buffers[name]); // Switch to the new document
      this.activeBuffer = name; // Update the active buffer
      // this.loadBufferContent(name); // Load content if exists
    } else {
      console.error(`Buffer ${name} does not exist.`);
    }
  },

  loadBufferContent(name) {
    //const content = localStorage.getItem(name) || '';
    //this.shell.setValue(content); // Set the content of the editor
  },

  // saveBufferContent(addr, mod, name,  val) {
  //   localStorage.setItem(`@${addr}.${mod}.${name}`, val);
  // },

  run(val, canvas, turtle) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;


    const code = val;


    try {
      const commands = parseProgram(code);
      turtle.draw(commands)
      const path = canvas.toDataURL()

      // Display output
      //output.innerHTML = `${turtle.commandCount}`;


    } catch (error) {
      //output.innerHTML = `Error: ${error.message}`;
      console.error(error);
    }


  }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}




export default OuterShell;
