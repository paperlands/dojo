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
    const sub = (callback) => {
        console.log(`${eventName} event sub`)
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
        console.log(`${eventName} event pub`, {payload})
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
        console.log(`${eventName} event dispatch`, {el, payload, selector})
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
 */
export const scene = {
    focus:       (ambientId)        => sceneBridge.pub(['focus', { ambientId }]),
    remove:      (ambientId)        => sceneBridge.pub(['remove', { ambientId }]),
    fork:        (payload)          => sceneBridge.pub(['fork', payload]),
    ambient:     (addr, name, code) => sceneBridge.pub(['ambient', { addr, name, code }]),
    ambientStop: (addr)             => sceneBridge.pub(['ambientStop', { addr }]),
    // The cursor-gate crossing the seam (gw-play Shoot 1): the outer viewer's
    // active ``` cell, spoken as (page addr, cell index) — the inner shell owns
    // the sibling ambients and resolves the index to the one that runs.
    cell:        (addr, index)      => sceneBridge.pub(['cell', { addr, index }]),
    // Note: a watched friend's shouts are NOT relayed over a scene channel —
    // they arrive through the core turtle's _onShout and route by source via
    // the nerve's claim model (see nerve.js project()).

    // The consumer-side dual of the constructors: subscribe with the SAME
    // vocabulary the producers speak — one handler per named move, payload
    // unwrapped. The tuple stays the wire shape; the shape, not a switch,
    // is the seam. Returns the unsub fn, as sub always has.
    sub: (handlers) => sceneBridge.sub(([type, payload]) => handlers[type]?.(payload)),
};
