// ONE doc stub for the editor tests — shaped like CM6's Text, with what the
// geometry, the law, and the fold services actually read:
//
//   lines      — the count (1..n valid, as CM6)
//   line(n)    — { number, from, to, text }, 1-indexed
//   lineAt(p)  — the SAME Line object for the line containing p
//   length     — total offset length
//
// Offsets are CUMULATIVE, one newline apart — the arithmetic CM6 uses. The nine
// hand-rolled stubs this replaces disagreed on exactly that: some used n * 1000,
// some had no lineAt, and an early version of THIS file returned a Line without
// `text` (the fold services read it, and returned null) — a faithful stub is the
// whole point, so `lineAt` is defined as `line(...)`, not as a second literal.
// (probe/keystroke-latency/REVIEW-MAINTAINABILITY.org, finding A5.)
//
// NOT a CM6 substitute: no immutability, no ChangeSet. `insertAt` below is one
// insertion's mapPos and nothing more — enough to carry the held opener across
// an edit, which is all the law asks of a transaction.

export const docOf = (lines) => {
    const starts = [];
    let pos = 0;
    for (const text of lines) { starts.push(pos); pos += text.length + 1; }

    const line = (n) => ({
        number: n,
        from: starts[n - 1],
        to: starts[n - 1] + lines[n - 1].length,
        text: lines[n - 1],
    });

    return {
        lines: lines.length,
        length: Math.max(0, pos - 1),
        line,
        lineAt: (p) => {
            let n = 1;
            while (n < starts.length && starts[n] <= p) n++;
            return line(n);
        },
    };
};

// The same shape from a source string — the tests' usual entry point.
export const docFrom = (src) => docOf(String(src ?? "").split(/\r\n|\r|\n/));

// One insertion at `at`, with ChangeSet.mapPos's assoc semantics: a position at
// the insertion point lands BEFORE the inserted text at assoc < 0 and AFTER it
// at assoc >= 0.
export const insertAt = (at, text) => ({
    mapPos: (pos, assoc = -1) => (pos < at || (pos === at && assoc < 0) ? pos : pos + text.length),
});
