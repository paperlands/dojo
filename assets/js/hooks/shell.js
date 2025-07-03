import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import {printAST, parseProgram } from "../turtling/parse.js"
import {terminalBridge, seaBridge, cameraBridge} from "../bridged.js"
import { computePosition, offset, inline, autoUpdate } from "../../vendor/floating-ui.dom.umd.min";


Shell = {
    mounted() {
      // on init find the triumvirate
      const canvas = document.getElementById('canvas');
      const output = document.getElementById('output');
      // const world = new World(canvas);
      const turtle = new Turtle(canvas);
      const debouncedRunCode = debounce(this.run, 30);

    const debouncedPushEvent = debounceIdem((eventName, eventData) => {
      // set up event listeners
        this.pushEvent(eventName, eventData);
      }, 180);


      terminalBridge.sub((val) =>
        debouncedRunCode(val, canvas, turtle)
      )
      const shell = new Terminal(this.el, CodeMirror)



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


      function handleShellTheme(theme) {
        switch(theme) {
        case "light":
          shell.setOption('theme', "everforest")
          // code block
          break;
        case "dark":
          shell.setOption('theme', "abbott")

          // code block
          break;
        default:
          shell.setOption('theme', "everforest")
          // code block
        }
      }

      // check theme
      new MutationObserver(() => handleShellTheme(document.documentElement.getAttribute('data-theme')))
        .observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});

      handleShellTheme(document.documentElement.getAttribute('data-theme')); //


      this.handleEvent("writeShell", (instruction) => {
        // Extract instruction details
        const { command: cmd, control: ctrl, args = [] } = instruction;

        try {
          // Determine which operation to perform based on instruction type
          if (cmd === "undo") {
            shell.run({ command: "undo"})
          } else if (cmd) {
            shell.run({ command: cmd, args: args, batch: false})
          } else if (ctrl) {
            shell.run({ control: ctrl,  args: args })
          }
        } catch (error) {
          console.error("Operation failed:", error);
        }
      });

      this.handleEvent("mutateShell", (instruction) => {
        const cmd = instruction["command"];
        const args = instruction["args"];

        switch (cmd) {
        case "undo":
          shell.run({ command: "undo"})
          break;
        default:
          shell.run({ command: cmd, args: args})
        }

      });

      // seabridge dispatcher babyy
      seaBridge.sub((payload) =>
        this.pushEvent(payload[0], payload[1])
      )


      // start listening



      document.addEventListener('keydown', e => {

        if(!e.ctrlKey && !e.metaKey && (e.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(event.key)) && !['INPUT', 'TEXTAREA','SELECT', 'BUTTON'].includes(document.activeElement?.tagName)
           && !shell.hasFocus()) {
          shell.focus();
          const lastLine = shell.lastLine();
          shell.setCursor(lastLine, shell.getLine(lastLine).length);
          shell.scrollIntoView(null, 50);
        }
      })

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
        }, 2000);
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

      // call world send parsed
      // camera goes to world
      // pass render context
      //

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


export default Shell;
