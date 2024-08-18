import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import {printAST, parseProgram } from "../turtling/parse.js"
import {seaBridge} from "../bridged.js"
import { computePosition, offset, inline, autoUpdate } from "../../vendor/floating-ui.dom.umd.min";

const snippets = [
  { text: 'fw 1', displayText: 'go forward 1 unit' },
  { text: 'hd', displayText: 'hide turtle' },
  { text: 'jmp 1', displayText: 'jump by 1 unit' },
  { text: 'rt 90', displayText: 'turn right angle 90' },
  { text: 'lt 90', displayText: 'turn left angle 90 ' },
  { text: 'for 2 ()', displayText: 'repeat twice' },
];

Shell = {
    mounted() {
      // on init find the triumvirate
      const canvas = document.getElementById('canvas');
      const output = document.getElementById('output');
      const shell = new Terminal(this.el, CodeMirror).init();
      // set up event listeners
      const debouncedRunCode = debounce(this.run, 180);

      const cachedVal = loadEditorContent()


      // seabridge dispatcher babyy
      seaBridge.sub((payload) =>
        this.pushEvent(payload[0], payload[1])
      )
      // init editor state
      shell.setValue(cachedVal);
      this.run(cachedVal, canvas);

      // start listening
      shell.on('change', function(cm, change) {
        const val = cm.getValue()
        saveEditorContent(val);
        debouncedRunCode(val, canvas)
      })
      shell.on('mousedown', function(cm, change) {
        var old_slider = document.getElementById('slider');
        var selection = window.getSelection()
        if (!selection || selection.rangeCount <= 0) {
          old_slider.classList.add("hidden")
          return
        }
        else {
        const pos = cm.coordsChar({ left: event.clientX, top: event.clientY });
        const line = cm.getLine(pos.line);
        const token = cm.getTokenAt(pos);
        var getSelectRect = selection.getRangeAt(0).getBoundingClientRect();
        const numpat = /[+-]?\d*\.\d+|[+-]?\d+/g;
        // Check if the token is a number
        if (token.string.match(numpat)) {
          var new_slider = old_slider.cloneNode(true);
          new_slider.value = 1
          old_slider.parentNode.replaceChild(new_slider, old_slider);
          new_slider.addEventListener("input", function() {
            let charCount = 0;
            let val = null;
            let index = 0;
            // we cant trim the whitespace as pos accounts for it
            const wsregex = /(\S+|\s+)/g;
            const linecode = line.split(wsregex)
            for (let i = 0; i < linecode.length; i++) {
              const str = linecode[i];
              charCount += str.length;

              if (charCount >= pos.ch && str.includes(token.string)) {
                val = str;
                index = i;
                break; // Exit the loop once we find the match
              }
            }
            if (val){
            //slidervalue get
            const sliderValue = Math.round(new_slider.value*val * 100) / 100;
            linecode[index] = sliderValue
            // Replace all numbers in the line with the slider value
            const replacedLine = linecode.join('')
            cm.replaceRange(replacedLine, { line: pos.line, ch: 0 }, { line: pos.line, ch: 100 });
            }});
          // Position the slider near the hovered number
          new_slider.classList.remove("hidden")

          var getSelectRect = selection.getRangeAt(0).getBoundingClientRect();

          computePosition(event.target, new_slider, {placement: 'top-end', middleware: [offset(5)]}).then(({x, y}) => {
            new_slider.classList.remove("hidden")
            Object.assign(new_slider.style, {
              left: `${getSelectRect.x}px`,
              top: `${y}px`,
            });
          })
        } else {
          old_slider.classList.add("hidden")
        }
        }
      })
    },

  run(val, canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const turtle = new Turtle(canvas);
    const code = val;


    try {
      const commands = parseProgram(code);

      // Clear canvas
      // turtle.ctx.clearRect(0, 0, canvas.width, canvas.height);

      turtle.draw(commands)
      const path = canvas.toDataURL()
      seaBridge.pub(["hatchTurtle", {"commands": commands, "path": path}])

      // Display output
      output.innerHTML = `Instructions executed: ${turtle.commandCount}`;


    } catch (error) {
      output.innerHTML = `Error: ${error.message}`;
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

function saveEditorContent(val) {
  localStorage.setItem('@my.turtle', val);
}

function loadEditorContent() {
  return localStorage.getItem('@my.turtle') || `rt 30
jmp 200
hd
draw spiral size fo fi (
 beColour gold
 # character arc begins
 for 360/[2*4] (
  fw size
  rt 2
 )
 spiral size*[fo+fi]/fi fi fi+fo #fibo go brrr
)
spiral 1 1 1`;
}

export default Shell;
