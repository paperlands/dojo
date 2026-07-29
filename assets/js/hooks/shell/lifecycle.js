// =============================================================================
// SHELL LIFECYCLE — the pure law of the boot seam (zero imports, node-tested
// in test/js/shell_lifecycle_test.mjs).
//
// LiveView's hook contract is synchronous: the patch mounts the hook, then the
// SAME task dispatches the reply's push_events as window CustomEvents. Our boot
// is async (the CM6 dynamic import). Between those two facts lie two windows
// this state machine names and closes:
//
//   booting — mounted, surface not yet standing. Every event the surface
//             declares is registered here, synchronously, BEFORE the first
//             await — a listener added after the dispatch never hears the
//             events that rode the very diff that mounted us (the
//             empty-outershell drop). Payloads queue until live.
//   live    — boot resolved, surface mounted, queue drained in arrival order;
//             events flow straight through.
//   dead    — destroyed() ran. A boot still in flight stands down (boot
//             resolves null, or the dead flag catches it) instead of
//             zombie-mounting over a torn-down hook — that leaked document
//             listeners, nerve claims, and Terminals on detached elements.
//
// Surfaces are data to this machine: { events: [names], mount(hook, boot) →
// { events: {name: handler}, cleanup: [fns] } }. Registration timing is this
// file's one job; what the events mean belongs to the surfaces.
// =============================================================================

export function makeShellHook({ boot, surfaces }) {
    return {
        mounted() {
            this.dead = false;
            this.surface = null;
            const pending = [];
            // data-target selects the surface program: "outer" | "weave" |
            // anything else (incl. "core") is the inner canvas.
            const target = this.el.dataset.target;
            const program = target === "outer" ? surfaces.outer
                : target === "weave" ? surfaces.weave
                : surfaces.inner;
            if (!program) {
                console.error(`Shell: no surface for data-target="${target}"`);
                return;
            }

            // Synchronous registration — nothing may be awaited above this
            // loop, or the mount-patch events are lost.
            for (const name of program.events) {
                this.handleEvent(name, (payload) => {
                    if (this.dead) return;
                    if (this.surface) this.surface.events[name](payload);
                    else pending.push([name, payload]);
                });
            }

            boot(this).then((booted) => {
                if (!booted || this.dead) return;
                this.surface = program.mount(this, booted);
                for (const [name, payload] of pending) {
                    this.surface.events[name](payload);
                }
                pending.length = 0;
            }).catch((err) => console.error("Shell boot failed:", err));
        },

        destroyed() {
            this.dead = true;
            // LIFO — reverse registration order (kernel/arena invariant 3).
            // A later organ may hold a listener on an element an earlier organ
            // made; tearing down forward releases the element while the
            // listener still points at it.
            const clean = this.surface?.cleanup;
            if (clean) {
                for (let i = clean.length - 1; i >= 0; i--) clean[i]();
            }
            this.term?.destroy();
        }
    };
}
