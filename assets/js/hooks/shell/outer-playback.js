import { createDial } from "./dial.js"

// The registered Outer reader alone can bind this world face. (id:outer-sill-lifetime)
export function createOuterPlayback(turtle, { terminals, controls, acted }) {
    let open = true
    let current = null

    function drop() {
        const prior = current
        if (!prior) return false
        current = null
        prior.dial.close()
        return true
    }

    const off = terminals.watch(() => {
        if (current && terminals.get() !== current.mount) drop()
    })

    const port = {
        /** @param {{addr: string, mount: object, selected?: () => boolean}} target */
        bind({ addr, mount, selected = () => true }) {
            const available = () => open && addr != null && mount != null && terminals.get() === mount && selected()
            if (!available()) return null
            if (current?.mount === mount && current.addr === addr) return current.handle
            drop()
            if (!available() || current) return null

            const binding = { mount, addr }
            const standing = () => current === binding && available()
            binding.dial = createDial(turtle, {
                ...controls(() => standing() ? addr : null),
                acted,
            })
            binding.handle = {
                read: () => binding.dial.read({ passiveWhenUnauthorized: true }),
                release: () => current === binding && drop(),
            }
            current = binding
            return binding.handle
        },
    }

    return {
        port,
        ended: () => current?.dial.ended(),
        close() { open = false; off(); drop() },
    }
}
