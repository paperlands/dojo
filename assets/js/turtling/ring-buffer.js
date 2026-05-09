// RingBuffer — fixed-capacity sync buffer.
// Pre-allocated array with head/tail pointers. Zero allocation on put.
// Overwrites oldest on overflow. drain() returns consumed items.

export function createRingBuffer(capacity) {
    const buf = new Array(capacity)
    let head = 0   // next write position
    let tail = 0   // next read position
    let count = 0
    let isClosed = false

    return {
        put(value) {
            if (isClosed) return
            buf[head] = value
            head = (head + 1) % capacity
            if (count < capacity) {
                count++
            } else {
                // Overflow: advance tail (oldest item lost)
                tail = (tail + 1) % capacity
            }
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
