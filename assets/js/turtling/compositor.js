// Compositor — drains scheduler channel through materializer per frame.
// Replaces renderIncremental + drawPaths 
//
// compositorFrame() is the render loop callback. Each animation frame:
// 1. Tick the scheduler (advance generator, fill channel)
// 2. Drain the channel
// 3. Materialize each event into the scene
// 4. Render the scene
// 5. Manage head scale, snapshot, recording lifecycle

import { materialize } from "./materializer.js"

// Create a compositor bound to a scheduler and stage infrastructure.
//
// stage   = { scene, camera, renderer, controls, head, recorder, renderstate, hatch }
// groups  = { pathGroup, gridGroup, glyphGroup }
// ctx     = { shapist, head, camera, controls }
export function createCompositor(scheduler, groups, ctx, stage) {
    let snapshotPending = false

    function drainAndMaterialize() {
        const events = scheduler.channel.drain()
        for (const event of events) {
            materialize(event, groups, ctx)
        }
        return events.length > 0
    }

    return {
        scheduler,

        // Eagerly drain a batch program (no waits) during draw().
        // Returns true if the scheduler completed entirely.
        flush() {
            scheduler.tick(0)
            drainAndMaterialize()
            return scheduler.done
        },

        // Called by the render loop every animation frame.
        // `t` is milliseconds since the render loop started.
        frame(t) {
            try {
                // 1. Tick the scheduler — advances generator, fills channel
                if (!scheduler.done) {
                    scheduler.tick(t)
                    drainAndMaterialize()
                }

                // 2. Head scale (distance-invariant sizing)
                const scaleFactor = ctx.camera.position.distanceTo(ctx.head.position()) / 250
                ctx.head.scale(scaleFactor)

                // 3. Render
                ctx.controls.update()
                stage.renderer.render(stage.scene, ctx.camera)

                // 4. Recording
                if (stage.recorder.isRecording) {
                    stage.recorder.captureFrame()
                }

                // 5. Snapshot — after first meaningful content or when done
                if (stage.renderstate.snapshot.frame == null && t > 500) {
                    stage.hatch()
                }

                if (scheduler.done && !snapshotPending) {
                    snapshotPending = true
                    // Hatch synchronously — the drawing buffer is only valid
                    // in the same frame as renderer.render(). Without
                    // preserveDrawingBuffer, deferring via RAF reads cleared data.
                    stage.hatch()
                }
            } catch (error) {
                console.error('Compositor frame error:', error)
            }
        }
    }
}
