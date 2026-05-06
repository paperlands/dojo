import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import { cameraBridge } from "../bridged.js"
import { computePosition, offset } from "../../vendor/floating-ui.dom.umd.min";
import { temporal } from "../utils/temporal.js"

// Module-level CM6 cache — loaded once on first Shell mount, reused thereafter.
// The browser also caches the ES module natively by URL.
let cm6 = null;

// ---------------------------------------------------------------------------
// Numeric token finder — replaces CM5 getTokenAt for the slider feature.
// Scans the line text for a number at/near the given character position.
// ---------------------------------------------------------------------------
const findNumericTokenAt = (line, ch) => {
    const numRegex = /[+-]?\d*\.\d+|[+-]?\d+/g;
    let match;
    while ((match = numRegex.exec(line)) !== null) {
        if (match.index <= ch && ch <= match.index + match[0].length) {
            return match[0];
        }
    }
    return null;
};

// =============================================================================
// COMMANDS (pure functions, return bound handlers)
// =============================================================================

const commands = {
    render: (turtle) => (code) => turtle.draw(code),

    // Dispatch instructions through Terminal.run() — not via term.shell.run()
    // since EditorView cannot be monkey-patched with custom methods.
    // DOM parameter resolution lives here — operations.js stays pure.
    execute: (term) => ({ command, control, args = [] }) => {
        try {
            const cmd = command || control;
            const resolvedArgs = args.map(arg => {
                if (typeof arg === 'number') return arg;
                const el = document.getElementById(`cmdparam-${cmd}-${arg}`);
                return el?.value || el?.defaulted || arg || "";
            });

            if (command === "undo") {
                term.run({ command: "undo" });
            } else if (command) {
                term.run({ command, args: resolvedArgs, batch: false });
            } else if (control) {
                term.run({ control, args: resolvedArgs });
            }
        } catch (error) {
            console.error("Shell execution failed:", error);
        }
    },

    camera: (bridge) => (command, payload = {}) => bridge.pub([command, payload]),

    saveImage: () => async (url, title) => {
        const filename = prompt('Enter filename:', title) || title;
        if (!filename) return;
        const finalName = filename.endsWith('.png') ? filename : `${filename}.png`;
        try {
            const link = Object.assign(document.createElement('a'), { href: url, download: finalName });
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Canvas save failed:', error);
        }
    },

    saveRecording: () => async (blob, _ext, title = "myPaperLand Movie") => {
        if (!blob) { console.warn('No recording available to save'); return; }
        const filename = prompt('Enter filename:', title) || title;
        if (!filename) return;
        try {
            const url = URL.createObjectURL(blob);
            const link = Object.assign(document.createElement('a'), { href: url, download: filename });
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
        } catch (error) {
            console.error('Recording save failed:', error);
        }
    }
};

// =============================================================================
// LISTENERS (input detection, return { mount() → unsub fn })
// =============================================================================

