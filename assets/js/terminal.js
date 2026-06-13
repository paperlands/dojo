// Terminal coordinator — thin wiring layer.
// Owns the mutable state atom. Each method sequences calls to extracted modules.
// Factory function (not class) — matches bridged() pattern in the codebase.
//
// NOTE: view.setState() clears CM6 undo history (Transaction.clearHistory).
// Per-buffer history preservation requires hidden EditorViews or historyField
// serialisation — deferred to a future phase.

import { execute } from "./terminal/operations.js"
import { Tabber } from "./terminal/tabber.js"
import { bridged } from "./bridged.js"
import { nameGen as createNameGen, idGen } from "./utils/nama.js"
import { themes } from "./editor/theme.js"
import { createStorage } from "./terminal/storage.js"
import * as buffers from "./terminal/buffers.js"
import * as editorView from "./terminal/view.js"
import { buildExtensions, reapplyCompartments } from "./terminal/extensions.js"

const DEFAULT_OPTIONS = { theme: 'abbott', mode: 'plang' };

/**
 * @typedef {Object} Terminal
 * @property {import('./bridged.js').Bridge} bridge - Content change events
 * @property {import('./bridged.js').Bridge} selectionBridge - Selection change events
 * @property {Object} shell - CM6 EditorView (mutable, via getter)
 * @property {() => Terminal} inner - Initialize as editable inner shell
 * @property {(code?: string) => Terminal} outer - Initialize as read-only outer shell
 * @property {(payload: {source?: string}) => void} changeouter - Update outer shell content
 * @property {(instructions: Object) => void} run - Execute a command/control instruction
 * @property {() => string} getValue - Get current editor content
 * @property {(content: string) => void} setValue - Set editor content
 * @property {(option: string, value: *) => boolean} setOption - Change editor option (e.g. theme)
 * @property {(name?: string, content?: string) => string} createBuffer - Create new buffer, returns id
 * @property {(id?: string) => void} closeBuffer - Close buffer by id
 * @property {(id: string) => void} renameBuffer - Rename buffer by id
 * @property {(event: {op: string, target?: string}) => void} opBufferHandler - Buffer operation dispatch
 * @property {() => void} triggerBridge - Force bridge publish of current content
 * @property {() => void} destroy - Cleanup and save
 */

/**
 * @param {HTMLElement} element - Container element for the editor
 * @param {Object} cm6 - CodeMirror 6 module bundle
 * @param {Object} [options] - Configuration options
 * @returns {Terminal}
 */
