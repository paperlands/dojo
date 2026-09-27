// Copy text — the async way, or the oldest way.
//
// navigator.clipboard is absent on http origins and denied without a gesture,
// and neither is something a caller can act on: the hidden textarea is what
// browsers still honour inside a click. One verb, and it always answers.

/**
 * @param {string} text
 * @returns {Promise<boolean>} true when the clipboard took it
 */
export async function copyText(text) {
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
