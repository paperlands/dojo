// CM6 Terminal layer tests — run with: node --test test/js/terminal_test.mjs
//
// Three test groups:
//   1. Vendor bundle — validates priv/static/vendor/cm6.js has expected exports
//   2. EditorState (DOM-free) — pure state logic, runs in Node as-is
//   3. Terminal class — CM6 port validation using mock EditorView
//
// Run: node --test test/js/terminal_test.mjs

import { test, describe, before } from "node:test"
import assert from "node:assert/strict"

// ---------------------------------------------------------------------------
// Node.js environment setup
//
// localStorage and confirm are safe at module level (CM6 doesn't touch them).
// document is set up only inside the Terminal describe block — setting it at
// module level causes CM6 to attempt document.body.style during bundle init
// (it guards with `typeof document !== "undefined"`).
// ---------------------------------------------------------------------------

globalThis.localStorage = (() => {
    let store = {};
    return {
        getItem:    (k)    => store[k] ?? null,
        setItem:    (k, v) => { store[k] = v; },
        removeItem: (k)    => { delete store[k]; },
        clear:      ()     => { store = {}; },
    };
})();

globalThis.confirm = () => true;

// ---------------------------------------------------------------------------
// 1. Vendor bundle integrity
// ---------------------------------------------------------------------------

describe("vendor bundle", () => {
    let cm6

    test("loads without error", async () => {
        cm6 = await import("../../priv/static/vendor/cm6.js")
        assert.ok(cm6, "module loaded")
    })

    test("exports EditorView", async () => {
        const { EditorView } = await import("../../priv/static/vendor/cm6.js")
        assert.equal(typeof EditorView, "function")
    })

    test("exports EditorState", async () => {
        const { EditorState } = await import("../../priv/static/vendor/cm6.js")
        assert.equal(typeof EditorState, "function")
    })

    test("exports Compartment", async () => {
        const { Compartment } = await import("../../priv/static/vendor/cm6.js")
        assert.equal(typeof Compartment, "function")
    })

    test("exports StreamLanguage", async () => {
        const { StreamLanguage } = await import("../../priv/static/vendor/cm6.js")
        assert.ok(StreamLanguage, "StreamLanguage exists")
        assert.equal(typeof StreamLanguage.define, "function", "StreamLanguage.define is callable")
    })

    test("exports MergeView", async () => {
        const { MergeView } = await import("../../priv/static/vendor/cm6.js")
        assert.equal(typeof MergeView, "function")
    })

    test("exports foldGutter, bracketMatching", async () => {
        const { foldGutter, bracketMatching } = await import("../../priv/static/vendor/cm6.js")
        assert.equal(typeof foldGutter, "function")
        assert.equal(typeof bracketMatching, "function")
    })

    test("exports history, defaultKeymap, indentWithTab", async () => {
        const { history, defaultKeymap, indentWithTab } = await import("../../priv/static/vendor/cm6.js")
        assert.equal(typeof history, "function")
        assert.ok(Array.isArray(defaultKeymap))
        assert.equal(typeof indentWithTab, "object")
    })
})

// ---------------------------------------------------------------------------
// 2. EditorState — DOM-free, pure functional state (safe in Node)
// ---------------------------------------------------------------------------

describe("EditorState (DOM-free)", () => {
    let EditorState, Compartment, history

    test("setup", async () => {
        ;({ EditorState, Compartment, history } =
            await import("../../priv/static/vendor/cm6.js"))
    })

    test("create with doc string", () => {
        const state = EditorState.create({ doc: "fw 100" })
        assert.equal(state.doc.toString(), "fw 100")
    })

    test("create with empty doc", () => {
        const state = EditorState.create({ doc: "" })
        assert.equal(state.doc.toString(), "")
    })

    test("doc.length reflects content", () => {
        const state = EditorState.create({ doc: "hello" })
        assert.equal(state.doc.length, 5)
    })

    test("Compartment can be created", () => {
        const c = new Compartment()
        assert.ok(c)
    })

    test("Compartment.of returns an extension", () => {
        const c = new Compartment()
        const ext = c.of([])
        assert.ok(ext)
    })

    test("history() returns an extension", () => {
        const ext = history()
        assert.ok(ext)
    })

    test("EditorState with extensions", () => {
        const state = EditorState.create({
            doc: "fw 100",
            extensions: [history()],
        })
        assert.equal(state.doc.toString(), "fw 100")
    })
})

// ---------------------------------------------------------------------------
// 3. Terminal class — CM6 port validation
//
// Uses a mock EditorView that mirrors the CM6 API surface Terminal calls:
//   view.state.doc.toString()
//   view.dispatch({ changes })
//   view.setState(state)
//   view.focus() / view.hasFocus
// ---------------------------------------------------------------------------

