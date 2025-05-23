import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import {printAST, parseProgram } from "../turtling/parse.js"
import {seaBridge, cameraBridge} from "../bridged.js"
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
      // const world = new World(canvas);
      const turtle = new Turtle(canvas);
      const shell = new Terminal(this.el, CodeMirror).init();
      // set up event listeners
      const debouncedRunCode = debounce(this.run, 180);

      const cachedVal = loadEditorContent()


      this.handleEvent("relayCamera", (details) => {
        switch (details.command) {
        case 'center_camera':
          cameraBridge.pub(["recenter", {}])
          break;
        case 'start_record':
          cameraBridge.pub(["record", {}])
          break;
        case 'end_record':
          cameraBridge.pub(["endrecord", {}])
          break;
        default:
          //nothing

            }
      })

      this.handleEvent("selfkeepCanvas", (details) => {
        const userFilename = prompt('Enter filename for your PNG:', details.title) || details.title;

        if (userFilename) {
          // Add .png extension if not included
          const filename = userFilename.endsWith('.png') ? userFilename : `${userFilename}.png`;

          // Create a temporary canvas for post-processing
          const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
          const tempCtx = offscreen.getContext('2d');

          // First fill with black background
          tempCtx.fillStyle = 'black';
          tempCtx.fillRect(0, 0, offscreen.width, offscreen.height);

          // Then draw the original canvas content on top
          tempCtx.drawImage(canvas, 0, 0);

          offscreen.convertToBlob({ type: 'image/png', quality: 1.0 }).then((blob) => {
            if (!blob) {
              console.error('Failed to convert canvas to Blob.');
              return;
            }

            // Create a URL for the blob
            const url = URL.createObjectURL(blob);

            // Create and trigger download
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Revoke the object URL after download to free memory
            URL.revokeObjectURL(url);


            }).catch((err) => {
      console.error('Error during canvas blob conversion:', err);
    })

        }

      })

      this.handleEvent("writeShell", (instruction) => {
        const cmd = instruction["command"]
        const args = instruction["args"]
        switch (cmd) {
        case "undo":
          shell.undo()
          break;
        default:
          const doc = shell.getDoc();
          const token = shell.getTokenAt(shell.getCursor());
          const cursor = doc.getCursor(); // gets the line number in the cursor position
          const line = doc.getLine(cursor.line); // get the line contents
          const pos = { // create a new object to avoid mutation of the original selection
            line: cursor.line,
            ch: line.length // set the character position to the end of the line
          }
          if (args && args.length > 0) {
            const argstr = args.reduce((acc, arg) => {
              const cmdparam = document.getElementById("cmdparam-" + cmd + "-" + arg)
              acc += " " + cmdparam.value || cmdparam.defaulted
              return acc
            }, "")
            doc.replaceRange("\n".padEnd(1+token.state.indented) + cmd + argstr, pos);
          } else {
            doc.replaceRange("\n".padEnd(1+token.state.indented) + cmd , pos);
          }
          // Add the new line


          // Get the new line number (cursor.line + 1)
          const newLineNumber = cursor.line + 1;

          // Create a marker for the new line
          const marker = doc.markText(
            {line: newLineNumber, ch: 0},
            {line: newLineNumber, ch: doc.getLine(newLineNumber).length},
            {className: 'flash-highlight'}
          );

          // Remove the marker after a delay
          setTimeout(() => {
            marker.clear();
          }, 1500); // Duration of the flash effect (1.5 seconds)
        }
      });

      // seabridge dispatcher babyy
      seaBridge.sub((payload) =>
        this.pushEvent(payload[0], payload[1])
      )
      // init editor state
      shell.setValue(cachedVal);
      this.run(cachedVal, canvas, turtle);

      // start listening
      shell.on('change', function(cm, change) {
        const val = cm.getValue()
        saveEditorContent(val);
        debouncedRunCode(val, canvas, turtle)
      })

      shell.on('beforeSelectionChange', (cm, select) => {
        const lineNumbers = new Set(); // Use Set to avoid duplicates

        select.ranges.forEach(range => {
          const startLine = range.anchor.line;
          const endLine = range.head.line;

          // Add all lines between start and end, inclusive
          for (let line = Math.min(startLine, endLine);
               line <= Math.max(startLine, endLine);
               line++) {
            lineNumbers.add(line);
          }
        });
      });

      let sliderhideoutId;
      const old_slider = document.getElementById('slider');

      old_slider.addEventListener('mouseover', () => {
            clearTimeout(sliderhideoutId); // Clear the timeout when hovering over the message
        });

      old_slider.addEventListener('mouseleave', resetSliderHideout);

      shell.on('dblclick', function(cm, change) {
        const selection = window.getSelection();

        resetSliderHideout();


        if (!selection || selection.rangeCount <= 0) {
          old_slider.classList.add("hidden");
          return;
        }

        const pos = cm.coordsChar({ left: event.clientX, top: event.clientY });
        const line = cm.getLine(pos.line);
        let token = cm.getTokenAt(pos);
        if (token.type == null) {
          // so that it checks one character to the right as well
          pos.ch += 1
          token = cm.getTokenAt(pos)
        }
        const numpat = /[+-]?\d*\.\d+|[+-]?\d+/g;

        // Check if the token is a number
        if (token.string.match(numpat)) {
          // Initialize the slider observer
          initializeSliderObserver(old_slider, cm, pos, line, token.string);

          // Position the slider near the hovered number
          old_slider.classList.remove("hidden");
          const getSelectRect = selection.getRangeAt(0).getBoundingClientRect();

          computePosition(event.target, old_slider, {placement: 'top-end', middleware: [offset(5)]}).then(({x, y}) => {
            Object.assign(old_slider.style, {
              left: `${getSelectRect.x}px`,
              top: `${y}px`,
            });
          });
        } else {
          old_slider.classList.add("hidden");
          if (slideObserver) slideObserver.disconnect();
        }
      });

      let slideObserver;

      function resetSliderHideout() {
        clearTimeout(sliderhideoutId);
        sliderhideoutId = setTimeout(function() {
          old_slider.classList.add("hidden");
        }, 3000);
      }

      function initializeSliderObserver(old_slider, cm, pos, line, tokenString) {
        if (slideObserver) slideObserver.disconnect(); // Disconnect previous observer if exists

        slideObserver = new MutationObserver(function(mut) {
          let charCount = 0;
          let val = null;
          let index = 0;

          // Split line into words and whitespace
          const wsregex = /(\S+|\s+)/g;
          const linecode = line.split(wsregex);

          for (let i = 0; i < linecode.length; i++) {
            const str = linecode[i];
            charCount += str.length;

            if (charCount >= pos.ch && str.includes(tokenString)) {
              val = str;
              index = i;
              break; // Exit loop once we find the match
            }
          }

          if (val) {
            // Slider value get
            const sliderValue = Math.round((7.2 * (mut[0].target.getAttribute(mut[0].attributeName) - 50)));
            linecode[index] = sliderValue;

            // Replace all numbers in the line with the slider value
            const replacedLine = linecode.join('');
            cm.replaceRange(replacedLine, { line: pos.line, ch: 0 }, { line: pos.line, ch: 100 });
          }
        });

        slideObserver.observe(old_slider, {
          subtree: true,
          childList: true,
          attributeFilter: ['slideval'],
        });
      }


    },

  run(val, canvas, turtle) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;


    const code = val;


    try {
      const commands = parseProgram(code);
      turtle.draw(commands)

      // Display output
      output.innerHTML = `${turtle.commandCount}`;


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
  return localStorage.getItem('@my.turtle') || `
draw spiral size fo fi do
 # character arc begins
 for 360/[2*4] do
  fw size
  rt 2
  wait 1/36
 end
 spiral size*[fo+fi]/fi fi fi+fo #fibo go brrr
end
hd
spiral 1 1 1`;
}



export default Shell;
