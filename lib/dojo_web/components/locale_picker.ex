defmodule DojoWeb.LocalePickerLive do
  use DojoWeb, :live_component

  @locales [
    {"en", "en"},
    {"ar", "عر"},
    {"ko", "한"},
    {"zh", "中"}
  ]

  def mount(socket) do
    {:ok, assign(socket, expanded: false, locales: @locales)}
  end

  def update(assigns, socket) do
    {:ok, assign(socket, assigns)}
  end

  def handle_event("toggle", _, socket) do
    {:noreply, assign(socket, expanded: !socket.assigns.expanded)}
  end

  def handle_event("pick", %{"locale" => locale}, socket) do
    if locale in DojoWeb.Session.supported_locales() do
      send(self(), {:setting, :locale, locale})
    end

    {:noreply, assign(socket, expanded: false)}
  end

  def render(assigns) do
    ~H"""
    <div class="relative inline-flex items-center">
      <button
        id={"#{@id}-toggle"}
        phx-click="toggle"
        phx-target={@myself}
        class="flex text-center items-center justify-center w-9 h-9 border-1 border-accent backdrop-blur-sm transform transition-all duration-300 hover:scale-110 lg:w-8 lg:h-8 rounded-sm active:border-amber-500 touch-manipulation text-secondary-content text-shadow-sm text-shadow-secondary-content"
      >
          {current_label(@current_locale, @locales)}
      </button>

      <div
        :if={@expanded}
        id={"#{@id}-panel"}
        phx-click-away="toggle"
        phx-target={@myself}
        class="absolute right-0 top-full mt-2 bg-base-200 backdrop-blur-sm border border-accent/50 rounded-lg p-2 font-mono text-xs text-primary shadow-lg z-50"
      >
        <button
          :for={{code, label} <- @locales}
          phx-click="pick"
          phx-value-locale={code}
          phx-target={@myself}
          class={[
            "block w-full px-3 py-1.5 text-left rounded transition-colors duration-200",
            if(@current_locale == code,
              do: "text-accent-content bg-accent/30 font-bold",
              else: "text-primary-content/70 hover:text-primary-content hover:bg-base-300"
            )
          ]}
        >
          {label}
        </button>
      </div>
    </div>
    """
  end

  defp current_label(locale, locales) do
    case List.keyfind(locales, locale, 0) do
      {_, label} -> label
      nil -> locale
    end
  end
end
