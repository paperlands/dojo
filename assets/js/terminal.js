import { execute } from "./terminal/operations.js"
import { bridged } from "./bridged.js"
import { nameGen, idGen } from "./utils/nama.js"

// =============================================================================
// STORAGE LAYER
// =============================================================================

class BufferStorage {
    static STORAGE_KEY = '@paperland.buffers';

    static #createDefaultBuffer() {
        return {
            id: idGen(),
            name: '~',
            content: `jmpto 0 125
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
            mode: 'plang',
            created: Date.now(),
            lastModified: Date.now()
        };
    }

    static load() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
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

    static save(buffers) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(buffers));
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
        theme: 'everforest',
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
        this.autosaveTimer = null;
        this.shell = this.CM.fromTextArea(this.editor, this.#buildOptions());
        this.#setupEventListeners();
        this.bridge = bridged("terminal")
        this.#loadBuffersFromStorage();
        this.shell.run = this.run.bind(this);
        return this
    }

    inner() {

        this.#selectInitialBuffer();

        return this;
    }

    outer(code) {

        this.swapBuffer("@outer.shell", code);

        return this;
    }

    #buildOptions() {
        return {
            ...this.options,
            extraKeys: {
                'Ctrl-/': (cm) => this.toggleComment(cm),
                'Alt-T': () => this.createBuffer(),
                'Alt-W': () => this.closeBuffer(),
                'Shift-Tab': () => this.switchToNextBuffer(),
                'Ctrl-Shift-Tab': () => this.switchToPrevBuffer(),
                ...this.options.extraKeys
            }
        };
    }

    #setupEventListeners() {
        // Gutter click selection
        this.shell.on('gutterClick', (cm, line) => {
            cm.focus();
            cm.setSelection({ line, ch: 0 }, { line, ch: cm.getLine(line).length });
        });

        // Content change handling with debounced autosave
        this.shell.on('change', (cm) => {
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

    #loadBuffersFromStorage() {
        const storedBuffers = BufferStorage.load();

        Object.values(storedBuffers).forEach((buffer) => {
            this.#recreateBufferDoc(buffer);
        });
    }

    #selectInitialBuffer() {
        const bufferNames = Array.from(this.buffers.keys());
        const defaultBuffer = bufferNames.includes('~') ? '~' : bufferNames[0];

        if (defaultBuffer) {
            this.selectBuffer(defaultBuffer);
        }
    }

    #createBufferDoc(name, content = '') {
        return this.#recreateBufferDoc({name: name, content: content});
    }

    #recreateBufferDoc(buffer) {
        const updatedBuffer = {
            id: buffer.id ?? idGen(),
            name: buffer.name ?? nameGen(),
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
        const bufferData = {};
        this.buffers.forEach((buffer, id) => {
            bufferData[id] = {
                id: id,
                name: buffer.name,
                content: buffer.content,
                mode: buffer.mode,
                created: buffer.created,
                lastModified: buffer.lastModified

            };
        });
        BufferStorage.save(bufferData);
    }

    // Public API methods
    triggerBridge() {
        this.bridge.pub(this.getCurrentBuffer().content);
    }

    createBuffer(name = null, content = '', mode = 'plang') {
        const bufferName = name || nameGen()

        const {uuid,  buffer, doc } = this.#createBufferDoc(bufferName, content);


        this.selectBuffer(uuid);


        return uuid;
    }

    swapBuffer(bufferName, content, mode) {
        const { id, buffer, doc } = this.#createBufferDoc(bufferName, content);
        this.currentBuffer = id;
        this.shell.swapDoc(doc)
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


        return this;
    }

    closeBuffer(id = this.currentBuffer) {
        if (!id || !this.buffers.has(id)) {
            throw new Error(`Buffer '${id}' not found`);
        }

        if (this.buffers.size === 1) {
            throw new Error('Cannot close the last buffer');
        }

        // Switch to another buffer if closing current
        if (id === this.currentBuffer) {
            const bufferIds = Array.from(this.buffers.keys());
            const currentIndex = bufferIds.indexOf(id);
            const nextBuffer = bufferIds[currentIndex + 1] || bufferIds[currentIndex - 1];
            this.selectBuffer(nextBuffer);
        }

        this.buffers.delete(id);
        this.docs.delete(id);

        // Update storage
        this.#saveToStorage();

        return this;
    }

    renameBuffer(oldName, newName) {
        if (!this.buffers.has(oldName)) {
            throw new Error(`Buffer '${oldName}' not found`);
        }

        if (this.buffers.has(newName)) {
            throw new Error(`Buffer '${newName}' already exists`);
        }

        const buffer = this.buffers.get(oldName);
        const doc = this.docs.get(oldName);

        buffer.name = newName;

        this.buffers.delete(oldName);
        this.docs.delete(oldName);
        this.buffers.set(newName, buffer);
        this.docs.set(newName, doc);

        if (this.currentBuffer === oldName) {
            this.currentBuffer = newName;
        }

        this.#saveToStorage();

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

    run(instructions) {
        if (typeof execute === 'function') {
            execute(this.shell, instructions);
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
