export class Terminal {
    constructor(editor, CodeMirror) {
        this.editor = editor;
        this.CM = CodeMirror;
        this.buffers = {}; // Store buffers
        this.currentBufferName = null; // Track the current buffer
        this.shell = null; // Store the CodeMirror instance for the terminal
    }

    init() {
        // Initialize the shell
        this.shell = this.CM.fromTextArea(this.editor, this.opts());
        this.shell.initOpts = this.opts();
        // Create the initial buffer
        return this.shell;
    }

    opts() {
        return {theme: "abbott", mode: "plang", lineNumbers: true, lineWrapping: true,
                styleActiveLine: {nonEmpty: true},
                styleActiveSelected: true,
            autocorrect: true,
            foldGutter: true,
            gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],

            extraKeys: {
                "Ctrl-Space": () => this.snippet(),
                "Ctrl-/": (cm) => this.toggleComment(cm)
            }}
    }

    openBuffer(name, text, mode) {
        if (this.buffers[name]) {
            alert("Buffer with this name already exists.");
            return;
        }

        const newDoc = this.CM.Doc(text, mode);
        this.buffers[name] = newDoc;
        this.selectBuffer(name); // Automatically select the newly created buffer

        // Update the buffer selection UI
        this.updateBufferSelectionUI(name);
    }

    updateBufferSelectionUI(name) {

    }

    selectBuffer(name) {
        if (!this.buffers[name]) {
            alert("Buffer not found.");
            return;
        }

        this.currentBufferName = name;
        const buf = this.buffers[name];
        this.shell.swapDoc(buf);
        this.shell.focus();
    }

    snippet() {
        this.CM.showHint(this.shell, () => {
            const cursor = this.shell.getCursor();
            const token = this.shell.getTokenAt(cursor);
            const start = token.start;
            const end = cursor.ch;
            const line = cursor.line;
            const currentWord = token.string;

            const list = snippets.filter(item => item.text.indexOf(currentWord) >= 0);

            return {
                list: list.length ? list : snippets,
                from: this.CM.Pos(line, start),
                to: this.CM.Pos(line, end)
            };
        }, { completeSingle: true });
    }

    toggleComment(cm) {
        const selected = cm.getSelection();
        if (selected) {
            const lines = selected.split('\n');
            const commented = lines.map(line => {
                return line.startsWith('#') ? line.slice(1) : '# ' + line;
            });
            cm.replaceSelection(commented.join('\n'));
        }
    }
}