export const createTerminal = (element, cm6, options = {}) => {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const names = createNameGen();

    const bridge = bridged("terminal");
    const selectionBridge = bridged("terminal.selection");

    // --- State atom ---
    // Single mutable reference. Transitions via pure functions from buffers.js.
    //
    // Content authority: state.collection, written by exactly one writer — the
    // CM6 update listener (onDocChange), on every transaction. state.docs is a
    // VIEW cache (cursor/undo history for buffer switching); its doc content
    // counts only while it agrees with the collection — never a content source.
    const state = {
        collection: null,     // from buffers.js — plain data, content authority
        docs: new Map(),      // Map<id, EditorState> — view-state cache per buffer
        projectedId: null,    // id the editor currently displays (view concern, not model selection)
        extensions: null,     // shared extension array
        compartments: null,   // { theme, lang, merge } — Compartment handles
        autosaveTimer: null,
        mergeOriginals: new Map(),  // addr → latest outershell content (for lazy merge updates)
        mergeActive: false,           // true while outershell mode is active
        drafting: false,              // outer review surface: editing a draft in place
    };

    let shell = null;         // CM6 EditorView — inherently mutable
    let tabs = null;          // Tabber instance
    let store = null;         // localStorage wrapper

    // --- Internal helpers ---

    const saveToStorage = () => {
        if (!store || !state.collection) return;
        store.save(buffers.serialize(state.collection));
    };

    // Write-through keeps the collection current on every transaction, so
    // persisting on tab hide / page unload needs no live capture.
    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') saveToStorage();
    };

    const onBeforeUnload = () => saveToStorage();

    const triggerBridge = () => {
        const buffer = buffers.currentBuffer(state.collection);
        if (!buffer) return;
        bridge.pub({ id: buffer.id, name: buffer.name, content: buffer.content });
    };

    // Composite key for merge originals — addr alone isn't unique when remote user has multiple tabs
    const mergeKey = (origin) => origin?.buffer_id ? `${origin.addr}:${origin.buffer_id}` : origin?.addr;

    // The merge diff's ORIGINAL, by precedence: the live streamed baseline
    // (mergeOriginals — the friend's code as it runs now) over the birth
    // snapshot (origin.source — the code as it was when forked). One rule,
    // every merge surface reads through it.
    const mergeBaseline = (origin) =>
        state.mergeOriginals.get(mergeKey(origin)) || origin?.source || null;

    // Create an EditorState for a buffer's content, using the shared extension array.
    // Critical: all states share the same Compartment instances for live reconfiguration.
    const createDoc = (content) =>
        editorView.createState(cm6, content, state.extensions);

    // Capture the leaving buffer's view state (cursor, undo history) before a
    // switch — lazy mirror of the cache, evaluated only when needed. Content
    // is NOT captured: the update listener is the single content writer.
    const captureViewState = () => {
        if (state.projectedId && shell) state.docs.set(state.projectedId, shell.state);
    };

    // The one projection read — the EditorState the editor should show for a
    // buffer. Content comes from the collection (the authority); the cached
    // state contributes cursor/undo only while its doc agrees. A disagreeing
    // entry is stale by definition — rebuild from the authority.
    const docFor = (id) => {
        const content = state.collection.items.get(id)?.content ?? '';
        const cached = state.docs.get(id);
        if (cached && cached.doc.toString() === content) return cached;
        const doc = createDoc(content);
        state.docs.set(id, doc);
        return doc;
    };

    const doSelectBuffer = (id, { offset } = {}) => {
        if (!state.collection.items.has(id)) throw new Error(`Buffer '${id}' not found`);

        // Projection happens only when the displayed buffer changes.
        // Re-selecting the current buffer must never touch the live document —
        // the editor IS that buffer; projecting the cache over it would
        // discard the user's latest edits and reset cursor + undo history.
        const switching = state.projectedId !== id;

        if (switching) captureViewState();

        state.collection = buffers.selectCurrent(state.collection, id);

        if (switching) {
            editorView.swapState(shell, docFor(id));
            state.projectedId = id;
            reapplyCompartments(shell, state.compartments, cm6, opts.theme, themes);
        }

        // Restore merge compartment for fork buffers only while outershell is
        // active — dispatch-only (non-destructive), so it runs on every select.
        const selectedBuffer = state.collection.items.get(id);
        if (state.mergeActive && selectedBuffer.origin?.addr && cm6.unifiedMergeView && state.compartments?.merge) {
            const originalContent = mergeBaseline(selectedBuffer.origin);
            if (originalContent) {
                shell.dispatch({
                    effects: state.compartments.merge.reconfigure(
                        cm6.unifiedMergeView({
                            original: cm6.Text.of(originalContent.split('\n')),
                            highlightChanges: true,
                            gutter: true,
                        })
                    ),
                });
            }
        } else if (state.compartments?.merge) {
            shell.dispatch({ effects: state.compartments.merge.reconfigure([]) });
        }

        // 4. Cursor: explicit offset always wins; entering a buffer starts at
        // the end; re-selecting the current buffer leaves the cursor alone.
        if (offset != null) {
            editorView.cursorTo(shell, cm6, offset);
        } else if (switching) {
            editorView.cursorToEnd(shell, cm6);
        }
        shell.focus();

        // 5. Effects (each independent)
        triggerBridge();
        tabs?.selectTab(id);

        return selectedBuffer;
    };

    // --- Public API ---

    const terminal = {
        // Bridges — exposed for shell.js subscription
        bridge,
        selectionBridge,

        // shell getter — shell.js listeners need the EditorView directly
        get shell() { return shell; },

        currentBufferId() { return state.collection?.currentId; },

        currentBufferName() {
            const id = state.collection?.currentId;
            return id ? state.collection.items.get(id)?.name : null;
        },

        getBufferInfo(id) {
            const buffer = state.collection?.items.get(id);
            if (!buffer) return null;
            return { name: buffer.name, content: buffer.content };
        },

        setTabActive(id) { tabs?.setActive(id) },
        clearTabActive(id) { tabs?.clearActive(id) },
        clearAllTabActive() { tabs?.clearAllActive() },

        inner() {
            const { extensions, compartments } = buildExtensions(cm6, {
                onDocChange: (content) => {
                    // 1. Write-through: the displayed buffer's content lands in
                    // the collection on every change — the single content
                    // writer, keyed by the surface the edit landed on.
                    const id = state.projectedId;
                    if (id) {
                        state.collection = buffers.updateContent(state.collection, id, content);
                    }
                    // 2. Autosave (scheduled effect)
                    clearTimeout(state.autosaveTimer);
                    state.autosaveTimer = setTimeout(saveToStorage, 500);
                    // 3. Bridge (event effect) — capture identity at publish time
                    const name = id ? state.collection.items.get(id)?.name : null;
                    bridge.pub({ id, name, content });
                },
                onSelectionChange: (selection) => {
                    selectionBridge.pub(selection);
                },
                onSwitchNext: () => {
                    const id = buffers.nextId(state.collection);
                    doSelectBuffer(id);
                },
                onSwitchPrev: () => {
                    const id = buffers.prevId(state.collection);
                    doSelectBuffer(id);
                },
                onToggleComment: (view) => {
                    editorView.toggleComment(view);
                },
            });

            state.extensions = extensions;
            state.compartments = compartments;

            const result = editorView.createInnerView(element, cm6, extensions);
            shell = result.view;

            // Wire PaperLang into the language compartment after view creation
            reapplyCompartments(shell, compartments, cm6, opts.theme, themes);

            // Load buffers from storage, create EditorStates, populate tabs
            tabs = new Tabber();
            store = createStorage();

            const stored = store.load();
            state.collection = stored
                ? buffers.loadCollection(stored, names, idGen)
                : buffers.createCollection(names, idGen);

            // Create EditorState per buffer and populate tab UI
            for (const [id, buffer] of state.collection.items) {
                state.docs.set(id, createDoc(buffer.content));
                tabs.addTab(id, buffer.name);
            }

            // Select initial buffer
            doSelectBuffer(state.collection.currentId);

            // Persist on tab hide / page unload — timer-based autosave alone is unreliable
            document.addEventListener('visibilitychange', onVisibilityChange);
            window.addEventListener('beforeunload', onBeforeUnload);

            return terminal;
        },

        outer(_code = '') {
            // Publish draft edits so the hook can run them live as an ambient.
            const { extensions, compartments } = buildExtensions(cm6, {
                onDocChange: (content) => bridge.pub({ content }),
            });

            // Read-only lives in its own compartment so the review surface can
            // toggle into an editable draft.
            const readOnly = new cm6.Compartment();
            compartments.readOnly = readOnly;

            state.extensions = extensions;
            state.compartments = compartments;

            const result = editorView.createOuterView(element, cm6, extensions, readOnly);
            shell = result.view;

            reapplyCompartments(shell, compartments, cm6, opts.theme, themes);

            return terminal;
        },

        changeouter(code) {
            // Don't clobber the user's in-place draft with incoming friend code.
            if (state.drafting) return;
            editorView.updateOuter(shell, code);
        },

        // --- Outer review surface: edit a draft as a live merge ----------------
        //
        // The OuterShell is one living diff: `original` = the friend's code,
        // `mine` = your draft (seeded from your existing coreshell fork if one
        // exists along this lineage, else from their code).

        beginDraft({ addr, buffer_id } = {}) {
            if (!shell || state.drafting) return;
            const friendSource = editorView.getContent(shell);

            // Lineage-aware seed: read your existing fork of this code from the
            // inner terminal (owner of the buffer collection). Falls back to the
            // friend's code when you have no fork yet.
            const inner = document.getElementById('your-buffer')?.__terminal;
            const forkContent = inner?.forkContent?.(addr, buffer_id) ?? null;
            const draft = forkContent ?? friendSource;

            state.drafting = true;

            const effects = [
                state.compartments.readOnly.reconfigure(cm6.EditorState.readOnly.of(false)),
            ];
            if (state.compartments.merge && cm6.unifiedMergeView) {
                effects.push(state.compartments.merge.reconfigure(
                    cm6.unifiedMergeView({
                        original: cm6.Text.of(friendSource.split('\n')),
                        highlightChanges: true,
                        gutter: true,
                    })
                ));
            }
            shell.dispatch({ effects });

            if (draft !== friendSource) editorView.setContent(shell, draft);

            // Keep focus on the review surface — drafting must not jump away.
            // Re-grab on the next frame too: the merge view inserts its diff DOM
            // asynchronously, which can blur the contenteditable mid-keystroke.
            shell.focus();
            requestAnimationFrame(() => shell?.focus());
        },

        // Live baseline: set the friend's current code as the merge ORIGINAL
        // (a rebase preview) while you keep your draft. We reconfigure the merge
        // compartment rather than use updateOriginalDoc — that effect needs a
        // {doc, changes} payload; reconfiguring reliably resets the baseline and
        // recomputes the diff against your draft.
        streamOrigin(content) {
            if (!state.drafting || !shell || !state.compartments?.merge || !cm6.unifiedMergeView) return;
            shell.dispatch({
                effects: state.compartments.merge.reconfigure(
                    cm6.unifiedMergeView({
                        original: cm6.Text.of((content ?? '').split('\n')),
                        highlightChanges: true,
                        gutter: true,
                    })
                ),
            });
        },

        endDraft() {
            if (!shell || !state.drafting) return;
            state.drafting = false;
            const effects = [
                state.compartments.readOnly.reconfigure(cm6.EditorState.readOnly.of(true)),
            ];
            if (state.compartments.merge) {
                effects.push(state.compartments.merge.reconfigure([]));
            }
            shell.dispatch({ effects });
        },

        drafting() {
            return state.drafting;
        },

        run(instructions) {
            if (typeof execute === 'function' && shell) {
                execute(shell, instructions, cm6);
            }
        },

        getValue() {
            return editorView.getContent(shell);
        },

        setValue(content) {
            editorView.setContent(shell, content);
        },

        setOption(option, value) {
            opts[option] = value;
            if (option === 'theme' && shell && state.compartments && themes[value]) {
                const themeBundle = themes[value](cm6);
                shell.dispatch({ effects: state.compartments.theme.reconfigure(themeBundle) });
            }
            return true;
        },

        opBufferHandler(event) {
            const { op, target } = event;
            switch (op) {
            case 'add':    terminal.createBuffer(); break;
            case 'select': doSelectBuffer(target); break;
            case 'rename': terminal.renameBuffer(target); break;
            case 'close':  terminal.closeBuffer(target); break;
            }
        },

        createBuffer(name = '', content = '', origin = null) {
            const bufferName = name || names();
            const { collection, id } = buffers.addBuffer(
                state.collection, { name: bufferName, content, origin }, names, idGen
            );
            state.collection = collection;
            state.docs.set(id, createDoc(content));
            tabs.addTab(id, bufferName);
            doSelectBuffer(id);
            return id;
        },

        findFork(addr, buffer_id) {
            for (const [id, buffer] of state.collection.items) {
                if (buffer.origin?.addr === addr && (!buffer_id || buffer.origin?.buffer_id === buffer_id)) return id;
            }
            return null;
        },

        // Current content of your fork along a lineage, if you have one.
        // Read by the outer review surface to seed a draft (cross-terminal).
        forkContent(addr, buffer_id) {
            if (!state.collection) return null;
            const id = this.findFork(addr, buffer_id);
            return id ? state.collection.items.get(id).content : null;
        },

        forkBuffer({ source, name, addr, buffer_id, time, offset }) {
            if (!source || !addr) return;
            state.mergeActive = true;

            const selectFork = (id) => doSelectBuffer(id, { offset });

            const existing = this.findFork(addr, buffer_id);
            if (existing) {
                const existingBuffer = state.collection.items.get(existing);

                // Remote user iterated on the same tab — create new merge tab
                if (existingBuffer.origin?.source !== source) {
                    const forkContent = existingBuffer.content;

                    const bufferName = name ? `${name}'s fork (merge)` : 'fork (merge)';
                    const origin = { addr, buffer_id, source, time, name };
                    const { collection, id } = buffers.addBuffer(
                        state.collection, { name: bufferName, content: forkContent, origin }, names, idGen
                    );
                    state.collection = collection;
                    state.docs.set(id, createDoc(forkContent));
                    tabs.addTab(id, bufferName);
                    selectFork(id);
                    return id;
                }

                // Same code — switch to existing tab, continue editing
                selectFork(existing);
                return existing;
            }

            const bufferName = name ? `${name}'s fork` : 'fork';
            const origin = { addr, buffer_id, source, time, name };
            const { collection, id } = buffers.addBuffer(
                state.collection, { name: bufferName, content: source, origin }, names, idGen
            );
            state.collection = collection;
            state.docs.set(id, createDoc(source));
            tabs.addTab(id, bufferName);
            selectFork(id);
            return id;
        },

        updateMergeOriginal(content, addr, buffer_id) {
            const key = buffer_id ? `${addr}:${buffer_id}` : addr;
            state.mergeOriginals.set(key, content);

            // Only update live diff if the current fork matches this addr:buffer_id.
            // Reconfigure the merge (not updateOriginalDoc, which needs {doc, changes})
            // so the new baseline actually lands and the diff recomputes.
            const current = buffers.currentBuffer(state.collection);
            if (state.mergeActive && current?.origin?.addr === addr
                && (!buffer_id || current.origin.buffer_id === buffer_id)
                && state.compartments?.merge && cm6.unifiedMergeView && shell) {
                shell.dispatch({
                    effects: state.compartments.merge.reconfigure(
                        cm6.unifiedMergeView({
                            original: cm6.Text.of(content.split('\n')),
                            highlightChanges: true,
                            gutter: true,
                        })
                    ),
                });
            }
        },

        // Outershell activated — show merge diff for current fork buffer
        resumeMerge() {
            state.mergeActive = true;
            const current = buffers.currentBuffer(state.collection);
            if (current?.origin?.addr && cm6.unifiedMergeView && state.compartments?.merge && shell) {
                const originalContent = mergeBaseline(current.origin);
                if (originalContent) {
                    shell.dispatch({
                        effects: state.compartments.merge.reconfigure(
                            cm6.unifiedMergeView({
                                original: cm6.Text.of(originalContent.split('\n')),
                                highlightChanges: true,
                                gutter: true,
                            })
                        ),
                    });
                }
            }
        },

        // Outershell deactivated — accept local changes, hide merge
        suspendMerge() {
            state.mergeActive = false;
            if (state.compartments?.merge && shell) {
                shell.dispatch({
                    effects: state.compartments.merge.reconfigure([]),
                });
            }
        },

        clearMerge() {
            state.mergeActive = false;
            if (state.compartments?.merge && shell) {
                shell.dispatch({
                    effects: state.compartments.merge.reconfigure([]),
                });
            }
            state.mergeOriginals.clear();
        },

        closeBuffer(id) {
            const targetId = id || state.collection.currentId;
            if (!targetId || !state.collection.items.has(targetId)) return;
            if (state.collection.items.size <= 1) return;

            const buffer = state.collection.items.get(targetId);
            const confirmed = confirm(`NOTE! You are destroying ${buffer.name}`);
            if (!confirmed) return;

            // If closing the active buffer, switch first
            if (targetId === state.collection.currentId) {
                const nextBufferId = buffers.nextId(state.collection);
                if (nextBufferId !== targetId) doSelectBuffer(nextBufferId);
            }

            // Transition collection (pure data) + cleanup CM6 state
            state.collection = buffers.removeBuffer(state.collection, targetId);
            state.docs.delete(targetId);
            tabs.closeTab(targetId);
            saveToStorage();
        },

        renameBuffer(id) {
            const newName = tabs.readTabName(id);
            if (newName == null || !state.collection.items.has(id)) return;
            // A rename is a metadata transition — no projection, no cursor or
            // focus movement. Publish so render/ambient subscribers track the name.
            state.collection = buffers.renameBuffer(state.collection, id, newName);
            saveToStorage();
            if (id === state.collection.currentId) triggerBridge();
        },

        triggerBridge,

        destroy() {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('beforeunload', onBeforeUnload);
            clearTimeout(state.autosaveTimer);
            saveToStorage();
            editorView.destroy(shell, element);
        },
    };

    return terminal;
};

// Backwards compatibility — shell.js uses `new Terminal(el, cm6)`
// TODO: migrate shell.js to createTerminal(), then remove this class
export class Terminal {
    constructor(editor, cm6, options = {}) {
        const term = createTerminal(editor, cm6, options);
        Object.assign(this, term);
        // Copy getter for shell
        Object.defineProperty(this, 'shell', {
            get: () => term.shell,
            enumerable: true,
        });
    }
}
