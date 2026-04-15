defmodule DojoWeb.LocalePickerLive do
  use DojoWeb, :live_component

  alias Phoenix.LiveView.JS

  @locales [
    {"en", "en"},
    {"ar", "عر"},
    {"ko", "한"},
    {"zh", "中"}
  ]

  def mount(socket) do
    {:ok, assign(socket, locales: @locales)}
  end

  def update(assigns, socket) do
    {:ok, assign(socket, assigns)}
  end

  def handle_event("pick", %{"locale" => locale}, socket) do
    if locale in DojoWeb.Session.supported_locales() do
      send(self(), {:setting, :locale, locale})
    end

    {:noreply, socket}
  end

  defp toggle_panel(id) do
    JS.toggle(to: "##{id}-panel", in: "fade-in-scale", out: "fade-out-scale")
    |> JS.toggle_class(
      "text-secondary-content text-shadow-sm text-shadow-secondary-content",
      to: "##{id}-toggle"
    )
  end


  def render(assigns) do
    ~H"""
    <div class="relative inline-flex items-center langpicker">
      <button
        id={"#{@id}-toggle"}
        phx-click={toggle_panel(@id)}
        class="flex text-center items-center justify-center text-primary-content/70 w-9 h-9 border-1 border-accent backdrop-blur-sm transform transition-all duration-300 hover:scale-110 lg:w-8 lg:h-8 rounded-sm active:border-amber-500 touch-manipulation text-secondary-content text-shadow-sm text-shadow-secondary-content"
      >
        {current_label(@current_locale, @locales)}
      </button>

      <div
        id={"#{@id}-panel"}
        phx-click-away={toggle_panel(@id)}
        class="hidden absolute right-0 top-full mt-2 bg-transparent backdrop-blur-xs border border-accent/50 rounded-lg p-2 font-mono text-sm text-primary shadow-lg z-50"
      >
        <button
          :for={{code, label} <- @locales}
          :if={@current_locale !== code}
          phx-click={toggle_panel(@id) |> JS.push("pick", value: %{locale: code}, target: @myself)}
          class="block w-full p-1 text-center rounded transition-colors duration-200 text-primary-content/70 hover:text-primary-content hover:bg-base-300"
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
