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

export const seaBridge = bridged("sea");
export const cameraBridge = bridged("cam");
export const shellBridge = bridged("shell");
