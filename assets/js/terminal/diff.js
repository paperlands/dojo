// Line-level Myers diff → CM6 ChangeSpec[].
// Zero imports. Zero side effects. Pure function.
//
// Returns ChangeSpec[] compatible with CM6 dispatch, or null if identical.
// Line granularity: split on \n, diff lines, map back to char offsets.
// Produces multiple ChangeSpecs for scattered edits — cursor preserved at each.

export const computeChanges = (oldText, newText) => {
    if (oldText === newText) return null;

    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    const edits = myersDiff(oldLines, newLines);
    if (edits.length === 0) return null;

    // Convert line edits → char offset ChangeSpecs
    const changes = [];
    // Build line offset table for old text
    const offsets = lineOffsets(oldText, oldLines.length);

    for (const edit of edits) {
        const from = offsets[edit.oldStart];
        // 'to' is the end of the last removed line (including its \n),
        // or equals 'from' for pure insertions
        let to = from;
        if (edit.oldCount > 0) {
            const lastRemovedLine = edit.oldStart + edit.oldCount - 1;
            to = lastRemovedLine + 1 < offsets.length
                ? offsets[lastRemovedLine + 1]
                : oldText.length;
        }

        let insert = edit.newLines.join('\n');
        // If we're replacing lines that had a trailing \n, add one after insert
        if (edit.oldCount > 0 && to > from && insert.length > 0) {
            if (to <= oldText.length && oldText[to - 1] === '\n') {
                insert += '\n';
            }
        } else if (edit.oldCount === 0 && insert.length > 0) {
            // Pure insertion: add \n separator
            insert += '\n';
        }

        changes.push({ from, to, insert });
    }

    return changes.length > 0 ? changes : null;
};

// Build char offset for each line index. offsets[i] = char position of line i start.
const lineOffsets = (text, lineCount) => {
    const offsets = new Array(lineCount + 1);
    offsets[0] = 0;
    let pos = 0;
    for (let i = 0; i < lineCount; i++) {
        const nl = text.indexOf('\n', pos);
        offsets[i] = pos;
        pos = nl === -1 ? text.length : nl + 1;
    }
    offsets[lineCount] = text.length;
    return offsets;
};

// Myers diff on line arrays. Returns list of edit hunks:
//   { oldStart, oldCount, newStart, newCount, newLines: string[] }
// Grouped into contiguous hunks for minimal ChangeSpec count.
const myersDiff = (oldLines, newLines) => {
    const N = oldLines.length;
    const M = newLines.length;
    const MAX = N + M;

    if (MAX === 0) return [];

    // Forward pass — find shortest edit script
    const vSize = 2 * MAX + 1;
    const v = new Int32Array(vSize);
    const trace = [];

    for (let d = 0; d <= MAX; d++) {
        const snap = new Int32Array(v);
        trace.push(snap);

        for (let k = -d; k <= d; k += 2) {
            const kIdx = k + MAX;
            let x;
            if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
                x = v[kIdx + 1]; // move down
            } else {
                x = v[kIdx - 1] + 1; // move right
            }
            let y = x - k;

            // Follow diagonal (matching lines)
            while (x < N && y < M && oldLines[x] === newLines[y]) {
                x++; y++;
            }

            v[kIdx] = x;

            if (x >= N && y >= M) {
                return backtrack(trace, oldLines, newLines, N, M, MAX);
            }
        }
    }

    return []; // unreachable for valid input
};

// Backtrack through trace to extract edit hunks
const backtrack = (trace, oldLines, newLines, N, M, MAX) => {
    const rawEdits = []; // individual: { type: 'del'|'ins', oldIdx, newIdx }
    let x = N, y = M;

    for (let d = trace.length - 1; d > 0; d--) {
        const v = trace[d - 1];
        const k = x - y;
        const kIdx = k + MAX;

        let prevK;
        if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
            prevK = k + 1; // came from down
        } else {
            prevK = k - 1; // came from right
        }

        const prevX = v[prevK + MAX];
        const prevY = prevX - prevK;

        // Diagonal
        while (x > prevX + (prevK < k ? 1 : 0) && y > prevY + (prevK < k ? 0 : 1)) {
            x--; y--;
        }

        if (prevK < k) {
            // Deletion: moved right
            rawEdits.push({ type: 'del', oldIdx: prevX, newIdx: prevY });
        } else {
            // Insertion: moved down
            rawEdits.push({ type: 'ins', oldIdx: prevX, newIdx: prevY });
        }

        x = prevX;
        y = prevY;
    }

    rawEdits.reverse();
    return groupEdits(rawEdits, oldLines, newLines);
};

// Group adjacent raw edits into hunks
const groupEdits = (rawEdits, oldLines, newLines) => {
    if (rawEdits.length === 0) return [];

    const hunks = [];
    let i = 0;

    while (i < rawEdits.length) {
        const edit = rawEdits[i];
        let oldStart, oldCount = 0, newStart, newCount = 0;
        const newLinesArr = [];

        if (edit.type === 'del') {
            oldStart = edit.oldIdx;
            newStart = edit.newIdx;
        } else {
            oldStart = edit.oldIdx;
            newStart = edit.newIdx;
        }

        // Consume contiguous edits at the same position
        while (i < rawEdits.length) {
            const e = rawEdits[i];
            // Check adjacency: edits are contiguous if they touch the current hunk
            const curOldEnd = oldStart + oldCount;
            const curNewEnd = newStart + newCount;

            if (e.type === 'del' && e.oldIdx <= curOldEnd && e.newIdx <= curNewEnd) {
                oldCount++;
                i++;
            } else if (e.type === 'ins' && e.oldIdx <= curOldEnd && e.newIdx <= curNewEnd) {
                newLinesArr.push(newLines[e.newIdx]);
                newCount++;
                i++;
            } else {
                break;
            }
        }

        hunks.push({ oldStart, oldCount, newStart, newCount, newLines: newLinesArr });
    }

    return hunks;
};
