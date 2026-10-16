// An open input revision defers dependent execution, not observation.
// Permissions are live: closing one scope cannot release another. (id:execution-input-revisions)
export function createExecution({ current, depends, onRelease = () => {} }) {
    const revisions = new Map()

    const permits = owner => {
        if (!current(owner)) return false
        for (const input of revisions.keys()) {
            if (current(input) && depends(owner, input)) return false
        }
        return true
    }

    return {
        permits,
        run(owner, work) {
            if (!permits(owner)) return false
            work()
            return true
        },
        defer(input) {
            if (!current(input)) return () => false
            const token = {}
            if (!revisions.has(input)) revisions.set(input, new Set())
            const scopes = revisions.get(input)
            scopes.add(token)
            return () => {
                if (!scopes.delete(token)) return false
                if (scopes.size === 0) revisions.delete(input)
                if (current(input)) onRelease()
                return true
            }
        },
    }
}
