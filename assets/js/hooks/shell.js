import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import { cameraBridge } from "../bridged.js"
import { computePosition, offset } from "../../vendor/floating-ui.dom.umd.min";
import { temporal } from "../utils/temporal.js"
import {printAST} from "../turtling/parse.js"

// Module-level CM6 cache — loaded once on first Shell mount, reused thereafter.
// The browser also caches the ES module natively by URL.
let cm6 = null;

// Module-level core turtle reference — set by inner shell, used by outer shell
// for guest rendering into the same scene via path groups.
let coreTurtle = null;

// Module-level inner terminal reference — set by inner shell, used by outer shell
// for forking buffers and updating merge originals.
let innerTerminal = null;

// ---------------------------------------------------------------------------
// Numeric token finder — replaces CM5 getTokenAt for the slider feature.
// Scans the line text for a number at/near the given character position.
// ---------------------------------------------------------------------------
const findNumericTokenAt = (line, ch) => {
    const numRegex = /[+-]?\d*\.\d+|[+-]?\d+/g;
    let match;
    while ((match = numRegex.exec(line)) !== null) {
        if (match.index <= ch && ch <= match.index + match[0].length) {
            return { text: match[0], index: match.index };
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

                    const result = findNumericTokenAt(line, ch) || findNumericTokenAt(line, ch + 1);

                    if (result) {
                        slider.show(shell, { lineOffset: lineInfo.from, tokenStart: result.index }, result.text, event);
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

            // view: EditorView; pos: { lineOffset, tokenStart }; token: matched number string
            show: (view, pos, token, event) => {
                element.classList.remove('hidden');

                const selection = window.getSelection();
                const rect = selection.getRangeAt(0).getBoundingClientRect();

                computePosition(event.target, element, {
                    placement: 'top-end',
                    middleware: [offset(5)]
                }).then(({ x, y }) => {
                    Object.assign(element.style, { left: `${rect.x}px`, top: `${y}px` });
                });

                // Absolute document offsets for the target token only
                let tokenFrom = pos.lineOffset + pos.tokenStart;
                let tokenTo = tokenFrom + token.length;

                if (observer) observer.disconnect();
                observer = new MutationObserver((mutations) => {
                    const sliderValue = Math.round(7.2 * (mutations[0].target.getAttribute('slideval') - 50));
                    const newText = sliderValue.toString();

                    view.dispatch({
                        changes: { from: tokenFrom, to: tokenTo, insert: newText }
                    });

                    // Update range — replacement length may differ from original
                    tokenTo = tokenFrom + newText.length;
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
        const term = new Terminal(this.el, cm6);

        if (shellTarget === "outer") {
            // Outer shell: read-only code viewer. Rendering goes through
            // the core turtle's guest path groups — no second canvas.
            const output = document.getElementById('outer-output');
            const display = mutators.display(output);

            // Outershell metadata — captured from seeOuterShell payloads for client-side forking
            let outerAddr = null;
            let outerName = null;
            let outerFocused = true;  // outershell starts focused when first opened

            const debouncedGuestRender = temporal.debounce((code) => {
                if (!coreTurtle) return;
                const result = coreTurtle.drawGuest(code);
                if (result.success) {
                    coreTurtle.setGuestOpacity(outerFocused ? 1.0 : 0.4);
                    coreTurtle.requestRender();
                    display.success(result.commandCount);
                } else {
                    display.error(result.error);
                }
            }, 20);

            term.outer();

            // Fork-on-type: typing into the read-only outershell forks the buffer
            // into the inner shell. Click gives focus, keystroke confirms intent.
            const forkOnType = (e) => {
                if (!innerTerminal) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key.length > 1 && !['Enter', 'Backspace', 'Delete', 'Tab', ' '].includes(e.key)) return;

                const source = term.getValue();
                if (!source || !outerAddr) return;

                innerTerminal.forkBuffer({
                    source,
                    name: outerName || 'friend',
                    addr: outerAddr,
                    time: Date.now(),
                });

                // Focus inner shell — ambient swap happens via onOuterBlur
                innerTerminal.shell?.focus();

                // Disarm: fork triggers once per disciple session
                term.shell.dom.removeEventListener('keydown', forkOnType);
            };

            term.shell.dom.addEventListener('keydown', forkOnType);

            this.handleEvent("seeOuterShell", (payload) => {
                // Re-arm fork trigger when switching to a different disciple
                if (payload?.addr && payload.addr !== outerAddr) {
                    term.shell?.dom.addEventListener('keydown', forkOnType);
                    // New disciple → outershell takes focus
                    activateOuter();
                }

                // Capture outershell metadata for fork provenance
                if (payload?.addr) outerAddr = payload.addr;
                if (payload?.origin_name) outerName = payload.origin_name;

                if (payload?.state === "success" && payload?.commands) {
                    const code = printAST(payload.commands);
                    term.changeouter(code);
                    debouncedGuestRender(code);
                    // Update merge original in inner shell for live diff tracking
                    if (innerTerminal && outerAddr) {
                        innerTerminal.updateMergeOriginal(code, outerAddr);
                    }
                } else {
                    // Peek: show raw broken source, don't render
                    term.changeouter(payload?.source ?? '');
                    if (payload?.message) display.error(payload.message);
                }
            });

            // Ambient focus: clicking anywhere in the outershell swaps the dominant
            // visual layer. Guest becomes foreground (opacity 1.0, camera routed),
            // host fades to trace. Global focusin restores host when focus moves
            // outside the outershell (click inner shell, tab away, etc).
            // requestRender() is critical — the render loop may have stopped after
            // all compositors finished, so opacity changes need an explicit kick.
            const outerEl = this.el.closest('.outershell') || this.el;

            const activateOuter = () => {
                outerFocused = true;
                if (!coreTurtle) return;
                coreTurtle.focusAmbient('guest');
                coreTurtle.setAmbientOpacity('guest', 1.0);
                coreTurtle.setAmbientOpacity('default', 0.3);
                coreTurtle.requestRender();
            };

            const restoreInner = () => {
                outerFocused = false;
                if (!coreTurtle) return;
                coreTurtle.focusAmbient('default');
                coreTurtle.setAmbientOpacity('default', 1.0);
                coreTurtle.setGuestOpacity(0.4);
                coreTurtle.requestRender();
            };

            const onOuterClick = () => activateOuter();

            const onGlobalFocus = (e) => {
                if (!outerEl.contains(e.target)) restoreInner();
            };

            outerEl.addEventListener('mousedown', onOuterClick);
            document.addEventListener('focusin', onGlobalFocus);

            this.cleanup = [
                listeners.theme(theme => term.setOption('theme', theme)).mount(),
                () => coreTurtle?.clearGuest(),
                () => term.shell?.dom.removeEventListener('keydown', forkOnType),
                () => { outerEl.removeEventListener('mousedown', onOuterClick);
                        document.removeEventListener('focusin', onGlobalFocus); },
                () => { innerTerminal?.clearMerge(); restoreInner(); },
            ];
        } else {
            const canvas = document.getElementById('core-canvas');
            const output = document.getElementById('core-output');
            const turtle = new Turtle(canvas);
            coreTurtle = turtle;
            innerTerminal = term;

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

            const debouncedHatch = temporal.debounce(
                (payload) => this.pushEvent("hatchTurtle", payload),
                200
            );

            turtle.bridge.sub(([event, payload]) => {
                switch (event) {
                case "saveRecord":
                    if (payload.type === "video") saveRecording(payload.snapshot);
                    if (payload.type === "image") saveImage(payload.snapshot);
                    break;
                case "hatchTurtle":
                    debouncedHatch(payload);
                    break;
                }
            });
            term.inner();

            // Eager hatch: re-push state on visibility change + jittered heartbeat
            let heartbeatTimer = null
            const HEARTBEAT_BASE = 10_000
            const HEARTBEAT_JITTER = 5_000

            const scheduleHeartbeat = () => {
                if (heartbeatTimer) return
                const delay = HEARTBEAT_BASE + Math.random() * HEARTBEAT_JITTER
                heartbeatTimer = setTimeout(() => {
                    heartbeatTimer = null
                    if (document.visibilityState === 'visible') {
                        turtle.eagerHatch()
                        scheduleHeartbeat()
                    }
                }, delay)
            }

            const stopHeartbeat = () => {
                clearTimeout(heartbeatTimer)
                heartbeatTimer = null
            }

            const onVisibilityChange = () => {
                if (document.visibilityState === 'visible') {
                    turtle.eagerHatch()
                    scheduleHeartbeat()
                } else {
                    stopHeartbeat()
                }
            }

            document.addEventListener('visibilitychange', onVisibilityChange)
            scheduleHeartbeat()

            this.cleanup = [
                listeners.keyboard(term.shell, cm6).mount(),
                listeners.selection(term.selectionBridge, this.pushEvent.bind(this)).mount(),
                listeners.theme(theme => term.setOption('theme', theme)).mount(),
                slider.mount(),
                listeners.slider(term.shell, slider, cm6).mount(),
                () => document.removeEventListener('visibilitychange', onVisibilityChange),
                () => stopHeartbeat(),
                () => { innerTerminal = null; },
            ];

            this.handleEvent("relayCamera",      ({ command }) => cameraCommand(command));
            this.handleEvent("selfkeepCanvas",   ({ title })   => cameraCommand("snap", { title }));
            this.handleEvent("writeShell",       executeCommand);
            this.handleEvent("opBuffer",         (event)       => term.opBufferHandler(event));
            this.handleEvent("forkBuffer", (forkData) => term.forkBuffer(forkData));
        }
    },

    destroyed() {
        this.cleanup?.forEach(fn => fn());
        if (this.el.dataset.target !== "outer") {
            coreTurtle = null;
            innerTerminal = null;
        }
    }
};

export default Shell;
