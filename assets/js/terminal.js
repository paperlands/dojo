import { execute } from "./terminal/operations.js"
import { Tabber } from "./terminal/tabber.js"
import { bridged } from "./bridged.js"
import { nameGen, idGen } from "./utils/nama.js"
import {printAST} from "./turtling/parse.js"

// =============================================================================
// STORAGE LAYER
// =============================================================================

class BufferStorage {
    STORAGE_KEY = '@paperlands.buffers';

    constructor(name="inner") {
        this.name = this.STORAGE_KEY + "@" + name
    }

    // needs to by dynamic
    #createDefaultBuffer() {
        return {
            id: idGen(),
            name: 'Papert',
            active: true,
            content: `def wave phase amp do
    fw amp*sin[phase]
    lt 90
    jmp -5
    rt  90
    fw -amp*sin[phase]
    wave phase+5 amp
end

loop 30 do
  jmpto 0 125
  erase
  beColour purple
  when random<0.5 do
    beColour purple
    label "Delete code on the left to begin 🧙‍♂️" 20
  end
  when random do
    beColour gold
    label "Delete code on the left to begin 🧙‍♂️✨" 20
  end
  jmp -200
  rt 180
  fw 50
  label "➤" 30
  jmpto 0 0
  jmp -1000
  rt 270
  beColour darkorange
  wave random*180 15
  lt 90
  wait 1
end`,
            mode: 'plang',
            created: Date.now(),
            lastModified: Date.now()
        };
    }

     load() {
        try {
            const stored = localStorage.getItem(this.name);
            const buffers = stored ? JSON.parse(stored) : {};

            // Ensure at least one buffer exists
            if (Object.keys(buffers).length === 0) {
                const defaultBuffer = this.#createDefaultBuffer();
                buffers[defaultBuffer.id] = defaultBuffer;
            }

            return buffers;
        } catch (e) {
            console.warn('Storage load failed, using defaults:', e);
            const defaultBuffer = this.#createDefaultBuffer();
            return { [defaultBuffer.id]: defaultBuffer };
        }
    }

     save(buffers) {
        try {
            localStorage.setItem(this.name, JSON.stringify(buffers));
            return true;
        } catch (e) {
            console.warn('Storage save failed:', e);
            return false;
        }
    }
}


export class Terminal {
    // Default CodeMirror configuration
    static DEFAULT_OPTIONS = {
        theme: 'abbott',
        mode: 'plang',
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: { nonEmpty: true },
        styleActiveSelected: true,
        autocorrect: true,
        foldGutter: true,
        matchBrackets: {
            enableWordMatching: true,
            highlightNonMatching: true,
            maxScanLines: 200
        },
        smartIndent: true,
        gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']
    };

    constructor(editor, CodeMirror, options = {}) {

        this.editor = editor;
        this.CM = CodeMirror;
        this.options = { ...Terminal.DEFAULT_OPTIONS, ...options };
        this.buffers = new Map(); // Use Map for better performance
        this.docs = new Map(); // Separate CodeMirror docs from buffer metadata
        this.currentBuffer = null;
        this.shell = null;
        this.nameGen = nameGen();
        this.autosaveTimer = null;
        // Merge state - null when in single-pane mode
        this.merge = null;

        
        this.bridge = bridged("terminal")
        return this
    }

    inner() {
        this.shell = this.CM.fromTextArea(this.editor, this.#buildOptions());
        this.#setupEventListeners(this.shell);
        this.shell.run = this.run.bind(this);
        this.tabs = new Tabber()
        this.bufferStore = new BufferStorage()
        this.#loadBuffersFromStorage()
        this.#selectInitialBuffer();

        return this;
    }

    outer(code="") {
        this.shell = this.#enterMerge("")
        this.#setupEventListeners(this.shell);
        this.shell.run = this.run.bind(this);
        this.swapBuffer("@outer.shell", code);
        this.rightPane().output = document.getElementById("outermerge-output");
        return this;
    }

    changeouter(payload) {
        switch(payload.state) {
        case 'success':
            const code = printAST(payload.commands)
            this.swapBuffer("@outer.shell", code);
            this.rightPane().setValue(code)
            this.rightPane().output.style.color = "#FF9933";
            this.rightPane().output.innerHTML = `${payload.message || ""}`
            break;
        case 'error':
            if(payload.commands?.length>0) {
                const code = printAST(payload.commands)
                this.swapBuffer("@outer.shell", code);
            }
            this.rightPane().setValue(payload.source)
            this.rightPane().output.style.color = "#FF0000";
            this.rightPane().output.innerHTML = `${payload.message}`
            break;
            
        }
    }

    // buffermanagement
    opBufferHandler(event) {
        console.log(event)
        const { op, target } = event;
        switch(op) {
        case 'add':
            this.createBuffer()
            break;
        case 'select':
            this.selectBuffer(target);
            break;
        case 'rename':
            this.renameBuffer(target)
            break;
        case 'close':
            this.closeBuffer(target);
            break;
        }
    }


    #buildOptions() {
        return {
            ...this.options,
            extraKeys: {
                'Ctrl-/': (cm) => this.toggleComment(cm),
                'Ctrl-A': (cm) => cm.execCommand("selectAll"),
                'Ctrl-.': () => this.switchToNextBuffer(),
                'Ctrl-,': () => this.switchToPrevBuffer(),
                ...this.options.extraKeys
            }
        };
    }

