import { createNerve } from '../nerve.js'

let nerveInstance = null

const NerveHook = {
    mounted() {
        const pushEvent = (event, payload) => this.pushEvent(event, payload)
        nerveInstance = createNerve(this.el, pushEvent)

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
