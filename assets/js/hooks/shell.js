import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import {cameraBridge} from "../bridged.js"
import { computePosition, offset, inline, autoUpdate } from "../../vendor/floating-ui.dom.umd.min";
import { temporal } from "../utils/temporal.js"


const commands = {
    // Canvas commands
    render: (turtle) => (code) => {
        return turtle.draw(code);
    },

    // Shell commands
    execute: (term) => ({ command, control, args = [] }) => {
        try {
            if (command === "undo") {
                term.shell.run({ command: "undo" });
            } else if (command) {
                term.shell.run({ command, args, batch: false });
            } else if (control) {
                term.shell.run({ control, args });
            }
        } catch (error) {
            console.error("Shell execution failed:", error);
        }
    },

    // Camera commands
    camera: (bridge) => (command, payload={}) => {
        const actions = {
            'center_camera': () => bridge.pub(["recenter", payload]),
            'snap_record': () => bridge.pub(["snap", payload]),
            'start_record': () => bridge.pub(["record", payload]),
            'end_record': () => bridge.pub(["endrecord", payload])
        };
        actions[command]?.();
    },

  // File operations
  saveImage: () => async (url, title) => {
    const filename = prompt('Enter filename:', title) || title;
    if (!filename) return;

    const finalName = filename.endsWith('.png') ? filename : `${filename}.png`;

    try {
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: finalName
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error('Canvas save failed:', error);
    }
  }
};

// =============================================================================
// LISTENERS (Input Detection)
// =============================================================================

const listeners = {
  // Keyboard listener
  keyboard: (shell) => {
    const shouldCapture = (e) =>
      !e.ctr1lKey && !e.metaKey &&
      (e.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(e.key)) &&
      !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName) &&
      !shell.hasFocus();

    return {
      mount: () => {
        const handler = (e) => {
          if (shouldCapture(e)) {
            shell.focus();
            const lastLine = shell.lastLine();
            shell.setCursor(lastLine, shell.getLine(lastLine).length);
            shell.scrollIntoView(null, 50);
          }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
      }
    };
  },

  // Selection listener
  selection: (shell, pushEvent) => {
    const debouncedPush = temporal.debounce(
      (eventName, eventData) => pushEvent(eventName, eventData),
      180
    );

    return {
      mount: () => {
        let hadSelection = false; // Moved outside handler to persist

        const handler = (cm, changeObj) => {
          if (changeObj.ranges.length !== 1) return;

          const range = changeObj.ranges[0];
          const hasSelection = range.anchor.line !== range.head.line ||
                range.anchor.ch !== range.head.ch;

          if (hadSelection && !hasSelection) {
            // Had selection flip to command
            document.querySelector('.command-keyselector').click()

          } else if (!hadSelection && hasSelection) {
            // Didn't have selection flip to control
            document.querySelector('.control-keyselector').click()
          }

          hadSelection = hasSelection;
        };

        shell.on('beforeSelectionChange', handler);
        return () => shell.off('beforeSelectionChange', handler);
      }
    };
  },

  // Theme listener
  theme: (callback) => ({
    mount: () => {
      const handler = () => {
        const theme = document.documentElement.getAttribute('data-theme');
        callback(theme === 'dark' ? 'abbott' : 'everforest');
      };

      const observer = new MutationObserver(handler);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      });

      handler(); // Initial call
      return () => observer.disconnect();
    }
  }),

  // Resize Listener
  resizer: (callback) => ({
    mount: (canvas) => {
      const observer = new ResizeObserver(callback);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
  }),

  // Slider Listener
   slider: (shell, slider) => {


    return {
      mount: () => {
        const handler = (cm, event) => {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount <= 0) return slider.hide();

          const pos = cm.coordsChar({ left: event.clientX, top: event.clientY });
          const line = cm.getLine(pos.line);
          let token = cm.getTokenAt(pos);

          if (token.type == null) {
            pos.ch += 1;
            token = cm.getTokenAt(pos);
          }

          if (/[+-]?\d*\.\d+|[+-]?\d+/g.test(token.string)) {
            slider.show(cm, pos, line, token.string, event);
          } else {
            slider.hide();
          }
        }

        shell.on('dblclick', handler);
        return () => shell.off('dblclick', handler);
      }
    };
  },


};

// =============================================================================
// MUTATORS (Output Actions)
// =============================================================================