function makeMockCm6() {
    // Minimal EditorState mock
    const makeState = (doc = '') => ({
        doc: {
            toString:  () => doc,
            length:    doc.length,
            lines:     doc.split('\n').length,
            lineAt:    (_offset) => ({ from: 0, to: doc.length, text: doc, number: 1 }),
            line:      (n)       => ({ from: 0, to: doc.length, text: doc, number: n }),
        },
        selection: {
            main:   { from: 0, to: 0, head: 0, anchor: 0 },
            ranges: [{ from: 0, to: 0 }],
        },
        sliceDoc: (from, to) => doc.slice(from, to),
    });

    const EditorState = {
        create: ({ doc = '', extensions: _ext = [] } = {}) => makeState(doc),
    };

    const EditorSelection = {
        cursor: (pos)       => ({ ranges: [{ from: pos, to: pos }],  main: { from: pos, to: pos,  head: pos, anchor: pos } }),
        range:  (from, to)  => ({ ranges: [{ from, to }],            main: { from, to,             head: to,  anchor: from } }),
    };

    class MockEditorView {
        static updateListener  = { of: (_fn) => [] };
        static contentAttributes = { of: (_attrs) => [] };
        static lineWrapping    = [];
        static scrollIntoView  = (_pos, _opts) => [];
        static scrollMargins   = { of: (_fn) => [] };
        static domEventHandlers = (_handlers) => [];
        static theme           = (_spec, _opts) => [];
        static decorations     = { from: (_f) => [] };

        constructor({ state, parent: _parent } = {}) {
            this._state = state || EditorState.create({});
        }

        get state() { return this._state; }

        dispatch({ changes, selection: _sel, effects: _fx } = {}) {
            if (!changes) return;
            const ch  = Array.isArray(changes) ? changes[0] : changes;
            const old = this._state.doc.toString();
            const from = ch.from ?? 0;
            const to   = ch.to   ?? old.length;
            const insert = ch.insert ?? '';
            this._state = EditorState.create({ doc: old.slice(0, from) + insert + old.slice(to) });
        }

        setState(state) { this._state = state; }

        get hasFocus() { return false; }
        focus() {}
        destroy() {}
        get dom() { return { addEventListener: () => {}, removeEventListener: () => {} }; }
    }

    const Compartment = class {
        of(v)        { return { _compartment: this, _value: v }; }
        reconfigure(v) { return { _type: 'reconfigure', _compartment: this, _value: v }; }
    };

    return {
        EditorView:   MockEditorView,
        EditorState,
        EditorSelection,
        Compartment,
        history:             () => [],
        defaultKeymap:       [],
        historyKeymap:       [],
        indentWithTab:       {},
        indentOnInput:       () => [],
        keymap:              { of: (keys) => keys },
        lineNumbers:         () => [],
        highlightActiveLine: () => [],
        bracketMatching:     () => [],
        foldGutter:          () => [],
        gutter:              () => [],
        syntaxHighlighting:    (_style) => [],
        defaultHighlightStyle: [],
        HighlightStyle:      { define: (_rules) => [] },
        tags:                new Proxy({}, { get: (_t, k) => typeof k === 'string' ? (() => k) : k }),
        Decoration:          { mark: (_spec) => ({ spec: _spec }), line: (_spec) => ({ spec: _spec, range: (_pos) => ({}) }), none: [] },
        ViewPlugin:          { fromClass: (_cls, _opts) => [] },
        RangeSetBuilder:     class { add() {} finish() { return []; } },
        StateField:          { define: (_config) => [] },
        MergeView:           class { constructor() {} },
        StreamLanguage:      { define: (_mode) => [] },
        foldService:         { of: (_fn) => [] },
        undo:                () => {},
        redo:                () => {},
    };
}

// Editor element stub — supplies the DOM operations inner() calls
const makeEditorStub = () => ({
    style: {},
    parentNode: { insertBefore: () => {} },
});

