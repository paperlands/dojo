// Socket edge: one .catch, no outbox (lvdx-4).
// wire.say shape (id:kc-c-wire): fire and forget; a drop is a fact, never an
// exception. Always Promise<void> — never "ok", never undefined on the throw path.

/**
 * @param {{ pushEvent?: Function, pushEventTo?: Function }} el
 * @param {string} eventName
 * @param {object} [payload]
 * @param {string | null} [selector]
 * @returns {Promise<void>}
 */
export function safePush(el, eventName, payload = {}, selector = null) {
    let result
    try {
        result = selector
            ? el.pushEventTo(selector, eventName, payload)
            : el.pushEvent(eventName, payload)
    } catch (err) {
        console.debug?.(`[adapter] drop ${eventName}:`, err?.message || err)
        return Promise.resolve()
    }
    if (result?.catch) {
        return result.catch((err) => {
            console.debug?.(`[adapter] drop ${eventName}:`, err?.message || err)
        }).then(() => {})
    }
    return Promise.resolve()
}
