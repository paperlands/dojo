import { Turtle } from "../turtling/turtle.js"
import {parseProgram } from "../turtling/parse.js"

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
      // on init find the triumvirate
      const editor = this.el
      const canvas = document.getElementById('canvas');
      const output = document.getElementById('output');
      this.shell = this.initCodeMirror()

      // set up event listeners
      const debouncedRunCode = debounce(this.run, 300);

      const cachedVal = loadEditorContent()

      // init editor state
      this.shell.setValue(cachedVal);
      this.run(cachedVal, canvas);

      // start listening
      this.shell.on('change', function(cm, change) {
        const val = cm.getValue()
        saveEditorContent(val);
        debouncedRunCode(val, canvas)
      })

    },

  initCodeMirror(){

    const shell = CodeMirror.
          fromTextArea(editor, {theme: "abbott",
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
                                        return line.startsWith('#') ? line.slice(1) : '#' + line;
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
  },

  run(val, canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const turtle = new Turtle(canvas);
    const code = val;


    try {
      const commands = parseProgram(code);

      // Clear canvas
      turtle.ctx.clearRect(0, 0, canvas.width, canvas.height);
      turtle.reset();

      // Execute all instructions
      turtle.executeBody(commands, {});
      turtle.drawTurtle()

      // Display output
      output.innerHTML = `Instructions executed: ${turtle.commandCount}`;
    } catch (error) {
      output.innerHTML = `Error: ${error.message}`;
      console.error(error);
    }


  }

}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function saveEditorContent(val) {
  localStorage.setItem('@my.turtle', val);
}

function loadEditorContent() {
  return localStorage.getItem('@my.turtle') || `rt 30
jmp 200
hd
draw spiral size fo fi (
 beColour gold
 # character arc begins
 for 360/[2*4] (
  fw size
  rt 2
 )
 spiral size*[fo+fi]/fi fi fi+fo #fibo go brrr
)
spiral 1 1 1`;
}

export default Shell;
