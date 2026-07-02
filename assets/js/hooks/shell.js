// =============================================================================
// SHELL HOOK — one hook, two surfaces, three lifecycle states. bootShell
// brings up the shared substrate (CM6 + Terminal); data-target chooses which
// surface program stands over it — the outer review surface or the inner
// canvas. Each surface declares its server events as data and returns its
// handlers + cleanup from mount(); the lifecycle machine (./shell/lifecycle.js)
// registers events synchronously so nothing riding the mount patch is lost,
// queues through the boot seam, and stands a mid-boot destroy down.
// The two programs live in ./shell/{outer,inner}.js over ./shell/core.js.
// =============================================================================

import { makeShellHook } from "./shell/lifecycle.js";
import { bootShell } from "./shell/core.js";
import { outer } from "./shell/outer.js";
import { inner } from "./shell/inner.js";

const Shell = makeShellHook({ boot: bootShell, surfaces: { outer, inner } });

export default Shell;
