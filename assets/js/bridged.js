/**
 * BridgedEventTarget can receive events and push to events that have
 * listen to itself (ref EventTarget interface: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)
 *
 * BridgedEventTarget is essential in the brokering of turtle states on the client side to the server key
 * for the multiplayer env
 * */

class BridgedEventTarget extends EventTarget {}

/**
 * Returns event-handling functions corresponding to the given eventName / topic,
 * which allows others to subscribe/publish to this topic, or to dispatch events (to the server)
 * using this EventTarget as a proxy.
 * */
/**
 * @typedef {Object} Bridge
 * @property {(callback: function(*): void) => function(): void} sub - Subscribe; returns unsub fn
 * @property {(payload: *) => void} pub - Publish payload to all subscribers
 * @property {(el: {pushEvent: Function, pushEventTo: Function}, payload: *, selector?: string) => void} dispatch - Pub + pushEvent to server
 */

/**
 * @param {string} eventName - Topic name for this bridge
 * @returns {Bridge}
 */
export const bridged = (eventName) => { // TODO: consider renaming to registerBridgeEvent
    const customEventTarget = new BridgedEventTarget();

    /**
     * Registers the given callback to the custom event and
     * returns a callback (nullary function) that can be used to de-register (undo) this registration.
     * In order to stop listening to events published by this custom event target, one may
     * call this nullary function.
     * */
    // No console.log on the hot path: every keystroke pubs terminal content
    // (and often selection + turtle). Logging full payloads cost ~4ms/key and
    // ~2.8× longtask total under DevTools (specs/weave/typing-path.org).
    const sub = (callback) => {
        const EventHandler = (event) => {
            const data = event.detail ;

            callback(data);
        };

        customEventTarget.addEventListener(eventName, EventHandler);

        return () => {
            customEventTarget.removeEventListener(eventName, EventHandler);
        };
    };

    /**
     * Publishes a payload on this eventName topic via the detail attribute of
     * a custom event, using the custom event target as a proxy.
     * */
    const pub = (payload)  => {
        const event = new CustomEvent(eventName, { detail: payload })
        customEventTarget.dispatchEvent(event);
    };

    /**
     * Given a payload, publishes it on its topic and also pushes
     * a server-side event to the LiveView.
     *
     * Preconditions:
     * - if selector has been provided, then it's assumed to be a valid dom selector that can be queried.
     * */
    const dispatch = (el, payload, selector=null) => {
        pub(payload)
        // customEventTarget.dispatchEvent(new CustomEvent(eventName, { detail: data }));
        const isTargettedDispatch = !!selector
        if(isTargettedDispatch) {
            el.pushEventTo(selector, eventName, payload)
        } else {
            el.pushEvent(eventName, payload);
        }
    }

    return { sub, pub, dispatch };
};


export const cameraBridge = bridged("cam");
export const sceneBridge = bridged("scene");

/**
 * scene — the vocabulary of the scene bridge, and the DECLARED ADAPTER
 * between the signal envelope and the bridge's [type, payload] tuple wire
 * shape (groundwork.org Phase 3: every seam one named adapter, never a
 * reconstruction). Callers speak named moves; these constructors enforce the
 * tuple (mirrors the `signals` constructors in nerve/store.js). A typo
 * becomes a missing method, not a silently-ignored event. Subscribers still
 * switch on the tuple's first element.
 *
 * Surfaces speak four: observe · attend · remove · restore (+ fork/landed).
 * focus died with the world sentinel — a click is attend (light-ladders-cut4).
 * The `ambient`/`ambientStop` aliases died with their last caller.
 */
export const scene = {
    remove:      (ambientId)        => sceneBridge.pub(['remove', { ambientId }]),
    fork:        (payload)          => sceneBridge.pub(['fork', payload]),
    // Live draft / hatch at (self, outershell) — place is fixed in the surface.
    observe:     (addr, name, code) => sceneBridge.pub(['observe', { addr, name, code }]),
    // Draft frozen: drop outershell draft; optional name/code re-seats peer.
    restore:     (addr, opts = {})  => sceneBridge.pub(['restore', { addr, ...opts }]),
    // Cursor-gate across the seam: where the reader IS, as (page addr, LINE) —
    // one datum, because attention is the address (D021). Never an ordinal:
    // that would make reach resolve "which cell" itself, and a cell inserted
    // above would silently re-aim the answer. Line is the address; page law
    // owns the resolution. `null` = out on bare code, every cell rests.
    //
    // WHOSE reach this is — and that is the whole of it. It was `follow: bool`,
    // which outer could only set by first asking the law "do I hold the light?"
    // — a read-then-write on the same authority. The witness answers both at
    // once: mine claims the place; theirs is presence (P9).
    attend:      (addr, line, opts = {}) =>
        sceneBridge.pub(['attend', { addr, line, witness: opts.witness ?? 'self' }]),
    // attend's dual: where the ladder LANDED, when that is not where the organ
    // pointed. Rides back, not as a canvas effect — input organ belongs to the
    // surface that owns the cursor.
    landed:      (addr, line)       => sceneBridge.pub(['landed', { addr, line }]),
    // A watched friend's shouts are NOT relayed over a scene channel — they
    // arrive through the core turtle's _onShout and route by nerve claim
    // (nerve.js project()).

    // Consumer dual of the constructors: subscribe with the SAME vocabulary
    // producers speak — one handler per named move, payload unwrapped. The
    // tuple is the wire shape; the shape, not a switch, is the seam.
    sub: (handlers) => sceneBridge.sub(([type, payload]) => handlers[type]?.(payload)),
};
