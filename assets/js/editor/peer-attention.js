// PEER ATTENTION — the watcher's side of a friend's line (D021, D023, D025).
// Writes HER copy only; nothing travels back.

// Asked at call time — a preference can change mid-session.
const stillness = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Above the window, below it, or here. null for a visible line, so the firefly
// needs no knowledge of following.
export function chaseDirection(line, first, last) {
    if (line == null || first == null || last == null) return null;
    if (line < first) return 'above';
    if (line > last) return 'below';
    return null;
}

// The box that actually scrolls — `.cm-scroller` today, but the layout permits
// `#outerenv` too. Ask freshly every call: at mount nothing overflows yet, so a
// cached answer hardens into the wrong element.
const canScroll = (el) => {
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    return /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);
};

export function scrollBoxOf(view) {
    for (let el = view?.scrollDOM; el instanceof HTMLElement; el = el.parentElement) {
        if (canScroll(el)) return el;
    }
    return view?.scrollDOM ?? null;
}

// What the watcher can SEE — not CM6's rendered viewport, which runs past both
// edges. Screen space: `lineBlockAtHeight` measures from `documentTop`.
export function visibleLines(view) {
    const box = scrollBoxOf(view);
    if (!view || view.destroyed || !box) return { first: null, last: null };
    const { doc } = view.state;
    const rect = box.getBoundingClientRect();
    const at = (screenY) => {
        try { return doc.lineAt(view.lineBlockAtHeight(screenY - view.documentTop).from).number; }
        catch { return null; }
    };
    return { first: at(rect.top), last: at(rect.bottom - 1) };
}

// FOLLOW — arrive at the friend's line. Landing the caret is the act: the cursor
// law lights their cell, the surface hands the same line to the page law. Caret
// first, then the glide — one motion, not a jump and a slide.
export function follow(view, line, opts) {
    if (!view || view.destroyed || line == null) return;
    const { doc } = view.state;
    if (line < 1 || line > doc.lines) return;
    view.dispatch({ selection: { anchor: doc.line(line).from } });
    followTo(view, line, opts);
}

// Our own animation: the browser abandons `behavior:'smooth'` on any other
// dispatch, and a friend who types always dispatches. Re-asserting scrollTop
// each frame cannot be abandoned but by us.
const glides = new WeakMap();

const easeOut = (p) => 1 - Math.pow(1 - p, 3);

function glide(box, target, quiet) {
    haltGlide(box);
    const from = box.scrollTop;
    const distance = target - from;
    const ms = stillness() ? 0 : Math.min(560, 170 + Math.abs(distance) * 0.22);
    if (!ms) { box.scrollTop = target; quiet?.(0); return; }

    // Hush the organs that READ scroll; hand back the moment we land.
    quiet?.(ms + 120);
    const t0 = performance.now();
    const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        box.scrollTop = from + distance * easeOut(p);
        if (p < 1) { glides.set(box, requestAnimationFrame(step)); return; }
        glides.delete(box);
        quiet?.(0);
    };
    glides.set(box, requestAnimationFrame(step));
}

function haltGlide(box) {
    const raf = box && glides.get(box);
    if (raf != null) { cancelAnimationFrame(raf); glides.delete(box); }
}

// The watcher's hand wins at once — an owned animation would fight their scroll.
export function haltFollow(view) {
    haltGlide(scrollBoxOf(view));
}

// The viewport half, alone — a place arriving, not a jump cut. Geometry off the
// height map (`lineBlockAt`), never `coordsAtPos`: a friend twenty screens away
// is not rendered, which is exactly when following matters.
export function followTo(view, line, { quiet } = {}) {
    if (!view || view.destroyed || line == null) return;
    const { doc } = view.state;
    if (line < 1 || line > doc.lines) return;

    const box = scrollBoxOf(view);
    if (!box) return;

    let block;
    try { block = view.lineBlockAt(doc.line(line).from); } catch { return; }
    if (!block) return;

    const rect = box.getBoundingClientRect();
    const lineTop = view.documentTop + block.top;        // their line, on screen
    const delta = (lineTop - rect.top) - (box.clientHeight - block.height) / 2;
    const target = Math.max(0, Math.min(box.scrollTop + delta,
                                        box.scrollHeight - box.clientHeight));

    // Already there — a glide restarted on every push never arrives.
    if (Math.abs(target - box.scrollTop) < 2) return;

    glide(box, target, quiet);
}

