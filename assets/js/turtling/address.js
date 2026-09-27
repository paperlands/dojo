// THE ADDRESS GRAMMAR, spelled once.
//
// The problem: three marks named a figure under three owners and no shared
// reader — parse minted `#`, queries split on `/` with its own arithmetic,
// page minted `:`. A grammar known in three places drifts in two.
//
//   addr            a buffer: `b1`, `~/meadow`, `@ada`
//   addr#cellId     a cell of that buffer (D024) — the seating law's Node
//   …/name          a frame spawned inside it (`as name do …`), nested freely
//
// Node is PLACE-FREE: the join key that pairs my cell 3 with their cell 3
// across two shells. Where a figure SHOWS is a Slot (`place:node`) — a
// different question, so a different word.

const CELL = "#"
const NEST = "/"

// A cell's frame key (D024). Seating law mints it; diagnostics address wounds to it.
export const cellKey = (addr, id) => `${addr}${CELL}${id}`

// Buffer-or-cell an address hangs from — everything before the first nest.
// `b1#2/spiral` → `b1#2`.
export const topOf = (address) => String(address ?? "").split(NEST)[0]

// Does this address belong to `seat` — the seat itself, or one of its cells?
// A sibling tab's line 7 must never leak into this buffer's ink: match the
// whole top segment, never a prefix of one.
export const isSeatOf = (address, seat) => {
    const top = topOf(address)
    return top === seat || top.startsWith(`${seat}${CELL}`)
}

// Same figure in another coordinate space: swap the seat a nested address
// hangs from, keep the rest. Slot → Node: `coreshell:b1#2/spiral` → `b1#2/spiral`.
export const rebase = (address, from, to) =>
    to === from ? address : to + String(address).slice(String(from).length)
