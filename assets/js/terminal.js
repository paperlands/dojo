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
    // EditorState docs kept separate — they're CM6 values, not buffer data.
    const state = {
        collection: null,     // from buffers.js — plain data
        docs: new Map(),      // Map<id, EditorState> — CM6 state per buffer
        extensions: null,     // shared extension array
        compartments: null,   // { theme, lang } — Compartment handles
        autosaveTimer: null,
    };

    let shell = null;         // CM6 EditorView — inherently mutable
    let tabs = null;          // Tabber instance
    let store = null;         // localStorage wrapper

    // --- Internal helpers ---

    const saveToStorage = () => {
        if (!store || !state.collection) return;
        store.save(buffers.serialize(state.collection));
    };

    const triggerBridge = () => {
        const content = editorView.getContent(shell);
        bridge.pub(content);
    };

    // Create an EditorState for a buffer's content, using the shared extension array.
    // Critical: all states share the same Compartment instances for live reconfiguration.
    const createDoc = (content) =>
        editorView.createState(cm6, content, state.extensions);

    // Save current EditorState before leaving a buffer (preserves doc + cursor).
    const captureCurrentState = () => {
        const currentId = state.collection?.currentId;
        if (currentId && shell) {
            state.docs.set(currentId, shell.state);
        }
    };

    const doSelectBuffer = (id) => {
        if (!state.collection.items.has(id)) throw new Error(`Buffer '${id}' not found`);

        // 1. Save current (CM6 concern)
        const oldId = state.collection.currentId;
        if (oldId && oldId !== id) captureCurrentState();

        // 2. Transition collection (pure data)
        state.collection = buffers.selectCurrent(state.collection, id);

        // 3. Swap view (CM6 concern)
        editorView.swapState(shell, state.docs.get(id));
        reapplyCompartments(shell, state.compartments, cm6, opts.theme, themes);
        editorView.cursorToEnd(shell, cm6);
        shell.focus();

        // 4. Effects (each independent)
        triggerBridge();
        tabs?.selectTab(id);

        return state.collection.items.get(id);
    };

    // --- Public API ---

    const terminal = {
        // Bridges — exposed for shell.js subscription
        bridge,
        selectionBridge,

        // shell getter — shell.js listeners need the EditorView directly
        get shell() { return shell; },

        inner() {
            const { extensions, compartments } = buildExtensions(cm6, {
                onDocChange: (content) => {
                    // 1. Buffer content sync (pure data transition)
                    if (state.collection?.currentId) {
                        state.collection = buffers.updateContent(
                            state.collection, state.collection.currentId, content
                        );
                    }
                    // 2. Autosave (scheduled effect)
                    clearTimeout(state.autosaveTimer);
                    state.autosaveTimer = setTimeout(saveToStorage, 500);
                    // 3. Bridge (event effect)
                    bridge.pub(content);
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

            return terminal;
        },

        outer(_code = '') {
            const { extensions, compartments } = buildExtensions(cm6, {});

            state.extensions = extensions;
            state.compartments = compartments;

            const result = editorView.createOuterView(element, cm6, extensions);
            shell = result.view;

            reapplyCompartments(shell, compartments, cm6, opts.theme, themes);

            return terminal;
        },

        changeouter(payload) {
            editorView.updateOuter(shell, payload?.source ?? '');
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

        createBuffer(name = '', content = '') {
            const bufferName = name || names();
            const { collection, id } = buffers.addBuffer(
                state.collection, { name: bufferName, content }, names, idGen
            );
            state.collection = collection;
            state.docs.set(id, createDoc(content));
            tabs.addTab(id, bufferName);
            doSelectBuffer(id);
            return id;
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
            const newName = tabs.renameTab(id);
            doSelectBuffer(id);
            state.collection = buffers.renameCurrent(state.collection, id, newName);
        },

        triggerBridge,

        destroy() {
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
