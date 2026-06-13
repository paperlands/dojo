import { createNerve } from '../nerve.js'

let nerveInstance = null

const NerveHook = {
    mounted() {
        const pushEvent = (event, payload) => this.pushEvent(event, payload)
        nerveInstance = createNerve(this.el, pushEvent)

        // pushEvent ↔ envelope adapter (inbound half): the envelope arrives
        // structurally whole — ts is the source's clock and rides through
        // (store.push honors it; gw-t-clock), received_at is the server's
        // annotation, ref the boundary residual.
        this.handleEvent("nerveIncoming", ({ kind, ...rest }) => {
            nerveInstance.push({ ...rest, kind: kind || "chat" })
        })
    },

    destroyed() {
        nerveInstance?.destroy()
        nerveInstance = null
    }
}

export { nerveInstance }
export default NerveHook
