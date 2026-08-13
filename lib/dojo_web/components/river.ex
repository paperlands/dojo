defmodule DojoWeb.RiverComponent do
  @moduledoc """
  The keep river — self, one work (`specs/weave/keep-river.org`, id:kr-orient).

  A row of pictures of *this* drawing over time, lit by one sun. While a
  picture is only yours the light is low like morning and the shadows are long.
  When the room has it, it is noon and the shadows go home.

  The server renders furniture and nothing else: the sun, the lens, the
  caption, an empty rail. Style lives in `assets/css/river.css` (one system,
  greppable). Every seat on that rail is folded out of the local journal by
  `assets/js/hooks/shell/river.js` — this LiveView never learns what the child
  kept, and the strip is whole with the socket down.

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
  round trip and works with the socket down. Glyph rides `text-primary`
  (currentColor); open paints secondary + reflow-bloom (colocated below).
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
      title="share"
      aria-label="share"
      phx-click={JS.toggle_class("is-open", to: "#river-state")}
    >
      <.share class="w-6 h-6" />
    </button>
    """
  end

  @doc "The open flag. One per shell; the strip and the toggle both read it."
  def river_state(assigns) do
    ~H"""
    <div id="river-state" phx-update="ignore" class="hidden"></div>
    <%!-- Share reflow-bloom + open paint. Flag is placement-agnostic;
         :has reads it from anywhere. Who shows .river-sky stays at the
         call site (id:kr-place). diagrams/share-mass · reflow-bloom. --%>
    <style :type={DojoWeb.ColocatedCSS}>
      /* deck idiom: secondary + soft glow while the river is open */
      :has(#river-state.is-open) #riverbutton {
        color: var(--color-secondary-content);
        border-color: var(--color-secondary-content);
        filter: drop-shadow(0 1px 1px var(--color-secondary-content));
      }

      /* organic solar mass — closed = filled body; open = rim ink runs,
         corona peels off. Fill stays solid (never a black hole). */
      #riverbutton .share-shell {
        stroke-dasharray: 1;
        stroke-dashoffset: 0;
        transition:
          stroke-dashoffset 720ms cubic-bezier(0.4, 0, 0.2, 1),
          opacity 200ms ease 500ms;
      }
      #riverbutton .share-flow {
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        stroke-width: 3.2;
        opacity: 0;
        transition:
          stroke-dashoffset 720ms cubic-bezier(0.4, 0, 0.2, 1),
          stroke-width 420ms cubic-bezier(0.4, 0, 0.2, 1),
          opacity 80ms linear;
      }
      #riverbutton .share-fill {
        fill-opacity: 1;
        transition: fill-opacity 380ms ease 360ms;
      }
      #riverbutton .share-glow {
        opacity: 0;
        transform-origin: center;
        transform-box: fill-box;
        transform: scale(0.95);
        filter: blur(0px);
        transition:
          opacity 700ms cubic-bezier(0.16, 1, 0.3, 1) 320ms,
          transform 900ms cubic-bezier(0.16, 1, 0.3, 1) 280ms,
          filter 900ms cubic-bezier(0.16, 1, 0.3, 1) 280ms;
      }
      :has(#river-state.is-open) #riverbutton .share-shell {
        stroke-dashoffset: 1;
        opacity: 0;
      }
      :has(#river-state.is-open) #riverbutton .share-flow {
        stroke-dashoffset: 0;
        stroke-width: 6.4;
        opacity: 1;
      }
      :has(#river-state.is-open) #riverbutton .share-glow {
        opacity: 0.38;
        transform: scale(1.22);
        filter: blur(1.6px);
      }
      /* close: rim redraws; glow dies quick so no stick */
      body:not(:has(#river-state.is-open)) #riverbutton .share-flow {
        transition:
          stroke-dashoffset 520ms cubic-bezier(0.4, 0, 0.2, 1),
          stroke-width 320ms cubic-bezier(0.4, 0, 0.2, 1),
          opacity 120ms linear 400ms;
      }
      body:not(:has(#river-state.is-open)) #riverbutton .share-shell {
        transition:
          stroke-dashoffset 520ms cubic-bezier(0.4, 0, 0.2, 1),
          opacity 180ms ease;
      }
      body:not(:has(#river-state.is-open)) #riverbutton .share-glow {
        transition-duration: 280ms;
        transition-delay: 0ms;
      }
      @media (prefers-reduced-motion: reduce) {
        #riverbutton .share-shell,
        #riverbutton .share-flow,
        #riverbutton .share-fill,
        #riverbutton .share-glow {
          transition: opacity 200ms ease !important;
        }
        :has(#river-state.is-open) #riverbutton .share-shell {
          stroke-dashoffset: 0;
          opacity: 0;
        }
        :has(#river-state.is-open) #riverbutton .share-flow {
          stroke-dashoffset: 0;
          opacity: 0;
        }
        :has(#river-state.is-open) #riverbutton .share-glow {
          transform: none;
          filter: none;
          opacity: 0.22;
        }
      }
    </style>
    """
  end
end