    #setupEventListeners(shell) {
        // Gutter click selection
        shell.on('gutterClick', (cm, line) => {
            cm.focus();
            cm.setSelection({ line, ch: 0 }, { line, ch: cm.getLine(line).length });
        });

        // Content change handling with debounced autosave
        shell.on('change', (cm) => {
            const content = cm.getValue();

            // Update current buffer
            if (this.currentBuffer) {
                this.buffers.get(this.currentBuffer).content = content;

            }

            // Debounced save to localStorage
            clearTimeout(this.autosaveTimer);
            this.autosaveTimer = setTimeout(() => this.#saveToStorage(), 500);

            this.bridge.pub(content);

        });

    }

    // Core primitive: capture editor state for restoration
    #captureState(ed = this.shell) {
        return {
            value: ed.getValue(),
            cursor: ed.getCursor(),
            scroll: ed.getScrollInfo(),
            selections: ed.listSelections()
        };
    }

    // Core primitive: restore editor state after transition
    #restoreState(ed, state) {
        ed.setValue(state.value);
        ed.setSelections(state.selections);
        ed.scrollTo(state.scroll.left, state.scroll.top);
    }

     // Enter merge view mode
    #enterMerge(orig, opts = {}) {
        // Capture current editor state
        // const state = this.#captureState();
        
        const container = document.getElementById('outershell');
        
        this.merge = {}
        
        // Create merge view with combined options
        this.merge.view = this.CM.MergeView(container, {
            ...this.options,
            value: "",
            orig: orig,
            connect: 'align',
            collapseIdentical: false,
            
            ...opts
        });
        

        

        return this.merge.view.editor()
    }


    setOption(option, delta) {
        if (this.merge?.view.editor()) {
            this.merge.view.editor().setOption(option, delta)
            this.merge.view.rightOriginal().setOption(option, delta)
        }
        
        this.shell.setOption(option, delta);
        this.options[option] = delta
        // if merge else shell
        return true  
    }

    // Get currently active editor (works in both modes)
    active() {
        return this.merge?.view.editor() || this.shell;
    }

    // Get right pane editor (only in merge mode)
    rightPane() {
        return this.merge?.view.rightOriginal() || null;
    }

    // Update right pane content (only in merge mode)
    updateRightPane(content) {
        if (!this.merge) {
            console.warn('Not in merge mode');
            return false;
        }
        this.rightPane?.setValue(content);
        return true;
    }


    #loadBuffersFromStorage() {
        const storedBuffers = this.bufferStore.load();

        Object.values(storedBuffers).forEach((buffer) => {
            this.#recreateBufferDoc(buffer);
            this.tabs.addTab(buffer.id, buffer.name)

            if(buffer.active) {
                this.currentBuffer = buffer.id
            }
        });
    }

    #selectInitialBuffer() {
        const defaultBuffer = this.buffers.keys()[0];

        this.currentBuffer && this.selectBuffer(this.currentBuffer) || this.selectBuffer(defaultBuffer);
    }

    #createBufferDoc(name, content = '') {
        return this.#recreateBufferDoc({name: name, content: content});
    }

    #recreateBufferDoc(buffer) {
        const updatedBuffer = {
            id: buffer.id ?? idGen(),
            name: buffer.name ?? this.nameGen(),
            mode: buffer.mode ?? 'plang',
            content: buffer.content ?? `jmpto 0 125
beColour red
label "Delete all the code here to begin 🧙‍♂️" 20
jmp -200
rt 180
fw 50
label "➤" 20
beColour DarkOrange
jmpto 0 0
rt 180
label "Welcome to PaperLand" 50`,
            created: buffer.created ?? Date.now(),
            lastModified: buffer.lastModified ?? Date.now(),
        };

        const doc = this.CM.Doc(updatedBuffer.content, updatedBuffer.mode);

        this.buffers.set(updatedBuffer.id, updatedBuffer);
        this.docs.set(updatedBuffer.id, doc);

        return { id: updatedBuffer.id, buffer: updatedBuffer, doc };
    }

    #saveToStorage() {
        if(this.bufferStore) {
        const bufferData = {};
        this.buffers.forEach((buffer, id) => {
            bufferData[id] = {
                id: id,
                name: buffer.name,
                active: this.currentBuffer == id,
                content: buffer.content,
                mode: buffer.mode,
                created: buffer.created,
                lastModified: buffer.lastModified

            };
        });
        this.bufferStore.save(bufferData);
        }
    }

    // Public API methods
    triggerBridge() {
        this.bridge.pub(this.getCurrentBuffer().content);
    }


    createBuffer(name = '', content = '', mode = 'plang'){
        const bufferName = name || this.nameGen()
        const {id,  buffer, doc } = this.#createBufferDoc(bufferName, content);
        this.tabs.addTab(id, buffer.name)
        this.selectBuffer(id);

        return id;
    }

    swapBuffer(bufferName, content, mode) {
        const { id, buffer, doc } = this.#createBufferDoc(bufferName, content);
        this.currentBuffer = id;
        this.active().swapDoc(doc)
        this.triggerBridge()
    }


    selectBuffer(id) {
        if (!this.buffers.has(id)) {
            throw new Error(`Buffer '${name}' not found`);
        }
        this.currentBuffer = id;
        const doc = this.docs.get(id);
        this.shell.swapDoc(doc);
        this.triggerBridge()
        this.shell.focus();

        this.tabs.selectTab(id)


        return this.buffers.get(id);
    }

    closeBuffer(id = this.currentBuffer) {
        if (!id || !this.buffers.has(id)) {
            throw new Error(`Buffer '${id}' not found`);
        }

        if (this.buffers.size === 1) {
            throw new Error('Cannot close the last buffer');
        }

        const confirmed = prompt(`Are you sure you want to kill ${this.buffers.get(id)["name"]}?`);
        if (confirmed === '') {

            // Switch to another buffer if closing current
            if (id === this.currentBuffer) {
                const bufferIds = Array.from(this.buffers.keys());
                const currentIndex = bufferIds.indexOf(id);
                const nextBuffer = bufferIds[currentIndex + 1] || bufferIds[currentIndex - 1];
                this.selectBuffer(nextBuffer);
            }

            this.tabs.closeTab(id)

            this.buffers.delete(id);
            this.docs.delete(id);

            this.#saveToStorage();

            return this;
        }
    }

    renameBuffer(id) {
        const newName = this.tabs.renameTab(id);
        const buffer = this.selectBuffer(id);
        buffer.name = newName
        console.log(buffer)

        return this;
    }

    switchToNextBuffer() {
        const names = Array.from(this.buffers.keys());
        const currentIndex = names.indexOf(this.currentBuffer);
        const nextIndex = (currentIndex + 1) % names.length;
        this.selectBuffer(names[nextIndex]);
        return this;
    }

    switchToPrevBuffer() {
        const names = Array.from(this.buffers.keys());
        const currentIndex = names.indexOf(this.currentBuffer);
        const prevIndex = currentIndex === 0 ? names.length - 1 : currentIndex - 1;
        this.selectBuffer(names[prevIndex]);
        return this;
    }

    getBufferList() {
        return Array.from(this.buffers.values()).map(buffer => ({
            name: buffer.name,
            mode: buffer.mode,
            active: buffer.name === this.currentBuffer,
            modified: buffer.lastModified
        }));
    }

    getCurrentBuffer() {
        return this.currentBuffer ? this.buffers.get(this.currentBuffer) : null;
    }


    toggleComment(cm) {
        const selections = cm.listSelections();

        cm.operation(() => {
            selections.forEach(sel => {
                const { anchor, head } = sel;
                const startLine = Math.min(anchor.line, head.line);
                const endLine = Math.max(anchor.line, head.line);

                // Check if all lines are commented
                let allCommented = true;
                for (let i = startLine; i <= endLine; i++) {
                    const line = cm.getLine(i).trim();
                    if (line && !line.startsWith('#')) {
                        allCommented = false;
                        break;
                    }
                }

                // Toggle comments
                for (let i = startLine; i <= endLine; i++) {
                    const line = cm.getLine(i);
                    if (allCommented) {
                        // Remove comment
                        const uncommented = line.replace(/^(\s*)#\s?/, '$1');
                        cm.replaceRange(uncommented, { line: i, ch: 0 }, { line: i, ch: line.length });
                    } else {
                        // Add comment
                        const indent = line.match(/^(\s*)/)[1];
                        const commented = indent + '# ' + line.slice(indent.length);
                        cm.replaceRange(commented, { line: i, ch: 0 }, { line: i, ch: line.length });
                    }
                }
            });
        });
    }

    // mutate terminal state
    run(instructions) {
        if (typeof execute === 'function') {
            // operations and instructions for cntrl and command deck
            execute(this.active(), instructions);
        } else {
            console.warn('Execute function not available');
        }
    }

    // Cleanup method
    destroy() {
        clearTimeout(this.autosaveTimer);
        this.#saveToStorage();
        this.shell?.toTextArea();
    }
}