// THE FIREFLY — the edge the friend was lost past, and the way back: direction
// and distance, where a gutter mark only says "someone is on this line" about a
// line you cannot see. Click resumes (amends D021).
// The still frame the glyph hangs in: the first positioned ancestor ABOVE the
// scrolling box. Living inside the scroller was the jitter — the compositor
// scrolls, the `scroll` event lands a frame later, and a `top` chased by hand
// can only ever be one frame behind the text it is pinned against. Out here it
// simply does not move, so there is nothing left to be late.
export function anchorOf(box) {
    for (let el = box?.parentElement; el instanceof HTMLElement; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'static' && !/auto|scroll|overlay/.test(cs.overflowY)) return el;
    }
    return box ?? null;
}

export function mountChase(view, { initials = () => null, onResume } = {}) {
    let line = null;
    let dead = false;
    let host = null;              // whichever box currently owns the scrolling
    let frame = null;             // the still ancestor the glyph is hung in
    let inset = null;             // the box's edges within that frame — layout, not scroll

    // Asked at render time — the panel is a claimant projection; the name moves.
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

    // No throb nobody can see.
    const observer = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => el.classList.toggle('is-still', !entry.isIntersecting))
        : null;

    // Where the box's edges fall inside the still frame. A LAYOUT fact: it moves
    // when something resizes, never when something scrolls — so it is measured
    // on those, and never on the scroll path.
    const sizer = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => { inset = null; place(); })
        : null;

    const measure = () => {
        if (!host || !frame) return null;
        if (inset) return inset;
        const b = host.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        return (inset = { top: b.top - f.top, bottom: f.bottom - b.bottom });
    };

    const EDGE = 10;   // how far off the edge it hangs

    const place = () => {
        const at = measure();
        if (!at || !el.dataset.dir) return;
        const above = el.dataset.dir === 'above';
        el.style.top = above ? `${at.top + EDGE}px` : '';
        el.style.bottom = above ? '' : `${at.bottom + EDGE}px`;
    };

    // Which box scrolls is unknowable until there is content; re-home on change.
    const rehome = () => {
        const box = scrollBoxOf(view);
        if (!box || box === host) return host;
        observer?.disconnect();
        sizer?.disconnect();
        if (host) host.removeEventListener('scroll', onScroll);
        host = box;
        frame = anchorOf(box);
        inset = null;
        frame.appendChild(el);
        host.addEventListener('scroll', onScroll, { passive: true });
        observer?.observe(host);
        sizer?.observe(host);
        if (frame !== host) sizer?.observe(frame);
        return host;
    };

    const render = () => {
        if (dead || view.destroyed) return;
        const box = rehome();
        if (!box) return;
        const { first, last } = visibleLines(view);
        const dir = chaseDirection(line, first, last);
        el.hidden = dir == null;
        if (!dir) return;
        el.dataset.dir = dir;
        el.textContent = mark();
        place();
    };

    // A FIREFLY YOU CANNOT FIX YOUR EYE ON while the world rushes past. Fast
    // scrolling is also when `dir` flips above↔below and the glyph would jump
    // corners; fading through the rush covers that honestly instead of hiding
    // it. Out fast, back slow — settling is the part you watch.
    const RUSH = 26;          // px between events that counts as a rush
    let wasAt = null;
    let settle = null;

    function onScroll() {
        const now = host ? host.scrollTop : 0;
        if (wasAt != null && Math.abs(now - wasAt) > RUSH && !stillness()) {
            el.classList.add('is-flitting');
            clearTimeout(settle);
            settle = setTimeout(() => el.classList.remove('is-flitting'), 140);
        }
        wasAt = now;
        render();
    }

    // AROUSAL IS A VALUE, not an event: the class pins --fly-wake to 1 and the
    // CSS kindles in a breath; letting go cools it over three seconds. Every
    // sign of life re-arms the timer, so the glyph burns while they type and
    // dims when they stop — a dim glyph means a still friend.
    const QUIET_MS = 1400;
    let sleep = null;

    const stir = () => {
        if (dead || stillness()) return;
        el.classList.add('is-awake');
        clearTimeout(sleep);
        sleep = setTimeout(() => el.classList.remove('is-awake'), QUIET_MS);
    };

    return {
        stir,
        update(next) {
            const moved = next !== line;
            line = next ?? null;
            render();
            if (moved) stir();
        },
        cleanup() {
            dead = true;
            clearTimeout(sleep);
            clearTimeout(settle);
            observer?.disconnect();
            sizer?.disconnect();
            host?.removeEventListener('scroll', onScroll);
            el.remove();
        },
    };
}
