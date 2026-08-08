// =============================================================================
// SHELL HOOK — one hook, N surfaces, three lifecycle states. bootShell
// brings up the shared substrate (CM6 + Terminal) for editor surfaces;
// data-target NAMES which surface program stands over it — coreshell (mine),
// outershell (a friend's lineage), or the weave reading card. Each surface
// declares its server events as data and returns its handlers + cleanup from
// mount(); the lifecycle machine (./shell/lifecycle.js) registers events
// synchronously so nothing riding the mount patch is lost, queues through
// the boot seam, and stands a mid-boot destroy down.
// The programs live in ./shell/{outer,inner,weave}.js over ./shell/core.js.
// =============================================================================

import { makeShellHook } from "./shell/lifecycle.js";
import { bootShell } from "./shell/core.js";
import { outer as outershell } from "./shell/outer.js";
import { inner as coreshell } from "./shell/inner.js";
import { weave } from "./shell/weave.js";
import { nerve as seatedNerve } from "./nerve.js";
import { getStage } from "../turtling/stage-cell.js";

// Walker address for walk signals (source = who spoke). Session name is the
// child's word; until Shoot 5 mints a durable user id on the client, this is
// the one mouth that can tell two children at one table apart.
function walkerAddress() {
    try {
        const session = JSON.parse(localStorage.getItem("session") || "{}");
        return session?.name || "?";
    } catch {
        return "?";
    }
}

// Weave is client-lazy: no CM6, no Terminal. Ports only — stage cell + nerve
// + walker. No getElementById dunder read (gw-t-dom-registry).
async function bootFor(hook) {
    if (hook.el.dataset.target === "weave") {
        return {
            get turtle() { return getStage(); },
            get nerve() { return seatedNerve(); },
            get walker() { return walkerAddress(); },
        };
    }
    return bootShell(hook);
}

// The surface names ARE the data-target values — this map is the whole
// contract between the DOM and the programs. Mine and the friend's are peers:
// coreshell (I write, it runs) and outershell (I watch a friend's lineage).
const Shell = makeShellHook({
    boot: bootFor,
    surfaces: { coreshell, outershell, weave },
});

export default Shell;
