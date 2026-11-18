// The shell is offline-first: what matters is not "is a page loading" but "can
// the socket carry a frame". Two truths, no probe and no timer — the socket's
// own lifecycle is when the answer changes (heartbeatIntervalMs in app.js is
// what makes a frozen server show up in ~10s rather than a minute).
const LABEL = { online: "connected", connecting: "reaching the shell", offline: "offline" }
// One tick per heartbeat: the same clock that decides liveness, so the lamp can
// never be more than one heartbeat stale even if a socket callback is missed.
// The callbacks below still paint immediately; this is the floor, not the signal.
const TICK_MS = 5000

function socket() {
    try {
        return (window.liveSocket && window.liveSocket.socket) || null
    } catch (_) {
        return null
    }
}

function socketUp() {
    try {
        return !!(window.liveSocket && window.liveSocket.isConnected && window.liveSocket.isConnected())
    } catch (_) {
        return false
    }
}

export const ConnectionDot = {
    mounted() {
        this.paint = () => {
            const state =
                typeof navigator !== "undefined" && navigator.onLine === false
                    ? "offline"
                    : socketUp()
                      ? "online"
                      : "connecting"
            if (this.el.dataset.conn === state) return
            this.el.dataset.conn = state
            this.el.setAttribute("aria-label", LABEL[state])
            // Mirror to the root so chrome can react to the line, not just the
            // lamp: LiveView 1.x has no phx-disconnected CLASS (only the JS
            // commands), so anything keyed on it was dead.
            document.documentElement.dataset.conn = state
        }

        this.paint()
        // navigator fires these; LiveView fires nothing for connect/disconnect,
        // so wrap the socket's own callbacks instead of polling it.
        window.addEventListener("online", this.paint)
        window.addEventListener("offline", this.paint)
        window.addEventListener("phx:page-loading-stop", this.paint)

        this.timer = setInterval(this.paint, TICK_MS)

        const live = socket()
        if (live) {
            this.live = live
            this.prevOpen = live.onOpen
            this.prevClose = live.onClose
            live.onOpen = (event) => {
                if (this.prevOpen) this.prevOpen(event)
                this.paint()
            }
            live.onClose = (event) => {
                if (this.prevClose) this.prevClose(event)
                // The socket closes before isConnected() reads false; let the
                // close settle one task before reading it.
                setTimeout(this.paint, 0)
            }
        }
    },

    destroyed() {
        window.removeEventListener("online", this.paint)
        window.removeEventListener("offline", this.paint)
        window.removeEventListener("phx:page-loading-stop", this.paint)
        clearInterval(this.timer)

        if (this.live) {
            this.live.onOpen = this.prevOpen
            this.live.onClose = this.prevClose
        }
    },
}
