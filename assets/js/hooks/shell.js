import { Turtle } from "../turtling/turtle.js"
import { Terminal } from "../terminal.js"
import { cameraBridge, sceneBridge, scene } from "../bridged.js"
import { computePosition, offset } from "../../vendor/floating-ui.dom.umd.min";
import { temporal } from "../utils/temporal.js"
import {printAST} from "../turtling/parse.js"
import { nerveInstance } from "./nerve.js"
import { signals as S } from "../nerve/store.js"

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
            return { text: match[0], index: match.index };
        }
    }
    return null;
};

// =============================================================================
// COMMANDS (pure functions, return bound handlers)
// =============================================================================

const commands = {
    render: (turtle) => (id, name, code) => turtle.draw(id, name, code),

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

const listeners = {

    // Keyboard capture: redirect stray keystrokes into the editor.
    // shell is an EditorView; hasFocus is a getter not a method in CM6.
    keyboard: (shell, cm6) => {
        const { EditorView, EditorSelection } = cm6;

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
            // (state.drafting) — query it directly, no shadow global flag.
            !document.getElementById('outershell')?.__terminal?.drafting() &&
            !shell.hasFocus &&
            !shell.state.readOnly;

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
        this.term = term;

        if (shellTarget === "outer") {
            // Outer shell: read-only code viewer + bridge publisher.
            // Rendering is handled by the inner shell via seeOuterShell.
            // Interactive events (focus, remove, fork) go through scene bridge.
            let outerAddr = null;
            let outerName = null;
            let outerBufferId = null;
            let prevAddr = null;
            let prevName = null;

            term.outer();
            this.el.__cm = term.shell;
            this.el.__terminal = term;   // owner of `drafting()` — see the core focus guard
            const envEl = this.el.closest('#outerenv');

            // A claimant projection over the ONE shared nerve: while open, this
            // panel claims the watched friend's address (their name), so their
            // signals — ambient shouts AND server status — route here instead of
            // the local corner. Navigation targets the outer editor. The friend's
            // ambient shouts arrive via the core turtle's _onShout (source = their
            // name); no separate relay channel. retarget() follows disciple swaps.
            const remoteNerveEl = document.getElementById('outer-nerve');
            const outerProj = remoteNerveEl && nerveInstance
                ? nerveInstance.project(remoteNerveEl, {
                    pushEvent: (e, p) => this.pushEvent(e, p),
                    targets: { editorView: () => this.el.__cm },
                })
                : null;

            this.el.__scrollToCursor = () => {
                const shell = term.shell;
                if (!shell || !shell.hasFocus) return;
                const pos = shell.state.selection.main.head;
                shell.dispatch({ effects: cm6.EditorView.scrollIntoView(pos, { y: 'center' }) });
            };

            // While drafting, a body flag tells the core shell's global
            // "type-anywhere-to-focus" capture to stand down — so typing here
            // can never jump focus to the core editor, even if a re-render or
            // the merge view's async DOM briefly blurs us.
            // Live = your draft is running on the canvas (you've intervened);
            // frozen = you're only editing text against a snapshot.
            let draftLive = false;

            // Run the current draft as the friend's ambient on the canvas, so an
            // intervention on broken code actually executes. Their code keeps
            // streaming into the merge baseline (the diff reference) separately.
            const runDraft = () => {
                if (!outerAddr) return;
                scene.ambient(outerAddr, outerName || 'friend', term.getValue());
            };
            const stopDraftRun = () => {
                if (outerAddr) scene.ambientStop(outerAddr);
            };

            const enterDraft = () => {
                term.beginDraft({ addr: outerAddr, buffer_id: outerBufferId });
                if (envEl) envEl.dataset.outerState = 'draft';   // yellow wash (terminal-owned transition)
            };
            const leaveDraft = () => {
                stopDraftRun();
                draftLive = false;
                term.endDraft();
                if (envEl) envEl.dataset.outerState = 'ok';      // next seeOuterShell re-colors
            };

            // Type-to-draft: the first edit-intent keystroke turns the read-only
            // review surface editable. CAPTURE phase is essential — we flip
            // read-only off *before* CM6's own keydown/input handlers run, so
            // CM6 then applies this very keystroke natively (char, newline, tab,
            // delete — all of it). No preventDefault, no lossy manual replay.
            // Self-guards via term.drafting(): once drafting, CM6 owns the keys.
            const onDraftKey = (e) => {
                if (term.drafting()) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (!(e.key.length === 1 || ['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key))) return;
                if (!outerAddr) return;

                enterDraft();
                this.pushEvent("outerDraft", {});
            };
            term.shell.dom.addEventListener('keydown', onDraftKey, true);

            // Go live → run the draft; go frozen → stop running (revert to their code).
            this.handleEvent("outerLive", ({ live }) => {
                draftLive = !!live;
                if (draftLive) runDraft();
                else stopDraftRun();
            });

            // Re-run the draft as you edit it, but only while live.
            const runDraftDebounced = temporal.debounce(runDraft, 60);
            const draftEditUnsub = term.bridge.sub(() => {
                if (term.drafting() && draftLive) runDraftDebounced();
            });

            this.handleEvent("seeOuterShell", (payload) => {
                // Disciple switch: drop stale draft + ambient. Remove by the addr
                // the ambient was REGISTERED under (upsertAmbient keys on addr) —
                // passing the display name relied on a deleted name-scan fallback
                // and silently skipped the draft bookkeeping cleanup (which is
                // keyed by addr) in the inner shell's remove handler.
                if (payload?.addr && payload.addr !== prevAddr) {
                    if (prevAddr) scene.remove(prevAddr);
                    if (term.drafting()) leaveDraft();
                    prevAddr = payload.addr;
                }

                if (payload?.addr) outerAddr = payload.addr;
                if (payload?.origin_name) outerName = payload.origin_name;

                if (outerName && outerName !== prevName) {
                    scene.focus(outerName);
                    outerProj?.retarget(outerName);   // claim this friend's signals
                    prevName = outerName;
                }
                if (payload?.buffer_id) outerBufferId = payload.buffer_id;

                const view = payload?.view ?? 'watch';
                const errored = payload?.state === 'error';
                const source = (payload?.state === 'success' && payload?.commands)
                    ? printAST(payload.commands)
                    : (payload?.source ?? '');

                if (view === 'draft') {
                    // Live baseline: stream the friend's code into the merge original.
                    if (payload?.stream) term.streamOrigin(source);
                } else {
                    term.changeouter(source);
                }

                if (envEl) {
                    envEl.dataset.outerState = view === 'draft' ? 'draft' : (errored ? 'error' : 'ok');
                }
            });

            // Friend's execution status → the remote nerve below their code.
            // A separate event from seeOuterShell so it flows even in a frozen
            // draft, where the editor push is withheld.
            this.handleEvent("outerSignal", ({ state, message, name }) => {
                const who = name || 'friend';
                if (state === 'success') {
                    nerveInstance?.push(S.remote(who, '☀︎', null, 'output'));
                } else if (state === 'error' && message) {
                    nerveInstance?.push(S.remote(who, 'error', message, 'error'));
                }
            });

            // Keep-as-fork: deliberate promotion of the draft into a coreshell
            // tab (delegated — #outer-fork mounts/unmounts with the draft view).
            const outerEl = this.el.closest('.outershell') || this.el;
            const onDelegatedClick = (e) => {
                if (!e.target.closest('#outer-fork')) return;
                const source = term.getValue();
                if (!source || !outerAddr) return;
                scene.fork({
                    source,
                    name: outerName || 'friend',
                    addr: outerAddr,
                    buffer_id: outerBufferId,
                    time: Date.now(),
                    offset: term.shell?.state?.selection?.main?.head ?? 0,
                });
            };
            outerEl.addEventListener('click', onDelegatedClick);

            // Focus switching via scene bridge
            const activateOuter = () => {
                if (outerName) scene.focus(outerName);
            };

            const restoreInner = () => {
                scene.focus('world');
            };

            const onOuterClick = () => activateOuter();
            const onGlobalFocus = (e) => {
                if (!outerEl.contains(e.target)) restoreInner();
            };

            outerEl.addEventListener('mousedown', onOuterClick);
            document.addEventListener('focusin', onGlobalFocus);

            this.cleanup = [
                listeners.theme(theme => term.setOption('theme', theme)).mount(),
                // Authoritative teardown: drop this addr from the canvas entirely.
                // NOT stopDraftRun() — ambientStop *reverts* to the friend's code
                // (panel stays open); on close we want the slot gone. Firing it
                // here re-added the ambient milliseconds after removing it.
                () => { if (outerAddr) scene.remove(outerAddr); },
                () => term.shell?.dom.removeEventListener('keydown', onDraftKey, true),
                draftEditUnsub,
                () => outerProj?.destroy(),
                () => outerEl.removeEventListener('click', onDelegatedClick),
                () => { outerEl.removeEventListener('mousedown', onOuterClick);
                        document.removeEventListener('focusin', onGlobalFocus); },
            ];
        } else {
            // Inner shell: canvas, turtle, rendering, scene bridge subscription
            const canvas = document.getElementById('core-canvas');
            const turtle = new Turtle(canvas);
            canvas.__turtle = turtle;

            // Profiler overlay — opt-in via ?perf=1. Lazy-imported so it adds
            // zero cost to normal sessions. Reports RAF idle-spin + GPU growth.
            if (new URLSearchParams(location.search).has('perf')) {
                import('../turtling/profile/overlay.js')
                    .then(m => { this._profilerDetach = m.attachProfilerOverlay(turtle); })
                    .catch(err => console.warn('profiler overlay failed to load:', err));
            }

            // _onShout must precede term.bridge.sub which triggers first render.
            // Push every shout into the one store, addressed by its source. The
            // friend's ambient shouts (source = their name) route to the claiming
            // outershell panel; your own ambients fall to the local residual —
            // routing is a read-side concern, not decided here.
            turtle._onShout = (source, msg, payload) => {
                nerveInstance?.push(S.shout(source, msg, payload))
            }

            const renderCommand   = commands.render(turtle);
            const executeCommand  = commands.execute(term);
            const cameraCommand   = commands.camera(cameraBridge);
            const saveImage       = commands.saveImage();
            const saveRecording   = commands.saveRecording();

            const slider  = mutators.slider('slider');

            function parseErrorLine(message) {
                const m = message.match(/at line (\d+)/)
                return m ? parseInt(m[1], 10) : null
            }


            const debouncedRender = temporal.debounce(({ id, name, content }) => {
                nerveInstance?.run()
                const result = renderCommand(id, name, content);
                if (result.success) {
                    nerveInstance?.push(S.output("☀︎", result.commandCount))
                } else {
                    const line = parseErrorLine(result.error)
                    nerveInstance?.push(S.error("error", result.error, line ? { line } : null))
                }
                // Sync tab indicators: draw is exclusive for a tab outside the
                // active group, but a shift+click sister group survives edits
                // and re-selection of its members — mirror whatever stands.
                term.clearAllTabActive()
                for (const key of turtle._localKeys) {
                    term.setTabActive(key)
                }
            }, 20);

                term.bridge.sub(debouncedRender);

            const debouncedHatch = temporal.debounce(
                (payload) => this.pushEvent("hatchTurtle", {
                    ...payload,
                    buffer_id: term.currentBufferId(),
                }),
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
            // Expose CM6 view on the textarea so nerve hook can scrollToLine.
            // Expose the terminal so the outer review surface can read your
            // fork content along a lineage (forkContent) to seed a draft.
            this.el.__cm = term.shell;
            this.el.__terminal = term;
            this.el.__scrollToCursor = () => {
                const shell = term.shell;
                if (!shell || !shell.hasFocus) return;
                const pos = shell.state.selection.main.head;
                shell.dispatch({ effects: cm6.EditorView.scrollIntoView(pos, { y: 'center' }) });
            };

            // Draft execution state: addrs whose canvas slot is currently owned
            // by a reviewer's live draft, plus the friend's last code/name per
            // addr (to revert the slot when the draft stops).
            const draftControlled = new Set()
            const lastFriendCode = new Map()
            const friendNames = new Map()

            // Scene bridge: handle focus/remove/fork from outer shell
            const sceneUnsub = sceneBridge.sub(([type, payload]) => {
                switch (type) {
                case 'focus': {
                    // 'world' = sentinel: outer shell releasing focus → restore core tab
                    const isWorld = payload.ambientId === 'world'
                    let targetName = payload.ambientId
                    if (isWorld) targetName = term.currentBufferName()
                    if (!targetName) break

                    const prev = turtle.compositor?.focusedName
                    // Dim previous single ambient (covers outer→outer transitions)
                    if (prev && prev !== targetName) {
                        turtle.setAmbientOpacity(prev, 0.4)
                    }

                    // Core shell group: all active local tabs share focus.
                    // Dim them when focusing outer, restore when returning to 'world'.
                    const localOpacity = isWorld ? 1.0 : 0.4
                    for (const key of turtle._localKeys) {
                        const info = term.getBufferInfo(key)
                        if (info) turtle.setAmbientOpacity(info.name, localOpacity)
                    }

                    turtle.focusAmbient(targetName)
                    turtle.setAmbientOpacity(targetName, 1.0)
                    turtle.requestRender()
                    break
                }
                case 'remove': {
                    turtle.removeAmbient(payload.ambientId)
                    // Forget this addr's draft bookkeeping — otherwise a later
                    // re-watch of the same friend is blocked by a stale
                    // draftControlled entry (seeOuterShell early-returns on it),
                    // or silently revived by a lingering lastFriendCode.
                    draftControlled.delete(payload.ambientId)
                    lastFriendCode.delete(payload.ambientId)
                    friendNames.delete(payload.ambientId)
                    const activeName = term.currentBufferName()
                    if (activeName) {
                        turtle.focusAmbient(activeName)
                        turtle.setAmbientOpacity(activeName, 1.0)
                    }
                    turtle.requestRender()
                    term.clearMerge()
                    break
                }
                case 'fork':
                    term.forkBuffer(payload)
                    term.shell?.focus()
                    break
                case 'ambient': {
                    // A live draft from the outer review surface — run the
                    // reviewer's intervention as this addr's ambient. Mark it
                    // controlled so the friend's own updates don't clobber it.
                    draftControlled.add(payload.addr)
                    turtle.upsertAmbient(payload.addr, payload.name, payload.code)
                    turtle.setAmbientOpacity(payload.name, 1.0)
                    turtle.requestRender()
                    break
                }
                case 'ambientStop': {
                    // Draft frozen/ended — hand the slot back to the friend's code.
                    draftControlled.delete(payload.addr)
                    const code = lastFriendCode.get(payload.addr)
                    // Reverting to the friend's code is passive — no hatch.
                    if (code != null) turtle.upsertAmbient(payload.addr, friendNames.get(payload.addr) || payload.addr, code, { hatch: false })
                    turtle.requestRender()
                    break
                }
                }
            });

            // Remote code rendering: inner shell handles seeOuterShell directly.
            // While an addr is draft-controlled, the running draft owns the
            // canvas slot — record the friend's code (for revert) but don't
            // overwrite the intervention with it.
            this.handleEvent("seeOuterShell", (payload) => {
                if (!payload?.addr) return
                if (payload.state === "success" && payload.commands) {
                    const code = printAST(payload.commands)
                    const name = payload.origin_name || payload.addr
                    lastFriendCode.set(payload.addr, code)
                    friendNames.set(payload.addr, name)
                    if (draftControlled.has(payload.addr)) return
                    // Passive watch: render the friend but never hatch — their
                    // drawing must not be reflected to the server as the user's.
                    turtle.upsertAmbient(payload.addr, name, code, { hatch: false })
                    const isFocused = turtle.compositor?.focusedName === name
                    turtle.setAmbientOpacity(name, isFocused ? 1.0 : 0.4)
                    if (payload.buffer_id) {
                        term.updateMergeOriginal(code, payload.addr, payload.buffer_id)
                    }
                }
            });

            this.cleanup = [
                listeners.keyboard(term.shell, cm6).mount(),
                listeners.selection(term.selectionBridge, this.pushEvent.bind(this)).mount(),
                listeners.theme(theme => term.setOption('theme', theme)).mount(),
                slider.mount(),
                listeners.slider(term.shell, slider, cm6).mount(),
                () => turtle.dispose(),
                () => this._profilerDetach?.(),
                sceneUnsub,
            ];

            this.handleEvent("relayCamera",      ({ command }) => cameraCommand(command));
            this.handleEvent("selfkeepCanvas",   ({ title })   => cameraCommand("snap", { title }));
            this.handleEvent("writeShell",       executeCommand);
            this.handleEvent("opBuffer", (event) => {
                if (event.op === 'activate') {
                    // Shift+click: toggle tab's ambient (add if absent, remove if present)
                    // On add, all local ambients restart in sync.
                    const info = term.getBufferInfo(event.target);
                    if (info) {
                        turtle.toggleAmbient(event.target, info.name, info.content,
                            (key) => term.getBufferInfo(key));
                        term.clearAllTabActive()
                        for (const key of turtle._localKeys) {
                            term.setTabActive(key)
                        }
                    }
                    return;
                }
                if (event.op === 'close') {
                    const targetId = event.target || term.currentBufferId();
                    const hadBuffer = !!term.getBufferInfo(targetId);
                    term.opBufferHandler(event);
                    if (hadBuffer && !term.getBufferInfo(targetId)) {
                        turtle.removeAmbient(targetId);
                        const activeName = term.currentBufferName();
                        if (activeName) turtle.focusAmbient(activeName);
                        term.clearAllTabActive()
                        for (const key of turtle._localKeys) {
                            term.setTabActive(key)
                        }
                        turtle.requestRender();
                    }
                    return;
                }
                if (event.op === 'rename') {
                    const targetId = event.target;
                    const oldName = term.getBufferInfo(targetId)?.name;
                    term.opBufferHandler(event);
                    const newName = term.getBufferInfo(targetId)?.name;
                    if (oldName && newName && oldName !== newName) {
                        const child = turtle.scheduler?.root.children.get(targetId);
                        if (child) child.name = newName;
                    }
                    return;
                }
                term.opBufferHandler(event);
            });
            this.handleEvent("forkBuffer", (forkData) => term.forkBuffer(forkData));
        }
    },

    destroyed() {
        this.cleanup?.forEach(fn => fn());
        this.term?.destroy();
    }
};

export default Shell;
