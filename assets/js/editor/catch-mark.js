// The number is the breakpoint. The line wash only arrives on an actual catch.
export function createCatchMark({ Decoration, EditorView, StateEffect, StateField, GutterMarker, gutter }, choose) {
    if (![Decoration, EditorView, StateEffect, StateField, GutterMarker, gutter]
        .every(api => typeof api === 'function' || typeof api === 'object' && api != null)) {
        return { extension: [], paint() {} }
    }
    const set = StateEffect.define()
    const field = StateField.define({
        create: () => null,
        update(mark, tr) {
            if (tr.docChanged) mark = null
            for (const effect of tr.effects) if (effect.is(set)) mark = effect.value
            return mark
        },
        provide: field => EditorView.decorations.compute([field], state => {
            const mark = state.field(field)
            return mark?.state === 'hit' ? Decoration.set([Decoration.line({ class: 'cm-catch-flash' }).range(mark.from)]) : Decoration.none
        }),
    })
    class NumberMark extends GutterMarker {
        constructor(number, state) {
            super()
            this.number = number
            this.state = state
            this.elementClass = state ? `cm-catch-${state}` : ''
        }
        eq(other) { return this.number === other.number && this.state === other.state }
        toDOM() {
            const el = document.createElement('span')
            el.textContent = String(this.number)
            if (this.state === 'unavailable') el.title = 'No catchable command on this line'
            return el
        }
        eq(other) { return this.number === other.number && this.elementClass === other.elementClass }
        toDOM() { return document.createTextNode(String(this.number)) }
    }
    const spacer = view => new NumberMark(view.state.doc.lines, null)
    return {
        extension: [field, gutter({
            class: 'cm-lineNumbers cm-catchNumbers',
            initialSpacer: spacer,
            updateSpacer: (prev, update) => prev.number === update.state.doc.lines ? prev : spacer(update.view),
            lineMarker: (view, block) => {
                const mark = view.state.field(field)
                const active = mark?.from === block.from
                return new NumberMark(view.state.doc.lineAt(block.from).number, active ? mark.state : null)
            },
            lineMarkerChange: u => u.docChanged || u.startState.field(field) !== u.state.field(field),
            domEventHandlers: {
                mousedown: (view, block, e) => {
                    if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false
                    // Not a caret. Focusing can edit the page under the catch.
                    e.preventDefault()
                    return choose(view, view.state.doc.lineAt(block.from).number)
                },
            },
        })],
        paint(view, line, state = 'armed') {
            if (!view || view.destroyed) return
            const old = view.state.field(field, false)
            const next = line > 0 && line <= view.state.doc.lines ? { from: view.state.doc.line(line).from, state } : null
            if (old === undefined || (old?.from === next?.from && old?.state === next?.state)) return
            view.dispatch({ effects: set.of(next) })
        },
    }
}
