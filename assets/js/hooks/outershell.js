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
      this.handleEvent("seeOuterShell", (buffer) =>
          !this.active && this.initOuterShell(this.el, buffer));
  },
  beforeUpdate() { // gets called synchronously, prior to update

  },
  updated() { // gets called when the elem changes

  },
  //...other in methods
  //
    initOuterShell(el, buffer){
        const canvas = document.getElementById('outercanvas');
        const turtle = new Turtle(outercanvas);
        const shell = new Terminal(el, CodeMirror).init();

        const debouncedRunCode = debounce(this.run, 180);

        this.active = true

        shell.on('change', function(cm, change) {
        const val = cm.getValue()
        debouncedRunCode(val, canvas, turtle)
      })
    },

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

function saveBufferContent(addr, mod, name,  val) {
    localStorage.setItem(`@${addr}.${mod}.${name}`, val);
}




export default OuterShell;
