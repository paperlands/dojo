// =============================================================================
// SHELL LIFECYCLE — the law of the boot seam
// (test/js/shell/lifecycle_test.mjs).
//
// The problem: LiveView mounts the hook, then the SAME task dispatches the
// reply's push_events as window CustomEvents — but our boot is async (CM6
// import). Two windows open between those facts:
//
//   booting — mounted, surface not yet standing. Every event the surface
//             declares is registered HERE, synchronously, BEFORE the first
//             await. A listener added after the dispatch never hears the
//             events that rode the very diff that mounted us (empty-
//             outershell drop). Payloads queue until live.
//   live    — boot resolved, surface mounted, queue drained in arrival order.
//   dead    — destroyed() ran. A boot still in flight stands down instead of
//             zombie-mounting over a torn-down hook (leaked listeners, nerve
//             claims, Terminals on detached elements).
//
// THE DOOR IS WINDOW, NOT "SERVER ONLY." LiveView's handleEvent is exactly
// window.addEventListener("phx:"+name, e => cb(e.detail)). Origins may be
// server push_event, client window.dispatchEvent / dispatchPhx (weave local
// open), or Elixir JS.dispatch (close_js → body; bubbles defaults true so
// it reaches window). This file owns WHEN we register; origin does not
// matter. A LV upgrade that moves that listener is a silent break — pin
// it in lifecycle_test (the window-dispatch bridge).
//
// LIVENESS IS THE HOOK'S ARENA, and nothing else. A `dead` flag here and an
// `alive` region there meant every async continuation asked whichever its
// author remembered. The surface's arena is adopted into the hook's — one
// destroy ends one lifetime; `hook.arena.alive` is the only question.
//
// Surfaces are data: { events: [names], mount(hook, boot) →
// { events: {name: handler}, arena, birth? } }. This file owns registration
// timing only. What events mean belongs to the surfaces; when each organ
// releases belongs to the arena it registered on — release where made, so
// teardown is reverse-of-creation with no ordered list to get wrong.
//
// BIRTH is the one construction order this file can hold: a surface's first
// breath must reach organs that ALL stand. Named as a phase — after mount
// returns, before the boot queue drains. Once a trailing block three hundred
// lines below the organ it ticked.
//
// RECONNECTED is not a second path. LiveView calls reconnected() when the
// socket returns; the surface says the same sentence birth said (id:kb-9) —
// announce, don't ask. A surface with nothing to re-announce is a no-op.
// =============================================================================

import { createArena } from "../../kernel/arena.js";

export function makeShellHook({ boot, surfaces }) {
    return {
        mounted() {
            this.arena = createArena();
            this.surface = null;
            const pending = [];
            // data-target IS the surface's name — the key, not a value to
            // branch on. An unknown target is a fault, never a default.
            const target = this.el.dataset.target;
            const program = surfaces[target];
            if (!program) {
                console.error(`Shell: no surface for data-target="${target}"`);
                this.arena.destroy();   // nothing will ever stand here
                return;
            }

            // Synchronous registration — nothing may be awaited above this
            // loop, or the mount-patch events are lost.
            for (const name of program.events) {
                this.handleEvent(name, (payload) => {
                    if (!this.arena.alive) return;
                    if (this.surface) this.surface.events[name](payload);
                    else pending.push([name, payload]);
                });
            }

            boot(this).then((booted) => {
                if (!booted || !this.arena.alive) return;
                this.surface = program.mount(this, booted);
                this.arena.add(() => this.surface.arena.destroy());
                // The room is whole — now it may speak, and only now.
                this.surface.birth?.();
                for (const [name, payload] of pending) {
                    this.surface.events[name](payload);
                }
                pending.length = 0;
            }).catch((err) => console.error("Shell boot failed:", err));
        },

        // Same sentence as birth — no reconnect path to get wrong (id:kb-9).
        reconnected() {
            if (!this.arena?.alive) return;
            this.surface?.reconnected?.();
        },

        destroyed() {
            this.arena?.destroy();
            this.term?.destroy();
        }
    };
}