describe("Terminal (CM6)", () => {
    let Terminal;

    before(() => {
        // Complete DOM stub — satisfies Tabber (getElementById + cloneNode)
        // and Terminal inner() (createElement + insertBefore).
        const makeEl = () => {
            const el = {
                style: {},
                dataset: {},
                innerHTML: '',
                textContent: '',
                id: '',
                cloneNode:           () => makeEl(),
                // Return a real stub (not null) so Tabber.configureTab can set .tabId etc.
                querySelector:       () => makeEl(),
                querySelectorAll:    () => [],
                appendChild:         () => {},
                insertBefore:        () => {},
                removeChild:         () => {},
                remove:              () => {},
                classList:           { add: () => {}, remove: () => {}, contains: () => false },
                addEventListener:    () => {},
                removeEventListener: () => {},
                setAttribute:        () => {},
                getAttribute:        () => null,
                click:                  () => {},
                scrollTo:               () => {},
                scrollIntoView:         () => {},
                getBoundingClientRect:  () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
                offsetLeft:             0,
                offsetWidth:            0,
            };
            return el;
        };

        globalThis.document = {
            createElement:      () => makeEl(),
            getElementById:     () => makeEl(),
            querySelector:      () => null,
            querySelectorAll:   () => [],
            body:               makeEl(),
            documentElement:    { ...makeEl(), getAttribute: () => null },
            addEventListener:   () => {},
            removeEventListener: () => {},
        };

        globalThis.window = {
            addEventListener:    () => {},
            removeEventListener: () => {},
        };
    });

    test("setup — import Terminal", async () => {
        ;({ Terminal } = await import("../../assets/js/terminal.js"));
        assert.equal(typeof Terminal, "function");
    });

    test("constructs without error", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        assert.ok(term);
        assert.equal(typeof term.run, "function");
        assert.equal(typeof term.bridge.sub, "function");
        assert.equal(typeof term.selectionBridge.sub, "function");
    });

    test("inner() initialises without DOM error", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        assert.doesNotThrow(() => term.inner());
        assert.ok(term.shell, "shell EditorView created");
        assert.ok(term.currentBufferId(), "current buffer set");
    });

    test("getValue returns initial buffer content", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        term.inner();
        const val = term.getValue();
        assert.equal(typeof val, "string");
    });

    test("setValue / getValue round-trip", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        term.inner();
        term.setValue("fw 100");
        assert.equal(term.getValue(), "fw 100");
    });

    test("setValue multiple times — last value wins", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        term.inner();
        term.setValue("fw 100");
        term.setValue("rt 90");
        assert.equal(term.getValue(), "rt 90");
    });

    test("createBuffer returns a new id", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        term.inner();
        const id = term.createBuffer("test-buf", "lt 45");
        assert.equal(typeof id, "string");
        assert.notEqual(id, "");
    });

    test("buffer switching preserves content independently", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        term.inner();

        // Write to first buffer
        term.setValue("fw 100");
        const firstId = term.currentBufferId();

        // Create and write to second buffer
        const secondId = term.createBuffer("second", "rt 90");
        term.opBufferHandler({ op: 'select', target: secondId });
        assert.equal(term.getValue(), "rt 90");

        // Switch back — first buffer content preserved via saved EditorState
        term.opBufferHandler({ op: 'select', target: firstId });
        assert.equal(term.getValue(), "fw 100");
    });

    test("bridge fires on setValue", () => {
        const cm6   = makeMockCm6();
        const term  = new Terminal(makeEditorStub(), cm6);
        term.inner();

        const received = [];
        term.bridge.sub((payload) => received.push(payload));

        // setValue dispatches → updateListener → bridge.pub
        // With mock: updateListener.of is a no-op, so bridge doesn't fire automatically.
        // Verify triggerBridge() fires it explicitly, with the {id,name,content} envelope.
        term.setValue("fw 50");
        term.triggerBridge();
        assert.ok(received.length >= 1, "bridge received at least one event");
        const last = received[received.length - 1];
        assert.equal(last.content, "fw 50");
        assert.equal(last.id, term.currentBufferId());
    });

    // Regression — the activate/fork paths must read the FRESHEST buffer state.
    // state.docs (the cursor/undo view cache, captured only on switch-away) was
    // consulted as a content source, serving stale code to toggleAmbient when
    // the current buffer had unsaved edits. The live editor doc is the owner.
    test("getBufferInfo returns live editor content for the current buffer", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        term.inner();
        const id = term.currentBufferId();

        term.setValue("fw 100");
        // Edit the live doc directly — like typing, before any buffer switch.
        // (The mock's updateListener is a no-op, so nothing syncs the collection
        // or the docs cache: only the live EditorView knows this content.)
        term.shell.dispatch({ changes: { from: 0, to: term.getValue().length, insert: "fw 999" } })

        assert.equal(term.getBufferInfo(id).content, "fw 999",
            "activate must see the unsaved edit, not the switch-away snapshot")
        assert.equal(term.getValue(), "fw 999")
    });

    test("getBufferInfo serves background buffers from the collection", () => {
        const cm6  = makeMockCm6();
        const term = new Terminal(makeEditorStub(), cm6);
        term.inner();
        const firstId = term.currentBufferId();
        term.setValue("fw 100");

        const secondId = term.createBuffer("second", "rt 90");
        term.opBufferHandler({ op: 'select', target: secondId });

        assert.equal(term.getBufferInfo(firstId).content, "fw 100",
            "background buffer reads its collection content")
        assert.equal(term.getBufferInfo(secondId).content, "rt 90",
            "current buffer reads the live doc")
    });
})
