import { execute } from "./terminal/operations.js"

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
        // init listeners
        this.shell.on("gutterClick", function(cm, n) {
            cm.focus()
            cm.setSelection({line: n, ch: 0}, {line: n, ch: 100});

        });

        this.shell.cached = this.loadEditorContent()

        this.openBuffer("~", this.shell.cached , "plang")
        this.shell.run = this.run.bind(this)
        // Create the initial buffer
        return this.shell;
    }

    opts() {
        return {theme: "everforest", mode: "plang", lineNumbers: true, lineWrapping: true,
                styleActiveLine: {nonEmpty: true},
                styleActiveSelected: true,
                autocorrect: true,
                foldGutter: true,
                matchBrackets: {
                    enableWordMatching: true,  // Enable do-end matching (default: true)
                    highlightNonMatching: true,
                    maxScanLines: 1000
                },
            smartIndent: true,
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

    run(instructions) {
        execute(this.shell, instructions)
    }

    loadEditorContent() {
        return localStorage.getItem('@my.turtle') || `
draw spiral size fo fi do
 # character arc begins
 for 360/[2*4] do
  fw size
  rt 2
  wait 1/36
 end
 spiral size*[fo+fi]/fi fi fi+fo #fibo go brrr
end
hd
spiral 1 1 1`;
    }

}
