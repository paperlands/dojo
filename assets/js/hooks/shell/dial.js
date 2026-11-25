// Epoch and the one lease this surface took. A painted command re-asks the
// world when it runs. Replay is admitted only by the current play, and drops
// only this lease. (id:nav-core-sill)
import { catchSite, createPlayCatch } from "../../turtling/catch.js"
import { currentPlay, foreignHold, holdPlay, holdsPlay, playOf, releasePlay } from "../../turtling/playback.js"


// Seen is the seat's; done is the grant's and the stage's.
// A shared stage refuses the hand. It does not erase the play. (id:nav-core-sill)
export function offers({ authorized, alone, done, blocked, held }) {
    const may = authorized === true && blocked !== true
    return {
        hold: may && alone === true && done !== true && held == null,
        resume: held != null,
        replay: may && alone === true,
    }
}
// Authority, Catch eligibility, and replay admission all name a play incarnation. (id:shell-playback-binding)
export function createDial(turtle, {
    seat, authority, catchable = () => true, prepareReplay = () => null,
    acted = () => {}, docOf = () => null,
}) {
    let epoch = 0
    let dead = false
    let lease = null        // this surface's receipt
    let catcher = null
    let breakpoint = null
    let chosenDoc = null     // no carry across documents

    function cancelCatch() {
        const prior = catcher
        catcher = null
        prior?.cancel()
    }

    function acquire(play, at) {
        if (at !== epoch || dead || !authority(play)) return null
        const receipt = holdPlay(turtle, play, () => at === epoch && !dead && authority(play))
        if (receipt != null) lease = receipt
        return receipt
    }

    function giveBack(receipt) {
        if (receipt == null || receipt !== lease) return false
        lease = null
        return releasePlay(turtle, receipt)
    }

    function release() { return giveBack(lease) }

    const mayReplay = (play, at, held) => at === epoch && !dead && authority(play) &&
        currentPlay(turtle, play) && !foreignHold(turtle, held)

    function armCatch() {
        const standing = seat()
        const play = standing && playOf(turtle, standing.slot)
        if (breakpoint == null || dead || !play || play.phase !== 'running' ||
            !play.alone || !authority(play) || !catchable(play)) return false
        // A line means nothing once its document is gone. (id:nav-core-sill)
        if (docOf() !== chosenDoc) return false
        const at = epoch
        const armedDoc = docOf()
        catcher = createPlayCatch(turtle, {
            seat: play.seat, line: breakpoint,
            // Dies with the document, not with a notice about it.
            witness: () => docOf() === armedDoc,
            hold: () => {
                const receipt = acquire(play, at)
                if (receipt != null) queueMicrotask(() => { if (!dead && lease === receipt) acted() })
                return receipt
            },
            release: giveBack,
        })
        return catcher.arm().state === 'armed'
    }

    return {
        catchLine(line) {
            const hit = catcher?.read().state === 'hit' && catcher.read().held
            // A gone document is not a toggle. The first click chooses. (id:nav-core-sill)
            const drifted = breakpoint != null && docOf() !== chosenDoc
            breakpoint = breakpoint === line && !drifted ? null : line
            chosenDoc = breakpoint == null ? null : docOf()
            if (hit) {
                cancelCatch()
                if (breakpoint != null) armCatch()
            } else if (!catcher?.read().held) {
                cancelCatch()
                armCatch()
            }
            acted()
            return true
        },

        syncCatch() { if (!catcher) armCatch() },
        // An edit retires an unhit arm. A hit keeps its lease until Continue
        // or a grant edge. The same document disarms nothing. (id:nav-core-sill)
        disarm() {
            if (breakpoint == null || docOf() === chosenDoc) return false
            if (catcher?.read().held) return false
            cancelCatch()
            breakpoint = null
            chosenDoc = null
            acted()
            return true
        },

        catchReading() {
            const live = catcher?.read()
            const standing = seat()
            const drifted = breakpoint != null && docOf() !== chosenDoc
            // Reports what an edge will honour. A drive retires; this does not. (id:nav-core-sill)
            const bound = live?.stale !== true && !drifted
            const available = bound && breakpoint != null && standing != null &&
                catchSite(turtle, standing.slot, breakpoint) != null
            return breakpoint == null ? null : {
                line: breakpoint,
                available,
                hit: bound && live?.state === 'hit' && live.held && live.site?.line === breakpoint,
            }
        },
        // An authority edge ends painted commands and this pause. (id:nav-core-sill)
        ended() {
            epoch++
            breakpoint = null
            cancelCatch()
            return release()
        },

        close() {
            dead = true
            cancelCatch()
            epoch++
            return release()
        },

        // Commands close over the epoch they were painted under. (id:nav-core-sill)
        read({ passiveWhenUnauthorized = false } = {}) {
            if (dead) return null
            const standing = seat()
            if (!standing) return null
            const play = playOf(turtle, standing.slot)
            if (!play) return null
            // An instant run has nothing to depict.
            if (!play.waited && breakpoint == null) return null
            const at = epoch
            const authorized = authority(play)
            const passive = passiveWhenUnauthorized && !authorized
            // Only our receipt, still this play.
            const held = !passive && lease != null && play.lease === lease ? lease : null
            const caught = held == null ? null : catcher?.read()
            // The caught instant, not work authorized past it.
            const ms = caught?.state === 'hit' && caught.receipt === held
                ? Math.max(0, play.ms - (caught.authorizedH - caught.instant)) : play.ms
            // The play's incarnation, so a painted verb can be told from a
            // same-named verb on its successor. (id:outer-sill-lifetime)
            const view = {
                key: `${play.id}:${play.run}`,
                ms,
                phase: play.phase,
                caught: caught?.state === 'hit' && caught.receipt === held,
                can: offers({
                    authorized, alone: play.alone, done: play.done,
                    blocked: foreignHold(turtle, held), held,
                }),
            }
            if (passive) return view
            return {
                ...view,
                pause: () => {
                    if (!acquire(play, at)) return false
                    cancelCatch()
                    acted()
                    return true
                },
                resume: () => {
                    if (at !== epoch || dead || held == null) return false
                    if (!giveBack(held)) return false
                    cancelCatch()
                    armCatch()
                    acted()
                    return true
                },
                replay: () => {
                    if (!mayReplay(play, at, held)) return false
                    const restart = prepareReplay(play)
                    if (!restart || !mayReplay(play, at, held)) return false
                    const wasMine = held != null && holdsPlay(turtle, held)
                    // The hold stays until the native replacement takes it. (id:nav-core-sill)
                    let armed = false
                    const prepare = () => {
                        cancelCatch()
                        armed = breakpoint == null ? false : armCatch()
                    }
                    if (!restart(prepare)) {
                        // A refusal past admission may have spent the lease. Re-buy it. (id:nav-core-sill)
                        if (wasMine) acquire(play, at)
                        return false
                    }
                    // Only the current authority passes its pause on.
                    if (wasMine && !armed && at === epoch && !dead) {
                        const fresh = playOf(turtle, play.seat)
                        if (fresh && fresh.alone && !fresh.done) {
                            acquire(fresh, at)
                        }
                    }
                    acted()
                    return true
                },
            }
        },
    }
}
