// Fixed-cap ring of credit cells. lossless refuses when full;
// drop-oldest only for conflating traffic. (D027 R2)

class Pair {
    constructor(first, second) { this.first = first; this.second = second }
}

export function createRingBuffer(capacity, opts = {}) {
    const lossless = opts.lossless === true
    const buf = new Array(capacity)
    let head = 0   // next write
    let tail = 0   // next read
    let count = 0
    let isClosed = false

    function put(value) {
        if (isClosed) return true
        if (count === capacity && lossless) return false
        buf[head] = value
        head = (head + 1) % capacity
        if (count < capacity) {
            count++
        } else {
            tail = (tail + 1) % capacity  // drop-oldest
        }
        return true
    }

    return {
        // false = full lossless: caller parks owing this value, retries after drain.
        put,

        // One credit cell, at most two values; drain preserves the flat vocabulary.
        // Clear + replacement must arrive together. (id:output-ledger-replacement-credit)
        putPair(first, second) {
            if (isClosed) return true
            if (count === capacity && lossless) return false
            return put(new Pair(first, second))
        },

        // full iff put would refuse; closed is never full. (D027 R3.6)
        get full() {
            return lossless && !isClosed && count === capacity
        },

        drain() {
            if (count === 0) return []
            const items = new Array(count)
            let n = 0
            for (let i = 0; i < count; i++) {
                const value = buf[(tail + i) % capacity]
                if (value instanceof Pair) {
                    items[n++] = value.first
                    items[n++] = value.second
                } else {
                    items[n++] = value
                }
                buf[(tail + i) % capacity] = null  // release reference
            }
            tail = head
            count = 0
            return items
        },

        // Occupancy counts cells, not values expanded from fixed pairs.
        get length() {
            return count
        },

        close() {
            isClosed = true
        },

        get closed() {
            return isClosed
        }
    }
}
