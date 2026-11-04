// A camera command addresses one view. Nothing here subscribes to a channel:
// the caller decides which instance hears the command, and the caller owns
// the subscription that delivered it.

export function applyViewCommand(view, command) {
    const { camera, controls } = view
    switch (command) {
    case "recenter":
        camera.position.set(0, 0, 500)
        controls.target.set(0, 0, 0)
        // Level the horizon too. Recenter is the default view, not the default
        // view still banked.
        view.level?.()
        controls.update()
        return true
    case "pan":
        camera.desire = camera.desire !== "pan" ? "pan" : "track"
        return true
    case "track":
        camera.desire = camera.desire !== "track" ? "track" : "pan"
        return true
    case "endtrack":
        camera.desire = null
        return true
    default:
        return false
    }
}
