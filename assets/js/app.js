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
import topbar from "../vendor/topbar";
import  Hooks  from "./hooks/index.js";

let csrfToken = document
  .querySelector("meta[name='csrf-token']")
  .getAttribute("content");

let liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 5000,
  params: { _csrf_token: csrfToken,
            locale: Intl.NumberFormat().resolvedOptions().locale,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezone_offset: -new Date().getTimezoneOffset(),
            session:  JSON.parse(localStorage.getItem("session")) || {active: true}
          },
  metadata: {
    keydown: (event, element) => {
      return {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
      };
    },
  },
  hooks: Hooks,
});


window.addEventListener("phx:download-file", (event) => {
       console.log("Event received:", event);
       var element = document.createElement('a');
       element.setAttribute('href', event.detail.href);
       element.setAttribute('download', event.detail.filename);

       element.style.display = 'none';
       document.body.appendChild(element);
       element.click();
       document.body.removeChild(element);
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
// Show progress bar on live navigation and form submits
topbar.config({ barColors: { 0: "#ff7722" }, shadowColor: "rgba(0, 0, 0, .3)" });
window.addEventListener("phx:page-loading-start", (_info) => topbar.show(300));
window.addEventListener("phx:page-loading-stop", (_info) => topbar.hide());

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
