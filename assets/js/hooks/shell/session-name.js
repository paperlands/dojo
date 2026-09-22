// The child's letters — session assign, mirrored in localStorage by Box.
// Shells pass this into askKeep; keep/cell does not read the session.

/** @returns {string | null} */
export function sessionName() {
    try {
        if (typeof localStorage === "undefined") return null
        const session = JSON.parse(localStorage.getItem("session") || "{}")
        return typeof session?.name === "string" && session.name ? session.name : null
    } catch {
        return null
    }
}
