// =============================================================================
// SHELL CORE — the substrate the two shell surfaces (coreshell, outershell)
// are both built over. It owns:
//   1. the CM6 module loader + Terminal construction (bootShell),
//   2. the shell's behavioral kit (commands / listeners / mutators) — the
//      shared vocabulary each surface uses the subset it needs.
// Terminal identity registers directly against term-cell.js by role
// (id:gw-t-dom-registry) — no wiring door here.
// Named adapters (scene, signals, cameraBridge) do NOT live here — they travel
// whole from their canonical modules into whichever surface calls them.
// =============================================================================

import { Terminal } from "../../terminal.js"
import { computePosition, offset } from "../../../vendor/floating-ui.dom.umd.min";
import { temporal } from "../../utils/temporal.js"
import { outerDrafting } from "./term-cell.js"

// Module-level CM6 cache — loaded once on first Shell mount, reused thereafter.
// The browser also caches the ES module natively by URL.
let cm6 = null;

// ---------------------------------------------------------------------------
// bootShell — the shared preamble every surface shares: load CM6 once,
// construct the Terminal over the hook element, hang it off the hook for the
// destroyed() teardown. Returns the { term, cm6 } the surface builds on.
// ---------------------------------------------------------------------------
export async function bootShell(hook) {
    // ?v= must equal "version" in priv/static/vendor/cm6.manifest.json, which the
    // build derives from the resolved package. scripts/vendor_verify.sh checks it.
    if (!cm6) cm6 = await import('/vendor/cm6.js?v=6.43.6-ee4bbbe8');
    // The import is the one real await — if the hook died while we were away
    // (panel closed mid-boot), stand down: no Terminal on a detached element.
    // The lifecycle machine sees null and never mounts the surface.
    if (hook.dead) return null;
    const term = new Terminal(hook.el, cm6);
    hook.term = term;
    return { term, cm6 };
}

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

export const commands = {
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
            }).filter(v => v !== '?');

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

export const listeners = {

    // Keyboard capture: redirect stray keystrokes into the editor.
    // shell is an EditorView; hasFocus is a getter not a method in CM6.
    keyboard: (shell, cm6) => {
        const { EditorView } = cm6;

        const shouldCapture = (e) =>
            !e.ctrlKey && !e.metaKey &&
            (e.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(e.key)) &&
            !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName) &&
            // Don't steal focus when ANY CM6 editor is focused — the outer review
            // surface is a contenteditable DIV, so the tagName check misses it.
            // Typing in the editable outershell must stay there, not jump to core.
            !document.activeElement?.closest?.('.cm-editor') &&
            // Hard stop while the outershell is being drafted: even if a re-render
            // momentarily blurs the outer editor to <body>, the next keystroke
            // must not jump to the core editor. The outer Terminal owns this fact
            // (state.drafting) — the term cell, not a dunder walk.
            !outerDrafting() &&
            !shell.hasFocus &&
            !shell.state.readOnly;

        return {
            mount: () => {
                const handler = (e) => {
                    if (shouldCapture(e)) {
                        shell.focus();
                        // The cursor is already attention's last word — CM6
                        // selection doesn't move on blur, and every move writes
                        // through to the buffer's attend (terminal.js). Redirect
                        // focus back to it, not to the document's end.
                        const head = shell.state.selection.main.head;
                        shell.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'nearest' }) });
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
        const pacedPush = temporal.pace(
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
    // The one listener both surfaces share.
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

export const mutators = {
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
