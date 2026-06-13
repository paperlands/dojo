defmodule DojoWeb.OuterShellLive do
  @moduledoc """
  The view for the OuterShell. A pure projection of the `OuterShell` model
  (`live/layout/outer_shell.ex`): it renders from assigns and emits bare
  intents (`{:outer_shell, …}`); the LiveView owns all state.
  """
  use DojoWeb, :live_component

  alias DojoWeb.Session
  alias DojoWeb.ShellLive.OuterShell

  def update(assigns, socket) do
    {:ok, assign(socket, assigns)}
  end

  def handle_event("followTurtle", _, socket) do
    # Pure projection: emit intent, let the LiveView (single authority) decide.
    send(self(), {:outer_shell, :toggle_follow})
    {:noreply, socket}
  end

  def handle_event("closeTurtle", _, socket) do
    send(self(), {:outer_shell, :close})
    {:noreply, socket}
  end

  # Liveness chip while drafting — frozen baseline ⟷ live rebase.
  def handle_event("toggleStream", _, socket) do
    send(self(), {:outer_shell, :toggle_stream})
    {:noreply, socket}
  end

  # Look back at the last known-good code, then return to the live view.
  def handle_event("recall", _, socket) do
    send(self(), {:outer_shell, :recall})
    {:noreply, socket}
  end

  def handle_event("watchLive", _, socket) do
    send(self(), {:outer_shell, :watch})
    {:noreply, socket}
  end

  def render(assigns) do
    ~H"""
    <div class="relative outershell pt-30 right-0 lg:pt-20 lg:right-2 w-full lg:-left-1/2 lg:w-[150%]">
      <div class="flex items-start justify-between gap-4 mb-1 pr-2 w-full">
        <!-- overflow-hidden clips the scroll; whitespace-nowrap prevents wrapping -->
        <div class="overflow-hidden w-full whitespace-nowrap">
          <!-- ONE wrapper moves as a unit — not two separate spans -->
          <div class="flex w-max animate-marquee">
            <span class="inline-block pr-32 mt-1 text-sm lg:text-lg font-bold text-secondary-content leading-tight">
              {head_title(@locale, @outershell)}
            </span>
            <span
              aria-hidden="true"
              class="inline-block pr-32 mt-1 text-sm lg:text-lg font-bold text-secondary-content leading-tight"
            >
              {head_title(@locale, @outershell)}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1 flex-shrink-0">
          <%!-- Fork lives beside the cross — always present, since whatever you
                are viewing can always be kept as a fork (JS-driven: it forks the
                live draft if you're drafting, else their code). --%>
          <button
            id="outer-fork"
            type="button"
            title="Keep a fork in your shell"
            class="flex items-center transform scale-x-[-1] justify-center w-6 h-6 transition-all duration-300 transform pointer-events-auto backdrop-blur-sm hover:scale-110 group focus-within:border-none"
          >
            <svg
              class="w-4 h-4 transition-colors text-accent-content group-hover:text-primary-content"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="18" cy="7" r="2.5" />
              <circle cx="6" cy="18" r="2.5" />
              <path d="M6 8.5v7" />
              <path d="M18 9.5c0 4-3 5.5-6 5.5" />
            </svg>
          </button>

          <%!-- Future: "propose" (inverse of fork — merge your draft back to its
                author, riding Dojo.Nerve). Omitted until the send path exists,
                rather than shipping a disabled stub. --%>

          <button
            phx-click="closeTurtle"
            phx-target={@myself}
            title="Close"
            class="flex items-center justify-center w-6 h-6 transition-all duration-300 transform pointer-events-auto backdrop-blur-sm hover:scale-110 group focus-within:border-none"
          >
            <svg
              class="w-4 h-4 transition-colors text-error text-shadow-error group-hover:text-primary-content"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <%!-- Wrapper updates normally; #outerenv stays JS-owned (phx-update=ignore).
            Overlays live here so the chip/recall/fork re-render with the FSM. --%>
      <div class="relative">
        <%!-- The chip IS the control. For a bug: red blinking = live, click to
              freeze on last good (red, static); click again to go live. --%>
        <div class="z-60 absolute flex items-center gap-2 top-2 right-2 pointer-events-none">
          <span
            phx-click={chip_action(@outershell)}
            phx-target={@myself}
            class="pointer-events-auto cursor-pointer relative flex h-2 w-2 flex-shrink-0 transition-colors delay-150"
            title={chip_title(@outershell)}
          >
            <span class={[
              "absolute inline-flex h-full w-full rounded-full opacity-75",
              mode_indicator_class(@outershell)
            ]}>
            </span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-primaryAccent"></span>
          </span>
        </div>

        <div
          id="outerenv"
          phx-update="ignore"
          data-outer-state="ok"
          class="overflow-y-scroll relative border pointer-events-auto rounded-lg h-[calc(100dvh-18rem)] lg:h-[60vh] border-amber-600/20 dark-scrollbar backdrop-blur-xs scrollbar-hide cursor-text"
        >
          <div
            phx-update="ignore"
            id="outershell"
            phx-hook="Shell"
            class="relative z-40 rounded-sm pointer-events-auto cursor-text bg-inherit border-none h-full"
            data-target="outer"
          />
        </div>

        <%!-- The friend's execution signals — directly below their code, right-aligned.
              Fed by the Shell hook via the shared chatMutator (replaces outer-output). --%>
        <div
          id="outer-nerve"
          phx-update="ignore"
          class="mt-2 flex flex-col-reverse items-end gap-0.5 font-mono text-xs text-right max-h-[20vh] overflow-hidden pointer-events-none"
        />
      </div>
    </div>
    """
  end

  # --- Private helpers ---

  # The title names exactly which state of whose code you're looking at.
  defp head_title(locale, %OuterShell{view: :draft, name: name}),
    do: Session.t(locale, "mod for @%{addr}", addr: name)

  defp head_title(locale, %OuterShell{view: :recall, name: name}),
    do: Session.t(locale, "@%{addr}'s old code", addr: name)

  defp head_title(locale, %OuterShell{name: name} = shell) do
    if OuterShell.errored?(shell),
      do: Session.t(locale, "@%{addr}'s bug", addr: name),
      else: Session.t(locale, "@%{addr}'s code", addr: name)
  end

  # The chip is the single liveness control; what it does depends on the state.
  defp chip_action(%OuterShell{view: :draft}), do: "toggleStream"
  defp chip_action(%OuterShell{view: :recall}), do: "watchLive"

  defp chip_action(%OuterShell{} = shell),
    do: if(OuterShell.errored?(shell), do: "recall", else: "followTurtle")

  defp chip_title(%OuterShell{view: :draft}), do: "Toggle live baseline (rebase onto their code)"
  defp chip_title(%OuterShell{view: :recall}), do: "Last good — click for the live bug"

  defp chip_title(%OuterShell{} = shell),
    do:
      if(OuterShell.errored?(shell), do: "Live bug — click for last good", else: "Toggle follow")

  # Yellow = the secondary-content theme token (matches the panel title).
  defp mode_indicator_class(%OuterShell{view: :draft, stream: true}),
    do: "bg-secondary-content animate-ping"

  defp mode_indicator_class(%OuterShell{view: :draft, stream: false}),
    do: "bg-secondary-content animate-pulse"

  defp mode_indicator_class(%OuterShell{view: :recall}), do: "bg-error"

  defp mode_indicator_class(%OuterShell{} = shell) do
    cond do
      # Live error — keep pinging; it's the friend's code as it breaks now.
      OuterShell.errored?(shell) -> "bg-error animate-ping"
      shell.follow -> "bg-accent-content animate-ping"
      true -> "bg-primary"
    end
  end
end
