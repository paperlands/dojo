// Copy text: plain strings use the immediate clipboard/textarea path.
// Prepared promises start a native write in the gesture (id:la-copy-lifetime);
// after that write is issued there is no fallback.

/**
 * @param {string|Promise<string>} text plain text or a late-bound prepared text
 * @returns {Promise<boolean>} true when the clipboard took it
 */
export async function copyText(text) {
    if (text && typeof text.then === "function") return copyPrepared(text)

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch {
        /* the old way is the fallback, not an error */
    }
    return byTextarea(text)
}

// The write must start inside the gesture. Unsupported prepared backends refuse
// explicitly; there is no textarea fallback after the activation window.
async function copyPrepared(text) {
    let prepared
    try {
        prepared = Promise.resolve(text).then((value) => {
            if (typeof value !== "string") throw new Error("copy: prepared text was not a string")
            return new Blob([value], { type: "text/plain" })
        })
    } catch {
        return false
    }
    // Observe a later not-live/stale rejection even when no native consumer exists.
    void prepared.catch(() => {})

    if (typeof globalThis.ClipboardItem !== "function" ||
        typeof globalThis.navigator?.clipboard?.write !== "function") return false

    try {
        const item = new globalThis.ClipboardItem({ "text/plain": prepared })
        await globalThis.navigator.clipboard.write([item])
        return true
    } catch {
        return false
    }
}

function byTextarea(text) {
    if (typeof document?.execCommand !== "function") return false
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    let took = false
    try {
        took = document.execCommand("copy")
    } catch {
        /* nothing left to try */
    }
    ta.remove()
    return took
}
