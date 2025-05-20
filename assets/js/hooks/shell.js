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

      const debouncedPushEvent = debounceIdem((eventName, eventData) => {
        this.pushEvent(eventName, eventData);
      }, 180);


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

      shell.on('beforeSelectionChange', (cmInstance, changeObj) => {
        // Log information about the selection change
        console.log('Selection is about to change');

        // Access the ranges (array of {anchor, head} objects)
        const ranges = changeObj.ranges;
        if (changeObj.ranges.length === 1) {
          const range = changeObj.ranges[0];
          // Only proceed if there's an actual selection (anchor != head)
          if (range.anchor.line !== range.head.line || range.anchor.ch !== range.head.ch) {
            debouncedPushEvent("flipControl", {})
          } else {
            debouncedPushEvent("flipCommand", {})
          }
        }
      });


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
          })}

      })

      this.handleEvent("writeShell", (instruction) => {
        // Extract instruction details
        const { command: cmd, control: ctrl, args = [] } = instruction;

        // Get editor state
        const doc = shell.getDoc();
        const cursor = doc.getCursor();
        const token = shell.getTokenAt(cursor);
        const indentation = token?.state?.indented || 0;

        // Define an operations registry with unified handling
        const operations = {
          // Special operation for undo command
          undo: () => shell.undo(),

          // Standard command operation (adds a single line)
          command: (name, indentLevel) => {
            // Get current line and position
            const line = doc.getLine(cursor.line) || "";
            const pos = { line: cursor.line, ch: line.length };

            // Format with proper indentation and arguments
            const argStr = formatArgs(name, args);
            const text = `\n${"".repeat(indentLevel)}${name}${argStr}`;

            // Insert and highlight
            const insertPos = doc.replaceRange(text, pos);
            highlightRange(doc,
              { line: cursor.line + 1, ch: 0 },
              { line: cursor.line + 1, ch: text.length - 1 }
            );

            return insertPos;
          },

          // Control structure operation (wraps selected text)
          control: (name, indentLevel) => {
            // Get selection boundaries
            const from = doc.getCursor('from');
            const to = doc.getCursor('to');
            const selection = doc.getSelection();

            if (!selection) return null;

            // Format opening statement with proper indentation and arguments
            const argStr = formatArgs(name, args) || "1"; // Default to "1" if no args
            const prefix = `${" ".repeat(indentLevel)}${name}${argStr} do`;

            // Format selected content with proper indentation
            const baseIndent = " ".repeat(indentLevel);
            const innerIndent = " ".repeat(indentLevel + 2); // Double space for inner content
            const formattedContent = selection.split('\n')
              .map(line => line.trim() ? `${innerIndent}${line.trim()}` : line)
              .join('\n');

            // Format closing statement
            const suffix = `\n${baseIndent}end`;

            // Build and insert the full structure
            const text = `${prefix}\n${formattedContent}${suffix}`;
            doc.replaceRange(text, from, to);

            // Highlight the entire insertion
            highlightRange(doc, from, {
              line: doc.posFromIndex(doc.indexFromPos(from) + text.length).line,
              ch: doc.posFromIndex(doc.indexFromPos(from) + text.length).ch
            });

            return { from, to };
          }
        };

        // Utility functions
        const formatArgs = (name, argList) => {
          if (!argList || argList.length === 0) return "";

          return argList.reduce((acc, arg) => {
            const paramId = `cmdparam-${name}-${arg}`;
            const element = document.getElementById(paramId);
            if (!element) return acc;

            const value = element.value || element.defaulted || "";
            return `${acc} ${value}`;
          }, "");
        };

        const highlightRange = (docRef, from, to) => {
          try {
            const marker = docRef.markText(from, to, { className: 'flash-highlight' });
            setTimeout(() => marker.clear(), 1500);
          } catch (error) {
            console.warn("Highlighting failed:", error);
          }
        };

        try {
          // Determine which operation to perform based on instruction type
          if (cmd === "undo") {
            operations.undo();
          } else if (cmd) {
            operations.command(cmd, indentation + 1);
          } else if (ctrl) {
            operations.control(ctrl, indentation);
          }
        } catch (error) {
          console.error("Operation failed:", error);
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

function debounceIdem(fn, delay) {
  let timer;
  let lastArgs = null;

  return (...args) => {
    // Convert args to a string for comparison
    const argsKey = JSON.stringify(args);

    // If args are identical to last call, don't reset the timer
    if (lastArgs === argsKey) {
      return;
    }

    // Store the new args
    lastArgs = argsKey;

    // Clear previous timer and set a new one
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, delay);
  };
};


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
