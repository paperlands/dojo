// Mount-patch events arrive before async boot. Ingest now; deliver after birth.
// The installation owns resources at acquisition, not at mount return. (id:shell-installation)
import { createArena } from "../../kernel/arena.js";

export function makeShellHook({ boot, surfaces }) {
    return {
        mounted() {
            const arena = this.arena = createArena();
            this.surface = null;
            let pending = [];
            arena.add(() => { pending = null; this.surface = null; });

            const target = this.el.dataset.target;
            const program = Object.hasOwn(surfaces, target) ? surfaces[target] : null;
            if (!program) {
                console.error(`Shell: no surface for data-target="${target}"`);
                arena.destroy();
                return;
            }

            const fail = (error) => {
                if (!arena.alive) return;
                arena.destroy();
                console.error("Shell installation failed:", error);
            };

            const receive = (name, payload) => {
                if (!arena.alive) return;
                if (pending) {
                    // Reserve the position before ingestion can dispatch another arrival.
                    pending.push([name, payload]);
                    try { program.arrive?.(name, payload, this); }
                    catch (error) { fail(error); }
                    return;
                }
                program.arrive?.(name, payload, this);
                if (arena.alive) this.surface.events[name](payload);
            };

            const activate = (booted) => {
                if (!arena.alive) return;
                if (booted == null) { arena.destroy(); return; }

                const surface = program.mount(this, booted);
                if (!arena.alive) return;
                if (surface.arena?.alive === false) { arena.destroy(); return; }
                for (const name of program.events) {
                    if (typeof surface.events?.[name] !== "function") {
                        throw new TypeError(`Shell ${target}: no handler for ${name}`);
                    }
                }
                surface.birth?.();
                // Birth and handlers can dispatch or destroy. New arrivals join the tail.
                for (let i = 0; arena.alive && i < pending.length; i++) {
                    const [name, payload] = pending[i];
                    surface.events[name](payload);
                }
                if (!arena.alive) return;
                pending = null;
                this.surface = surface;
            };

            const install = async () => {
                try {
                    program.acquire?.(this);
                    for (const name of program.events) {
                        if (!arena.alive) return;
                        const ref = this.handleEvent(name, (payload) => receive(name, payload));
                        const off = () => this.removeHandleEvent?.(ref);
                        if (!arena.alive) { off(); return; }
                        arena.add(off);
                    }
                    if (arena.alive) activate(await boot(this));
                } catch (error) {
                    fail(error);
                }
            };
            void install();
        },

        reconnected() {
            if (this.arena?.alive) this.surface?.reconnected?.();
        },

        destroyed() {
            this.arena?.destroy();
        },
    };
}
