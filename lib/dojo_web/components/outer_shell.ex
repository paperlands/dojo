defmodule DojoWeb.OuterShellLive do
  use DojoWeb, :live_component

  alias DojoWeb.Session
  alias DojoWeb.ShellLive.OuterShell

  require Logger

  def update(assigns, socket) do
    {:ok, assign(socket, assigns)}
  end

  def handle_event("followTurtle", _, socket) do
    follow = socket.assigns.outershell.follow
    send(self(), {:outer_shell, :toggle_follow, !follow})
    {:noreply, socket}
  end

  def handle_event("closeTurtle", _, socket) do
    send(self(), {:outer_shell, :close})
    {:noreply, socket}
  end

  def handle_event("previewError", _, socket) do
    send(self(), {:outer_shell, :preview})
    {:noreply, socket}
  end

  def handle_event("dismissPreview", _, socket) do
    send(self(), {:outer_shell, :dismiss_preview})
    {:noreply, socket}
  end

  def handle_event("forkBuffer", _, socket) do
    %OuterShell{live_turtle: live, freeze_turtle: freeze, name: name, addr: addr} =
      socket.assigns.outershell

    source_turtle = live || freeze

    if source_turtle do
      send(
        self(),
        {:outer_shell, :fork,
         %{
           source: source_turtle.source,
           name: name,
           addr: addr,
           time: source_turtle.time
         }}
      )
    end

    {:noreply, socket}
  end

  def render(assigns) do
    ~H"""
    <div class="relative outershell pt-20 right-2 w-full lg:-left-1/2 lg:w-[150%]">
      <div class="flex items-start justify-between gap-2 mb-3">
        <span
          id="top-head"
          class="text-lg font-bold text-secondary-content flex-1 leading-tight"
        >
          {Session.t(@locale, "@%{addr}'s code", addr: @outershell.name)}
        </span>

        <span
          phx-click={mode_action(@outershell.mode)}
          phx-target={@myself}
          class="pointer-events-auto cursor-pointer relative flex h-2 w-2 flex-shrink-0 mt-1 mr-3 transition-colors delay-150"
          title={mode_title(@outershell.mode)}
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
        class="overflow-y-scroll relative border pointer-events-auto rounded-lg h-[50vh] border-amber-600/20 dark-scrollbar backdrop-blur-xs scrollbar-hide cursor-text"
      >
        <div class="z-50 absolute flex gap-1 top-2 right-2">

          <button
            phx-click="closeTurtle"
            phx-target={@myself}
            class="flex items-center justify-center w-8 h-8 transition-all duration-300 transform border-2 rounded-full opacity-50 pointer-events-auto backdrop-blur-sm hover:scale-110 group hover:opacity-100 border-accent focus-within:border-none"
          >
            <div class="absolute inset-0 flex items-center justify-center">
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
            </div>
          </button>
        </div>

        <div
          phx-update="ignore"
          id="outershell"
          phx-hook="Shell"
          class="relative z-40 rounded-sm pointer-events-auto cursor-text bg-inherit border-none h-full"
          data-target="outer"
        />
      </div>
      <div class="-bottom-1/12 transition-colors delay-150 duration-300 overflow-y-auto pb-1 flex">
        <div
          phx-update="ignore"
          id="outer-output"
          class="w-full flex-auto opacity-80 font-mono border-none text-primary text-sm"
        />
      </div>
    </div>
    """
  end

  # --- Private helpers ---

  defp mode_action(:freeze), do: "previewError"
  defp mode_action(:peek), do: "dismissPreview"
  defp mode_action(_), do: "followTurtle"

  defp mode_title(:freeze), do: "Preview error code"
  defp mode_title(:peek), do: "Dismiss preview"
  defp mode_title(:live), do: "Toggle follow"
  defp mode_title(_), do: ""

  defp mode_indicator_class(%OuterShell{mode: :freeze}), do: "bg-error"
  defp mode_indicator_class(%OuterShell{mode: :peek}), do: "bg-error animate-ping"
  defp mode_indicator_class(%OuterShell{follow: true}), do: "bg-accent-content animate-ping"
  defp mode_indicator_class(_), do: "bg-primary"
end