const mutators = {
  // Display mutator
  display: (element) => ({
      success: (count) => {
          element.style.color = "#FF9933";
          element.innerHTML = `${count}`
      },
    error: (message) => {
        element.style.color = "#FF0000";
      element.innerHTML = `Error: ${message}`
    }
  }),

  // Slider mutator
  slider: (sliderId) => {
    const element = document.getElementById(sliderId);
    let hideTimer, observer;

    const hide = () => {
      element.classList.add('hidden');
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const resetHideTimer = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 2000);
    };

    return {
      mount: () => {
        element.addEventListener('mouseover', () => clearTimeout(hideTimer));
        element.addEventListener('mouseleave', resetHideTimer);
        return hide;
      },

      show: (cm, pos, line, token, event) => {
        element.classList.remove('hidden');

        // Position slider
        const selection = window.getSelection();
        const rect = selection.getRangeAt(0).getBoundingClientRect();

        computePosition(event.target, element, {
          placement: 'top-end',
          middleware: [offset(5)]
        }).then(({x, y}) => {
          Object.assign(element.style, { left: `${rect.x}px`, top: `${y}px` });
        });

        // Setup value observer
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
          const sliderValue = Math.round(7.2 * (mutations[0].target.getAttribute('slideval') - 50));

          const parts = line.split(/(\S+|\s+)/g);
          let charCount = 0;

          for (let i = 0; i < parts.length; i++) {
            charCount += parts[i].length;
            if (charCount >= pos.ch && parts[i].includes(token)) {
              parts[i] = sliderValue.toString();
              break;
            }
          }

          cm.replaceRange(parts.join(''),
            { line: pos.line, ch: 0 },
            { line: pos.line, ch: 100 }
          );
        });

        observer.observe(element, {
          subtree: true,
          childList: true,
          attributeFilter: ['slideval']
        });

        resetHideTimer();
      },

      hide
    };
  }
};


const Shell = {
  mounted() {
    // Initialize domain objects
    const shellTarget = this.el.dataset.target
    console.log(shellTarget)
    const canvas = document.getElementById( shellTarget && shellTarget + "-canvas" || 'core-canvas');
    const output = document.getElementById(shellTarget && shellTarget + "-output" || 'core-output');
    const turtle = new Turtle(canvas);
    const term = new Terminal(this.el, CodeMirror);

    // Create command handlers
    const renderCommand = commands.render(turtle);
    const executeCommand = commands.execute(term);
    const cameraCommand = commands.camera(cameraBridge);
    const saveImage = commands.saveImage();

    // Create mutators
    const display = mutators.display(output);
    const slider = mutators.slider('slider');


    // Setup rendering pipeline
    const debouncedRender = temporal.debounce((code) => {

      const result = renderCommand(code);
      result.success ? display.success(result.commandCount) : display.error(result.error);
      // recenter camera to reset view upon tab change
      //cameraBridge.pub(["recenter", {}])
    }, 20);

    // Connect bridges
    term.bridge.sub(debouncedRender);

    const debouncedPushUp = temporal.throttle(
      (eventName, eventData) => this.pushEvent(eventName, eventData),
      200
    );

    // differences shell behaviour
    if(shellTarget=="outer"){
      this.handleEvent("seeOuterShell", (payload) => {
          term.changeouter(payload) 
      });
       term.outer()
    } else {
      turtle.bridge.sub(([event, payload]) =>{
        switch(event) {
        case "saveRecord":
          saveImage(payload.snapshot, payload.title)
          break;
        default:
          debouncedPushUp(event, payload)
        }
      });
      term.inner()
    }

    // Mount listeners and store cleanup functions
    this.cleanup = [
      listeners.keyboard(term.shell).mount(),
      listeners.selection(term.shell, this.pushEvent.bind(this)).mount(),
        listeners.theme(theme => {
          term.setOption('theme', theme)
        }
      ).mount(),
      //listeners.resizer(resize => term.triggerBridge()).mount(canvas),
      //slider is mutated and also is activate by a listener
      slider.mount(),
      listeners.slider(term.shell, slider).mount()
    ];


    // Setup LiveView event handlers
    this.handleEvent("relayCamera", ({ command }) => cameraCommand(command));
    this.handleEvent("selfkeepCanvas", ({ title }) => cameraCommand("snap_record", {title: title}));
    this.handleEvent("writeShell", executeCommand);
    this.handleEvent("opBuffer", (event) => term.opBufferHandler(event));






  },

  destroyed() {
    this.cleanup?.forEach(fn => fn());
  }
};

export default Shell;
