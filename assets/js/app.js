// If you want to use Phoenix channels, run `mix help phx.gen.channel`
// to get started and then uncomment the line below.
// import "./user_socket.js"

// You can include dependencies in two ways.
//
// The simplest option is to put them in assets/vendor and
// import them using relative paths:
//
//     import "../vendor/some-package.js"
//
// Alternatively, you can `npm install some-package --prefix assets` and import
// them using a path starting with the package name:
//
//     import "some-package"
//

// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html";
// Establish Phoenix Socket and LiveView configuration.
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import {hooks as colocatedHooks} from "phoenix-colocated/dojo"
import  Hooks  from "./hooks/index.js";

let csrfToken = document
  .querySelector("meta[name='csrf-token']")
  .getAttribute("content");

let liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 5000,
  // The lamp (id:shell-offline-first) reads this socket's own health rather than
  // a side-channel probe. At the 30s default a frozen server looks connected for
  // up to a minute; at 5s phoenix.js tears the transport down on the second
  // missed reply, so a stalled VM shows inside ~10s — and reconnection gets the
  // same speed-up for free.
  heartbeatIntervalMs: 5000,
  params: () => {
    let session = {...(JSON.parse(localStorage.getItem("session")) || {}), active: true};
    return {
      _csrf_token: csrfToken,
      locale: (session.settings && session.settings.locale) ||
              Intl.NumberFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezone_offset: -new Date().getTimezoneOffset(),
      session: session
    };
  },
  metadata: {
    keydown: (event, element) => {
      return {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
      };
    },
  },
    hooks: {...colocatedHooks, ...Hooks}
});


// lvdx-7 · kc-p-fence: chrome flourishes only, capability closed HERE.
// Free-form execJS keyed by bare selector is refused — every call site would
// re-ask "is this chrome enough?" and accrete authority into the channel.
// First real flourish: add a *named* entry below; server pushes {name, …}.
// Forbidden as flourish targets: buffer content, nerve signals, outer authority.
const FLOURISHES = Object.freeze({
  // name: (el, detail) => { … }
});

window.addEventListener("phx:flourish", (event) => {
  const name = event.detail?.name;
  const run = name != null ? FLOURISHES[name] : null;
  if (typeof run !== "function") return;
  const el = event.detail?.to
    ? document.querySelector(event.detail.to)
    : document.body;
  if (!el) return;
  run(el, event.detail);
});

window.addEventListener("dojo:yoink", (event) => {
  if ("clipboard" in navigator) {
    const text = event.target.textContent;
    alert("Code copied!");
    navigator.clipboard.writeText(text);
  } else {
    alert("Sorry, your browser does not support clipboard copy.");
  }
});
// Connection state is a dot in the shell chrome (ConnectionDot), not a progress
// bar: the shell is offline-first, so "loading" was never the question.

// connect if there are any LiveViews on the page
liveSocket.connect();

// expose liveSocket on window for web console debug logs and latency simulation:
// insert dev mode check here
liveSocket.enableDebug();

window.addEventListener("phx:live_reload:attached", ({ detail: reloader }) => {
  // Enable server log streaming to client.
  // Disable with reloader.disableServerLogs()
  reloader.enableServerLogs();
  window.liveReloader = reloader;
});

// >> liveSocket.enableLatencySim(1000)  // enabled for duration of browser session
// >> liveSocket.disableLatencySim()
window.liveSocket = liveSocket;
