// PEER ATTENTION — the watcher's side of a friend's line (D021, D023, D025).
//
// The reflect carries the document AND the coordinate the author is pointing
// at. The paint of that coordinate lives with the paint (code-cell-activation.js
// owns the cell walk and the second key). What lives HERE is the watcher's
// VIEWPORT and her consent over it:
//
//   followTo(view, line)        — the buttery move to the friend's cell
//   chaseDirection(line, a, b)  — pure: is she off the top, off the bottom, or here
//   mountChase(view, opts)      — the firefly at the edge she was lost past
//
// SIGHT, NOT POWER. Everything in this file writes the WATCHER'S OWN canvas and
// nothing else. Nothing travels back; the author never learns they are watched
// (presence is one-way). A followed peer's line seats a cell on her copy, and
// her first gesture ends it — that ending is not written here either, because
// it is already a call she makes: her reach publishes, and the surface clears
// the bit inside the callback that already exists.
//
// WHY THERE IS NO FOLLOW PLUGIN. Following is not a scroll behaviour listening
// for `wheel`/`touchmove`/`mousedown`/`keydown` and racing its own dispatch to
// decide whether a scroll was "ours". Following is WHOSE ATTENTION DRIVES THE
// VIEW — one word at the receive, and the viewport keeps exactly one writer.
// `followTo` is a move the surface makes when it already knows the answer.

// Honour the reader who asked for stillness. Read at call time, not at module
// load: a preference can change mid-session.
const stillness = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Is the friend's line above the visible window, below it, or inside?
// Pure, and the whole of the chase's logic. Returns null when there is nothing
// to chase — including when there is no line at all, which is the honest answer
// for a friend on bare code (he is making; his cells rest).
//
// Note what this cannot say while FOLLOWING: we have just moved the window onto
// his line, so it is inside, so this returns null on its own. The firefly needs
// no knowledge of consent and carries no suppression clause.
export function chaseDirection(line, first, last) {
    if (line == null || first == null || last == null) return null;
    if (line < first) return 'above';
    if (line > last) return 'below';
    return null;
}

// The lines at the top and bottom of what the reader can actually SEE — not
// CM6's rendered viewport, which runs past both edges. The same geometry read
// reach.js makes for the eyeline, and for the same reason: the visible window
// is a fact about the scroller, not about the render.
export function visibleLines(view) {
    if (!view || view.destroyed) return { first: null, last: null };
    const { doc } = view.state;
    const at = (h) => {
        try { return doc.lineAt(view.lineBlockAtHeight(h).from).number; } catch { return null; }
    };
    const top = view.scrollDOM.scrollTop;
    return { first: at(top), last: at(top + view.scrollDOM.clientHeight - 1) };
}

// Mark a view's scroller as one that moves smoothly. `scroll-behavior` applies
// to PROGRAMMATIC scrolling only — the reader's own wheel, touch and scrollbar
// stay native and instant — so this buys the butter without putting a hand
// anywhere near her input.
//
// Doing it in CSS rather than in geometry is the point: it lets `followTo` hand
// the whole scroll to CM6, which already knows where the line is, how tall the
// gutter is, which box actually scrolls, and what to do about a line it has not
// rendered. Every one of those is a thing a hand-rolled `scrollTo` gets wrong.
// `prefers-reduced-motion` is honoured in the stylesheet, so there is no branch.
export function scrollsSmoothly(view) {
    view?.scrollDOM?.classList.add('cm-follows-smoothly');
}

// Move the watcher's window onto the friend's line — a place arriving, not a
// jump cut.
//
// THE VIEWPORT ONLY. Never the selection and never the focus: her cursor is
// hers, and taking it is the difference between sight and power. (nerve's
// scrollToLine does move both — that is the child navigating her OWN signal, a
// different act with the same shape.)
export function followTo(view, line, cm6) {
    if (!view || view.destroyed || line == null || !cm6) return;
    const { doc } = view.state;
    if (line < 1 || line > doc.lines) return;
    view.dispatch({
        effects: cm6.EditorView.scrollIntoView(doc.line(line).from, { y: 'center' }),
    });
}

// THE FIREFLY — where she was lost past.
//
// D021 asked for a gutter marker; a gutter says "a peer is somewhere on this
// line" to a reader who cannot see the line. A glyph at the edge she left them
// past, drifting and throbbing when they move, says DIRECTION and DISTANCE as a
// living thing. Click it and following resumes — which is why the chase exists
// at all: without it, her first gesture is a door that only closes.
//
// Returns { update, cleanup }. `update(line)` is the one input; everything else
// is derived from the scroller.
export function mountChase(view, { initials = () => null, onResume } = {}) {
    let line = null;
    let dead = false;

    // Who, in two letters. Asked at render time, not captured: the panel is a
    // claimant projection and the friend it names can change under it.
    const mark = () => (initials() || '·').trim().slice(0, 2) || '·';

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cm-peer-firefly';
    el.hidden = true;
    el.title = 'Follow along';
    el.addEventListener('click', (e) => {
        e.preventDefault();
        onResume?.(line);
    });
    view.dom.appendChild(el);

    // Stop the animation when the panel is not on screen — a throb nobody can
    // see is a compositor layer nobody asked for.
    const observer = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => el.classList.toggle('is-still', !entry.isIntersecting))
        : null;
    observer?.observe(view.dom);

    const render = () => {
        if (dead || view.destroyed) return;
        const { first, last } = visibleLines(view);
        const dir = chaseDirection(line, first, last);
        el.hidden = dir == null;
        if (dir) {
            el.dataset.dir = dir;
            el.textContent = mark();
        }
    };

    const onScroll = () => render();
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });

    return {
        // The friend moved (or left). `fresh` throbs the glyph once, so distance
        // reads as liveness rather than as a static badge.
        update(next) {
            const moved = next !== line;
            line = next ?? null;
            render();
            if (moved && !el.hidden && !stillness()) {
                el.classList.remove('is-fresh');
                void el.offsetWidth;              // restart the animation
                el.classList.add('is-fresh');
            }
        },
        cleanup() {
            dead = true;
            observer?.disconnect();
            view.scrollDOM.removeEventListener('scroll', onScroll);
            el.remove();
        },
    };
}
