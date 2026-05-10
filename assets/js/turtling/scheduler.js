// Scheduler — cooperative per-tick generator walker.
// Wraps an executor generator with time-based scheduling.
// Single-ambient (Phase 5a). Tree walk deferred to 5b.
//
// tick(now) advances the generator until a wait event or done,
// writing all produced events to the channel (RingBuffer).
// The compositor drains the channel through the materializer.

import { createRingBuffer } from "./ring-buffer.js"

export function createScheduler(generator, opts = {}) {
    const channel = createRingBuffer(opts.channelCapacity || 4096)

    return {
        generator,
        channel,
        resumeAt: 0,
        done: false,
        commandCount: 0,

        // Advance the generator until it yields a wait or exhausts.
        // All non-wait events are written to the channel.
        // Returns true if new events were produced this tick.
        tick(now) {
            if (this.done || this.resumeAt > now) return false

            let produced = false

            while (!this.done) {
                const { value, done } = this.generator.next()

                if (done) {
                    this.done = true
                    this.commandCount = value || 0
                    this.channel.close()
                    break
                }

                if (value.type === "wait") {
                    this.resumeAt = now + value.duration
                    // Emit a head snapshot at the wait boundary so the
                    // compositor can update head position mid-animation
                    if (value.position) {
                        this.channel.put({
                            type: "head",
                            position: value.position,
                            rotation: value.rotation,
                            color: value.color,
                            headSize: value.headSize
                        })
                    }
                    produced = true
                    break
                }

                this.channel.put(value)
                produced = true
            }

            return produced
        }
    }
}
