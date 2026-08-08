// Fixed-cap ring. lossless ≈ blocking channel (refuse → credit park);
// drop-oldest only for conflating traffic. (D027 R2)

export function createRingBuffer(capacity, opts = {}) {
    const lossless = opts.lossless === true
    const buf = new Array(capacity)
    let head = 0   // next write
    let tail = 0   // next read
    let count = 0
    let isClosed = false

    return {
        // false = full lossless: caller parks owing this value, retries after drain.
        put(value) {
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
        },

        // full iff put would refuse; closed is never full. (D027 R3.6)
        get full() {
            return lossless && !isClosed && count === capacity
        },

        drain() {
            if (count === 0) return []
            const items = new Array(count)
            for (let i = 0; i < count; i++) {
                items[i] = buf[(tail + i) % capacity]
                buf[(tail + i) % capacity] = null  // release reference
            }
            tail = head
            count = 0
            return items
        },

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