const listeners = {

    // Keyboard capture: redirect stray keystrokes into the editor.
    // shell is an EditorView; hasFocus is a getter not a method in CM6.
    keyboard: (shell, cm6) => {
        const { EditorView, EditorSelection } = cm6;

        const shouldCapture = (e) =>
            !e.ctrlKey && !e.metaKey &&
            (e.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(e.key)) &&
            !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName) &&
            !shell.hasFocus &&
            !shell.state.readOnly; // outer shell is read-only — don't capture

        return {
            mount: () => {
                const handler = (e) => {
                    if (shouldCapture(e)) {
                        shell.focus();
                        const doc = shell.state.doc;
                        const lastLine = doc.line(doc.lines);
                        shell.dispatch({
                            selection: EditorSelection.cursor(lastLine.to),
                            effects: EditorView.scrollIntoView(lastLine.to, { y: 'end' }),
                        });
                    }
                };
                document.addEventListener('keydown', handler);
                return () => document.removeEventListener('keydown', handler);
            }
        };
    },

    // Selection listener: subscribes to Terminal's selectionBridge rather than
    // shell.on('beforeSelectionChange'). The bridge is fired from the
    // updateListener extension in terminal.js#buildExtensions().
    // selectionBridge.sub() returns the unsub function directly.
    selection: (selectionBridge, pushEvent) => {
        const debouncedPush = temporal.debounce(
            (eventName, eventData) => pushEvent(eventName, eventData),
            180
        );

        return {
            mount: () => {
                let hadSelection = false;

                // CM6 EditorSelection: ranges[0].from !== ranges[0].to means selection exists
                const handler = (selection) => {
                    if (!selection || selection.ranges.length !== 1) return;

                    const range = selection.ranges[0];
                    const hasSelection = range.from !== range.to;

                    if (hadSelection && !hasSelection) {
                        document.querySelector('.command-keyselector')?.click();
                    } else if (!hadSelection && hasSelection) {
                        document.querySelector('.control-keyselector')?.click();
                    }

                    hadSelection = hasSelection;
                };

                // sub() returns the unsub function
                return selectionBridge.sub(handler);
            }
        };
    },

    // Theme listener: watches data-theme attribute — no CM6 dependency.
    theme: (callback) => ({
        mount: () => {
            const handler = () => {
                const theme = document.documentElement.getAttribute('data-theme');
                callback(theme === 'dark' ? 'abbott' : 'everforest');
            };
            const observer = new MutationObserver(handler);
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
            handler();
            return () => observer.disconnect();
        }
    }),

    resizer: (callback) => ({
        mount: (canvas) => {
            const observer = new ResizeObserver(callback);
            observer.observe(canvas);
            return () => observer.disconnect();
        }
    }),

    // Slider: double-click a number token to reveal the scrub slider.
    // CM5 used shell.on('dblclick', (cm, event) => ...).
    // CM6: attach to the EditorView's DOM element directly.
    slider: (shell, slider, cm6) => {
        return {
            mount: () => {
                const handler = (event) => {
                    const selection = window.getSelection();
                    if (!selection || selection.rangeCount <= 0) return slider.hide();

                    // posAtCoords returns an integer offset or null
                    const offset = shell.posAtCoords({ x: event.clientX, y: event.clientY });
                    if (offset === null) return slider.hide();

                    const lineInfo = shell.state.doc.lineAt(offset);
                    const line     = lineInfo.text;
                    const ch       = offset - lineInfo.from;

                    const token = findNumericTokenAt(line, ch) || findNumericTokenAt(line, ch + 1);

                    if (token) {
                        slider.show(shell, { lineOffset: lineInfo.from, ch }, line, token, event);
                    } else {
                        slider.hide();
                    }
                };

                shell.dom.addEventListener('dblclick', handler);
                return () => shell.dom.removeEventListener('dblclick', handler);
            }
        };
    },
};

// =============================================================================
// MUTATORS (output/side-effect actions)
// =============================================================================

const mutators = {
    display: (element) => ({
        success: (count) => {
            element.style.color = "#FF9933";
            element.innerHTML = `${count}`;
        },
        error: (message) => {
            element.style.color = "#FF0000";
            element.innerHTML = `Error: ${message}`;
        }
    }),

    slider: (sliderId) => {
        const element = document.getElementById(sliderId);
        let hideTimer, observer;

        const hide = () => {
            element.classList.add('hidden');
            if (observer) { observer.disconnect(); observer = null; }
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

            // view: EditorView; pos: { lineOffset, ch }; line: full line text
            show: (view, pos, line, token, event) => {
                element.classList.remove('hidden');

                const selection = window.getSelection();
                const rect = selection.getRangeAt(0).getBoundingClientRect();

                computePosition(event.target, element, {
                    placement: 'top-end',
                    middleware: [offset(5)]
                }).then(({ x, y }) => {
                    Object.assign(element.style, { left: `${rect.x}px`, top: `${y}px` });
                });

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

                    // CM6: dispatch change using the stored line offset
                    const lineEnd = Math.min(pos.lineOffset + 100, pos.lineOffset + line.length);
                    view.dispatch({
                        changes: { from: pos.lineOffset, to: lineEnd, insert: parts.join('') }
                    });
                });

                observer.observe(element, {
                    subtree: true, childList: true, attributeFilter: ['slideval']
                });

                resetHideTimer();
            },

            hide,
        };
    }
};

