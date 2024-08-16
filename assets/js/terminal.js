export class Terminal {
    constructor(editor, CodeMirror) {
        this.editor = editor
        this.CM = CodeMirror
    }

    init() {
        const shell = this.CM.fromTextArea(
            this.editor,
            {theme: "abbott",
             mode: "apl",
             lineNumbers: true,
             styleActiveLine: true,
             autocorrect: true,
             extraKeys: {
                 "Ctrl-Space": function() {
                     snippet()
                 },
                 "Ctrl-/": function(cm) {
                     const selected = cm.getSelection();
                     if (selected) {
                         const lines = selected.split('\n');
                         const commented = lines.map(line => {
                             return line.startsWith('#') ? line.slice(1) : '# ' + line;
                         });
                         cm.replaceSelection(commented.join('\n'));
                     }
                 }
             }});

        function snippet() {
            CodeMirror.showHint(shell, function () {
                const cursor = shell.getCursor();
                const token = shell.getTokenAt(cursor);
                const start = token.start;
                const end = cursor.ch;
                const line = cursor.line;
                const currentWord = token.string;

                const list = snippets.filter(function (item) {
                    return item.text.indexOf(currentWord) >= 0;
                });

                return {
                    list: list.length ? list : snippets,
                    from: CodeMirror.Pos(line, start),
                    to: CodeMirror.Pos(line, end)
                };
            }, { completeSingle: true });
        }

        return shell

    }
}
