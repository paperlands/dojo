const snippets = [
  { text: 'fw 1', displayText: 'go forward 1 unit' },
  { text: 'hd', displayText: 'hide turtle' },
  { text: 'jmp 1', displayText: 'jump by 1 unit' },
  { text: 'rt 90', displayText: 'turn right angle 90' },
  { text: 'lt 90', displayText: 'turn left angle 90 ' },
  { text: 'for 2 ()', displayText: 'repeat twice' },
];

Shell = {
    mounted() {
      let editor = this.el

      let shell = CodeMirror.fromTextArea(editor, {theme: "abbott",
                                                   mode: "apl",
                                                   lineNumbers: true,
                                                   styleActiveLine: true,
                                                   autocorrect: true,
                                                   extraKeys: {
                                                     "Ctrl-Space": function() {
                                                       snippet()
                                                     }}});

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

      // Initialise the editor with the content from the form's textarea
      // let content = sje;;.value
      // // Synchronise the form's textarea with the editor on submit
      // this.el.form.addEventListener("submit", (_event) => {
      //   textarea.value = view.state.doc.toString()
      // })
    }
  }

// define fns here
export default Shell;