// =============================================================================
// SHELL HOOK
// =============================================================================

const Shell = {
    async mounted() {
        // Load CM6 once; subsequent mounts reuse the cached module.
        // Version string must match the built artifact in priv/static/vendor/.
        if (!cm6) cm6 = await import('/vendor/cm6.js?v=6.36');

        const shellTarget = this.el.dataset.target;
        const canvas  = document.getElementById(shellTarget && shellTarget + "-canvas" || 'core-canvas');
        const output  = document.getElementById(shellTarget && shellTarget + "-output" || 'core-output');
        const turtle  = new Turtle(canvas);
        const term    = new Terminal(this.el, cm6);

        const renderCommand   = commands.render(turtle);
        const executeCommand  = commands.execute(term);
        const cameraCommand   = commands.camera(cameraBridge);
        const saveImage       = commands.saveImage();
        const saveRecording   = commands.saveRecording();

        const display = mutators.display(output);
        const slider  = mutators.slider('slider');

        const debouncedRender = temporal.debounce((code) => {
            const result = renderCommand(code);
            result.success ? display.success(result.commandCount) : display.error(result.error);
        }, 20);

        term.bridge.sub(debouncedRender);

        const debouncedPushUp = temporal.throttle(
            (eventName, eventData) => this.pushEvent(eventName, eventData),
            200
        );

        if (shellTarget === "outer") {
            this.handleEvent("seeOuterShell", (payload) => term.changeouter(payload));
            term.outer();
            // Outer shell: read-only view — only theme toggling is needed.
            this.cleanup = [
                listeners.theme(theme => term.setOption('theme', theme)).mount(),
            ];
        } else {
            turtle.bridge.sub(([event, payload]) => {
                switch (event) {
                case "saveRecord":
                    if (payload.type === "video") saveRecording(payload.snapshot);
                    if (payload.type === "image") saveImage(payload.snapshot);
                    break;
                default:
                    debouncedPushUp(event, payload);
                }
            });
            term.inner();

            // Mobile char toolbar — insert character or run indentWithTab at cursor.
            const insertCharHandler = (e) => {
                const { char } = e.detail;
                if (!char || !term.shell) return;
                if (char === 'tab') {
                    cm6.indentWithTab.run(term.shell);
                } else {
                    const view = term.shell;
                    const changes = view.state.selection.ranges.map(r => ({
                        from: r.from, to: r.to, insert: char,
                    }));
                    view.dispatch({ changes, scrollIntoView: true });
                }
                term.shell.focus();
            };
            window.addEventListener('phx:insertChar', insertCharHandler);

            this.cleanup = [
                listeners.keyboard(term.shell, cm6).mount(),
                // selection listener subscribes to the bridge, not shell.on()
                listeners.selection(term.selectionBridge, this.pushEvent.bind(this)).mount(),
                listeners.theme(theme => term.setOption('theme', theme)).mount(),
                slider.mount(),
                listeners.slider(term.shell, slider, cm6).mount(),
                () => window.removeEventListener('phx:insertChar', insertCharHandler),
            ];
        }

        this.handleEvent("relayCamera",      ({ command }) => cameraCommand(command));
        this.handleEvent("selfkeepCanvas",   ({ title })   => cameraCommand("snap", { title }));
        this.handleEvent("writeShell",       executeCommand);
        this.handleEvent("opBuffer",         (event)       => term.opBufferHandler(event));
    },

    destroyed() {
        this.cleanup?.forEach(fn => fn());
    }
};

export default Shell;
