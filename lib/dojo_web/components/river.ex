defmodule DojoWeb.RiverComponent do
  @moduledoc """
  The keep river — self, one work (`specs/weave/keep-river.org`, id:kr-orient).

  A row of pictures of *this* drawing over time, lit by one sun. While a
  picture is only yours the light is low like morning and the shadows are long.
  When the room has it, it is noon and the shadows go home.

  The server renders furniture and nothing else: the sun, the lens, the two
  veils, an empty rail. Every seat on that rail is folded out of the local
  journal by `assets/js/hooks/shell/river.js` — this LiveView never learns what
  the child kept, and the strip is whole with the socket down.

  Two pieces, one flag (`#river-state`), so the river composes anywhere:

      <.river_toggle />   # in a command row
      <.river />          # the strip itself
  """
  use Phoenix.Component

  import DojoWeb.SVGComponents

  alias Phoenix.LiveView.JS

  @doc """
  The strip. `phx-update="ignore"` because the paint is the client's — a
  server diff over these seats would wipe a fold the server cannot recompute.
  """
  attr :id, :string, default: "keep-river"
  attr :class, :string, default: nil

  def river(assigns) do
    ~H"""
    <style :type={DojoWeb.ColocatedCSS}>
      /* ── the river: one sun over one work (id:kr-vis) ─────────────────
         --color-primary is the ONLY accent. Shade is umber (neutral mixed
         with a breath of primary), never rgba black. Geometry is one scale:
         the noon seat swells, and there is no second size class.

         IN THE components LAYER ON PURPOSE. Colocated CSS is imported
         unlayered, and unlayered rules beat every layered one — so a bare
         `.river-sky { position: relative }` here would silently defeat the
         call site's `fixed`. Layered, these are defaults a utility can
         override, which is what makes the component composable at all. */
      /* Registered so the wash INTERPOLATES: an unregistered custom property
         steps, and a stepped sky is the discontinuity this surface refuses. */
      @property --river-wash {
        syntax: "<percentage>";
        inherits: true;
        initial-value: 7%;
      }

      @layer components {
      .river-sky {
        --river-seat: 44px;
        --river-gap: 18px;
        --river-pad: 1rem;
        --river-top: 1.5rem;
        /* one band for the word under the sun, before the seats */
        --river-caption: 1.7rem;
        --river-caption-gap: 0.2rem;
        --river-bottom: 1.25rem;
        /* the rig — the surface rewrites this once per mood; seats only read */
        --sun-size: 340px;
        /* seats begin after the top pad and the caption band */
        --river-seats-top: calc(var(--river-top) + var(--river-caption) + var(--river-caption-gap));

        --river-8: color-mix(in oklch, var(--color-primary) 8%, transparent);
        --river-core: color-mix(in oklch, var(--color-primary) 100%, white);
        --river-80: color-mix(in oklch, var(--color-primary) 80%, transparent);
        --river-55: color-mix(in oklch, var(--color-primary) 55%, transparent);
        --river-40: color-mix(in oklch, var(--color-primary) 40%, transparent);
        --river-28: color-mix(in oklch, var(--color-primary) 28%, transparent);
        --river-18: color-mix(in oklch, var(--color-primary) 18%, transparent);
        --river-12: color-mix(in oklch, var(--color-primary) 12%, transparent);
        --river-hair: color-mix(in oklch, var(--color-primary) 16%, transparent);
        --river-void: color-mix(in oklch, var(--color-base-content) 12%, transparent);
        --river-night: color-mix(in oklch, var(--color-neutral) 72%, var(--color-primary) 8%);
        /* two thresholds, two inks (id:kr-meridian) */
        --river-dusk: color-mix(in oklch, var(--color-base-content) 55%, var(--color-neutral) 45%);
        --river-twilight: color-mix(in oklch, var(--color-base-content) 45%, var(--color-primary) 30%);

        position: relative;
        padding: var(--river-top) 0 var(--river-bottom);
        /* The sky is light, not a pane: the wash must never steal the
           shell underneath. Only seats and the caption take a hand
           (same pattern as #disciple_panels). */
        pointer-events: none;

        /* NO PANEL. The sky is not a card over the canvas — it is light on
           it. Colour enters at the top where the sun stands and dissolves
           into nothing before the strip ends, so the river has no edge to
           notice and the drawing beneath is never cut. A background-colour
           here, a border, a blur pane — each would draw a rectangle the eye
           must first dismiss. --river-wash is the mood's one dial. */
        --river-wash: 7%;
        /* RADIAL, from where the sun stands. A vertical gradient fades down
           but ends in two hard verticals at the strip's sides — the seam the
           eye catches first. Light leaves a source in every direction, so the
           wash does too, and the strip has no side edge either. */
        background: radial-gradient(ellipse 72% 118% at 50% 0%,
          color-mix(in oklch, var(--color-primary) var(--river-wash), transparent) 0%,
          color-mix(in oklch, var(--color-primary) calc(var(--river-wash) / 3), transparent) 44%,
          transparent 76%);
        transition: --river-wash 900ms ease;
      }

      /* moods — the sky, never a word. Only the wash and the sun move. */
      .river-sky[data-mood="waking"] { --river-wash: 12%; }
      .river-sky[data-mood="ignite"] { --river-wash: 16%; }
      .river-sky[data-mood="settle"] { --river-wash: 9%; }

      /* the water half opens only when a sibling line exists (id:kr-mirror):
         one more breath of dusk beneath the waterline, still ending in air */
      .river-sky.has-mirror {
        background:
          radial-gradient(ellipse 62% 46% at 50% 78%,
            color-mix(in oklch, var(--river-dusk) 16%, transparent) 0%,
            transparent 72%),
          radial-gradient(ellipse 72% 96% at 50% 0%,
            color-mix(in oklch, var(--color-primary) var(--river-wash), transparent) 0%,
            color-mix(in oklch, var(--color-primary) calc(var(--river-wash) / 3), transparent) 40%,
            transparent 70%);
      }

      /* ── the one lamp — pinned at the meridian (id:kr-meridian) ──────── */
      .river-sun {
        position: absolute;
        left: 50%;
        /* THE SUN IS NEVER SEEN, ONLY FELT. Its disc rides above the frame and
           no white core reaches the room — a bright centre behind the centred
           seat reads as a lamp under the picture, which is the one thing a sun
           is not. Wide and faint: illumination, not a light source. */
        top: calc(var(--sun-size) / -1.75);
        width: var(--sun-size);
        height: var(--sun-size);
        transform: translateX(-50%);
        z-index: 0;
        pointer-events: none;
        opacity: 0.55;
        background: radial-gradient(circle,
          var(--river-40) 0%,
          var(--river-18) 32%,
          var(--river-8) 56%,
          transparent 74%);
        transition: width 900ms ease, height 900ms ease, opacity 900ms ease;
      }

      /* A keep landed and THE SUN SAYS SO — nothing on the rail moves. One
         light, one announcement (id:kr-light). */
      .river-sun.flare { animation: river-flare 620ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      @keyframes river-flare {
        0%   { opacity: 0.55; transform: translateX(-50%) scale(1); }
        22%  { opacity: 1;    transform: translateX(-50%) scale(1.14); }
        100% { opacity: 0.55; transform: translateX(-50%) scale(1); }
      }

      /* ── the wheel — fixed lens; drag-to-pan in wheel.js ────────────── */
      .river-rail {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: flex-start;
        gap: 1.4rem;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
        padding: var(--river-pad) calc(50% - var(--river-seat) / 2);
        touch-action: pan-y;
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        /* Sky is pointer-events:none; the rail takes the hand. */
        pointer-events: auto;
        /* Night is the seats dissolving at the page edge (id:kr-shadow). */
        -webkit-mask-image: linear-gradient(to right,
          transparent 0%, black 22%, black 78%, transparent 100%);
        mask-image: linear-gradient(to right,
          transparent 0%, black 22%, black 78%, transparent 100%);
      }
      .river-rail.is-dragging { cursor: grabbing; }
      .river-rail::-webkit-scrollbar { display: none; }

      .river-col {
        position: relative;
        z-index: 1;
        pointer-events: auto;
        flex: 0 0 var(--river-seat);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--river-gap);
        /* Dim into the past — warm dark, never grey (id:kr-shadow). */
        filter: brightness(var(--dim, 1)) sepia(calc((1 - var(--dim, 1)) * 0.6));
      }

      /* ── seats (id:kr-atoms) ────────────────────────────────────────── */
      .river-seat {
        position: relative;
        flex: 0 0 auto;
        width: var(--river-seat);
        height: var(--river-seat);
      }
      .river-slot {
        flex: 0 0 auto;
        width: var(--river-seat);
        height: var(--river-seat);
      }
      .river-face {
        position: absolute;
        inset: 0;
        opacity: 0.18;
        background-color: transparent;
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
      }
      .river-seat.has-face .river-face { opacity: 0.78; }

      /* Present (new): dotted circle, warmed by --near. */
      .river-open {
        position: absolute;
        inset: calc(18% - 6% * var(--near, 0));
        border-radius: 50%;
        pointer-events: none;
        border: 1px dashed color-mix(in oklch,
          var(--color-primary) calc(18% + var(--near, 0) * 50%),
          color-mix(in oklch, var(--color-base-content) 14%, transparent));
        filter:
          drop-shadow(0 0 calc(var(--near, 0) * 4px)
            color-mix(in oklch, var(--color-primary) calc(var(--near, 0) * 35%), transparent));
      }

      /* Draft: past the open east — grayed figure, no open circle.
         Not a keep: local only; name it or drop it (×). */
      .river-draft .river-open { display: none; }
      .river-draft .river-face {
        inset: 8%;
        border-radius: 50%;
        opacity: 0.38;
        background-size: cover;
        background-position: center;
        filter: grayscale(1) brightness(0.78);
      }
      .river-draft.has-face .river-face {
        opacity: 0.62;
        filter: grayscale(0.85) brightness(0.82);
      }

      /* Keep selection: command-deck L-corners in primary-content, via --near. */
      .river-ring {
        position: absolute;
        inset: -5px;
        pointer-events: none;
        --lit: var(--near, 0);
        --arm: 7px;
        --th: 1.5px;
        --ink-str: 85%;
        --ink: color-mix(
          in oklch,
          var(--color-primary-content) calc(var(--lit) * var(--ink-str)),
          transparent
        );
        background:
          linear-gradient(var(--ink), var(--ink)) top left / var(--arm) var(--th) no-repeat,
          linear-gradient(var(--ink), var(--ink)) top left / var(--th) var(--arm) no-repeat,
          linear-gradient(var(--ink), var(--ink)) top right / var(--arm) var(--th) no-repeat,
          linear-gradient(var(--ink), var(--ink)) top right / var(--th) var(--arm) no-repeat,
          linear-gradient(var(--ink), var(--ink)) bottom left / var(--arm) var(--th) no-repeat,
          linear-gradient(var(--ink), var(--ink)) bottom left / var(--th) var(--arm) no-repeat,
          linear-gradient(var(--ink), var(--ink)) bottom right / var(--arm) var(--th) no-repeat,
          linear-gradient(var(--ink), var(--ink)) bottom right / var(--th) var(--arm) no-repeat;
        filter:
          drop-shadow(0 0 calc(var(--lit) * 3px)
            color-mix(in oklch, var(--color-primary-content) calc(var(--lit) * 45%), transparent))
          drop-shadow(0 0 calc(var(--lit) * 8px)
            color-mix(in oklch, var(--color-primary-content) calc(var(--lit) * 18%), transparent));
      }
      .river-ring-settled { --ink-str: 55%; }
      .river-ring-open { --ink-str: 100%; }
      .river-col.noon .river-ring-open {
        animation: river-breath 2.8s ease-in-out infinite;
      }
      @keyframes river-breath {
        0%, 100% {
          filter:
            drop-shadow(0 0 3px color-mix(in oklch, var(--color-primary-content) 40%, transparent))
            drop-shadow(0 0 8px color-mix(in oklch, var(--color-primary-content) 16%, transparent));
        }
        50% {
          filter:
            drop-shadow(0 0 5px color-mix(in oklch, var(--color-primary-content) 58%, transparent))
            drop-shadow(0 0 12px color-mix(in oklch, var(--color-primary-content) 28%, transparent));
        }
      }

      /* ── the water — the shell out of focus (id:kr-mirror) ───────────── */
      .river-sky:not(.has-mirror) [data-place="water"] { display: none; }
      .river-sky:not(.has-mirror) .river-waterline { opacity: 0; }
      .river-water {
        transform: scaleY(-1);
        opacity: 0.38;
        filter: blur(1.5px);
        -webkit-mask-image: linear-gradient(to bottom, transparent 8%, black 88%);
        mask-image: linear-gradient(to bottom, transparent 8%, black 88%);
        cursor: pointer;
        transition: opacity 400ms ease, filter 400ms ease, transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      /* past the meet the water is another line, not a copy */
      .river-water.foggy { opacity: 0.3; filter: blur(3.5px) saturate(0.8); }
      .river-waterline {
        position: absolute;
        left: 1.5rem;
        right: 1.5rem;
        top: calc(var(--river-seats-top) + var(--river-pad) + var(--river-seat) + var(--river-gap) / 2);
        height: 1px;
        z-index: 0;
        opacity: 1;
        background: linear-gradient(to right,
          transparent,
          color-mix(in oklch, var(--color-primary) 30%, transparent) 20%,
          color-mix(in oklch, var(--color-primary) 30%, transparent) 80%,
          transparent);
        transition: opacity 400ms ease;
      }
      /* the meet — the only mark provenance ever gets */
      .river-ripple {
        position: absolute;
        left: 50%;
        top: calc(var(--river-seat) + var(--river-gap) / 2);
        transform: translate(-50%, -58%);
        z-index: 2;
        font-size: 1.05rem;
        letter-spacing: -1px;
        pointer-events: none;
        color: color-mix(in oklch, var(--color-primary) 85%, white);
        text-shadow: 0 0 10px var(--river-55), 0 0 22px var(--river-28);
      }

      /* ── the detent's frame and the two thresholds ───────────────────── */
      .river-lens {
        position: absolute;
        left: 50%;
        top: calc(var(--river-seats-top) + var(--river-pad) - 6px);
        width: calc(var(--river-seat) + 22px);
        height: calc(var(--river-seat) + 12px);
        transform: translateX(-50%);
        border-inline: 1px solid var(--river-18);
        border-radius: 14px;
        z-index: 2;
        pointer-events: none;
        -webkit-mask-image: linear-gradient(to bottom, transparent, black 45%, transparent);
        mask-image: linear-gradient(to bottom, transparent, black 45%, transparent);
      }
      /* The two thresholds are GONE as paint. Tinted bands over the drawing
         were a curtain with a temperature — colour that belonged to nothing.
         The seats' own fade at the page edge (the rail's mask) says the same
         thing with no pigment at all: past and future are simply where the
         light runs out. */

      /* ── the word at the meridian ────────────────────────────────────
         One caption for one sun — ABOVE the rail, under the light. Standing
         in a keep it reads that keep's title; standing in the present it
         becomes the line where the next word is written. Top keeps the
         name on the sky line when the water mirror opens below. */
      .river-caption {
        position: relative;
        z-index: 4;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-height: var(--river-caption);
        margin: 0 0 var(--river-caption-gap);
        padding-inline: 1.5rem;
        pointer-events: auto;
      }
      .river-word,
      .river-message {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.7rem;
        letter-spacing: 0.1em;
        text-align: center;
      }
      .river-word {
        max-width: 40ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: color-mix(in oklch, var(--color-base-content) 72%, transparent);
      }
      .river-message {
        display: none;
        width: min(32ch, 78%);
        padding: 0.12rem 0.3rem 0.18rem;
        background: transparent;
        border: none;
        border-bottom: 1px solid color-mix(in oklch, var(--color-primary) 26%, transparent);
        outline: none;
        color: var(--color-primary);
        caret-color: var(--color-primary);
        transition: border-color 240ms ease;
      }
      .river-message::placeholder {
        letter-spacing: 0.22em;
        color: color-mix(in oklch, var(--river-twilight) 62%, transparent);
      }
      .river-message:focus {
        border-bottom-color: color-mix(in oklch, var(--color-primary) 66%, transparent);
      }
      .river-sky.at-present .river-word { display: none; }
      .river-sky.at-present .river-message { display: block; }
      /* Fork draft: same editable line as the present, plus a cross to drop it. */
      .river-sky.at-draft .river-word { display: none; }
      .river-sky.at-draft .river-message { display: block; }
      /* Colour rides the same tab-close utilities: text-red-500/70 hover:text-red-500. */
      .river-drop {
        display: none;
        flex: 0 0 auto;
        width: 1.35rem;
        height: 1.35rem;
        margin-left: 0.35rem;
        padding: 0;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
      }
      .river-drop:focus-visible { outline: none; }
      .river-sky.at-draft .river-drop { display: inline-flex; }

      /* Copy-link: next to a kept title. Active deck idiom — secondary
         + soft glow invites the hand (same family as #riverbutton open). */
      .river-copy {
        display: none;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 1.35rem;
        height: 1.35rem;
        margin-left: 0.4rem;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--color-secondary-content);
        cursor: copy;
        opacity: 0.92;
        filter:
          drop-shadow(0 0 3px color-mix(in oklch, var(--color-secondary-content) 55%, transparent))
          drop-shadow(0 0 8px color-mix(in oklch, var(--color-secondary-content) 28%, transparent));
        transition: opacity 200ms ease, color 200ms ease, transform 200ms ease;
      }
      .river-sky.at-keep .river-copy {
        display: inline-flex;
        animation: river-copy-glow 2.6s ease-in-out infinite;
      }
      .river-copy:hover {
        opacity: 1;
        transform: scale(1.08);
      }
      /* :active = press; amber like the rest of the deck */
      .river-copy:active {
        color: oklch(0.79 0.16 75);
        transform: scale(0.96);
        filter:
          drop-shadow(0 0 5px color-mix(in oklch, oklch(0.79 0.16 75) 65%, transparent))
          drop-shadow(0 0 14px color-mix(in oklch, oklch(0.79 0.16 75) 35%, transparent));
      }
      .river-copy:focus-visible { outline: none; }
      .river-sky.at-keep .river-copy.is-copied {
        animation: river-copy-flash 900ms ease both;
      }
      @keyframes river-copy-glow {
        0%, 100% {
          filter:
            drop-shadow(0 0 3px color-mix(in oklch, var(--color-secondary-content) 50%, transparent))
            drop-shadow(0 0 8px color-mix(in oklch, var(--color-secondary-content) 24%, transparent));
        }
        50% {
          filter:
            drop-shadow(0 0 5px color-mix(in oklch, var(--color-secondary-content) 72%, transparent))
            drop-shadow(0 0 14px color-mix(in oklch, var(--color-secondary-content) 38%, transparent));
        }
      }
      @keyframes river-copy-flash {
        0%   { transform: scale(1); opacity: 1; }
        35%  { transform: scale(1.18); opacity: 1; }
        100% { transform: scale(1); opacity: 0.92; }
      }

      @media (prefers-reduced-motion: reduce) {
        .river-col.noon .river-ring-open,
        .river-sun.flare { animation: none; }
        .river-sky.at-keep .river-copy,
        .river-sky.at-keep .river-copy.is-copied { animation: none; }
        .river-water { transition: none; }
        .river-rail { scroll-behavior: auto; }
      }
      }
    </style>
    <div
      id={@id}
      class={["river-sky", @class]}
      phx-hook="Shell"
      phx-update="ignore"
      data-target="river"
      data-mood="rest"
      role="group"
      aria-label="the keeps of this work"
    >
      <span class="river-sun" data-sun=""></span>
      <%!-- The word at the meridian — under the sun, above the seats.
            One caption because there is one meridian; top so the name
            stays on the sky line when the water opens. --%>
      <div class="river-caption">
        <span class="river-word" data-word=""></span>
        <button
          type="button"
          class="river-copy"
          data-copy=""
          aria-label="copy share link"
          title="copy link"
        >
          <.copy_link class="w-3.5 h-3.5" />
        </button>
        <input
          class="river-message"
          data-message=""
          type="text"
          maxlength="72"
          autocomplete="off"
          spellcheck="false"
          placeholder="YOUR TITLE"
          aria-label="name this moment to keep it"
        />
        <button
          type="button"
          class="river-drop text-red-500/70 hover:text-red-500 opacity-70 hover:opacity-100 transition-opacity duration-200"
          data-drop=""
          aria-label="discard draft"
          title="discard"
        >×</button>
      </div>
      <span class="river-waterline"></span>
      <div class="river-rail" data-rail=""></div>
      <span class="river-lens"></span>
    </div>
    """
  end

  @doc """
  Open the river. Deck idiom: a class on a flag div, so opening costs no
  round trip and works with the socket down.
  """
  attr :class, :string, default: nil

  def river_toggle(assigns) do
    ~H"""
    <button
      id="riverbutton"
      class={[
        "flex items-center justify-center w-9 h-9 border-1 border-accent backdrop-blur-sm",
        "transform transition-all duration-300 hover:scale-110 hover:rotate-[15deg]",
        "lg:w-8 lg:h-8 rounded-sm text-primary active:border-amber-500",
        "touch-manipulation",
        @class
      ]}
      title="sharing"
      aria-label="sharing"
      phx-click={JS.toggle_class("river-open", to: "#river-state")}
    >
      <.share class="river-share-icon w-6 h-6" />
    </button>
    """
  end

  @doc "The open flag. One per shell; the strip and the toggle both read it."
  def river_state(assigns) do
    ~H"""
    <div id="river-state" phx-update="ignore" class="hidden"></div>
    """
  end
end
