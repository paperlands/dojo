defmodule DojoWeb.HotspotLive do
  use DojoWeb, :live_component
  import DojoWeb.CoreComponents

  @moduledoc """
  LiveComponent for WiFi hotspot toggle.

  Renders an aperture-style button that pulses when the hotspot is active,
  with a collapsible dropdown showing SSID, password, and status.
  """

  def mount(socket) do
    {:ok,
     socket
     |> assign(
       status: :inactive,
       ssid: "Dojo",
       password: "enterthedojo",
       interface: nil,
       ip: nil,
       error: nil,
       show_password: false,
       confirming: false
     )}
  end

  # PubSub relay from parent LiveView
  def update(%{hotspot_status: status_map}, socket) do
    {:ok,
     socket
     |> assign(
       status: status_map.status,
       ssid: status_map.ssid,
       password: status_map.password,
       interface: status_map.interface,
       ip: status_map.ip,
       error: status_map.error
     )}
  end

  # Initial mount
  def update(%{id: id}, %{assigns: %{status: _}} = socket) do
    {:ok, assign(socket, :id, id)}
  end

  def update(%{id: id}, socket) do
    status = Dojo.Hotspot.Server.get_status()

    {:ok,
     socket
     |> assign(
       id: id,
       status: status.status,
       ssid: status.ssid,
       password: status.password,
       interface: status.interface,
       ip: status.ip,
       error: status.error,
       show_password: false,
       confirming: false
     )}
  end

  def render(assigns) do
    ~H"""
    <div class="relative inline-block">
      <%!-- Hotspot toggle button --%>
      <button
        :if={@status != :active}
        id={"#{@id}-inactive"}
        class="flex items-center justify-center w-9 h-9 border-1 border-accent backdrop-blur-sm transform transition-all duration-300 hover:scale-110 hover:rotate-[15deg] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:rotate-0 lg:w-8 lg:h-8 rounded-sm hover:fill-primary active:border-amber-500 touch-manipulation"
        phx-click={JS.toggle(to: "##{@id}-panel", in: "fade-in-scale", out: "fade-out-scale")}
        phx-target={@myself}
        disabled={@status == :unsupported}
      >
        <.icon name="hero-wifi" class="w-6 h-6 text-primary" />
      </button>

      <button
        :if={@status == :active}
        id={"#{@id}-active"}
        class="flex items-center justify-center w-9 h-9 border-2 border-primary/50 backdrop-blur-sm transform transition-all duration-300 hover:scale-110 hover:rotate-[15deg] lg:w-8 lg:h-8 rounded-sm active:border-amber-500 touch-manipulation"
        phx-click={JS.toggle(to: "##{@id}-panel", in: "fade-in-scale", out: "fade-out-scale")}
        phx-target={@myself}
      >
        <span class="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <.icon
          name="hero-wifi"
          class="w-6 h-6 text-accent-content drop-shadow-xs drop-shadow-accent-content"
        />
      </button>

      <%!-- Dropdown panel --%>
      <div
        id={"#{@id}-panel"}
        class="hidden absolute right-0 top-full mt-2 z-50 w-64 bg-base-200/95 backdrop-blur-sm border border-accent/50 rounded-lg p-3 font-mono text-xs text-primary shadow-lg"
      >
        <%!-- Status --%>
        <div class="flex items-center justify-between mb-2 pb-2 border-b border-accent/30">
          <span class="text-primary-content/70">status</span>
          <span class={[
            "font-bold",
            status_color(@status)
          ]}>
            {status_label(@status)}
          </span>
        </div>

        <%!-- Error --%>
        <div
          :if={@error}
          class="mb-2 p-2 bg-error/10 border border-error/30 rounded text-error text-xs"
        >
          {@error}
        </div>

        <%!-- SSID --%>
        <div class="flex items-center justify-between mb-1">
          <span class="text-primary-content/70">ssid</span>
          <span
            class="font-bold cursor-pointer hover:text-accent-content"
            phx-click={JS.dispatch("dojo:yoink", to: "##{@id}-ssid-val")}
          >
            {@ssid}
          </span>
          <span id={"#{@id}-ssid-val"} class="hidden">{@ssid}</span>
        </div>

        <%!-- Password --%>
        <div class="flex items-center justify-between mb-1">
          <span class="text-primary-content/70">password</span>
          <div class="flex items-center gap-1">
            <span
              class="font-bold cursor-pointer hover:text-accent-content"
              phx-click={JS.dispatch("dojo:yoink", to: "##{@id}-pw-val")}
            >
              {if @show_password, do: @password, else: String.duplicate("*", String.length(@password))}
            </span>
            <span id={"#{@id}-pw-val"} class="hidden">{@password}</span>
            <button
              phx-click="toggle_password"
              phx-target={@myself}
              class="hover:text-accent-content"
            >
              <.icon
                name={if @show_password, do: "hero-eye-slash", else: "hero-eye"}
                class="w-3 h-3"
              />
            </button>
          </div>
        </div>

        <%!-- IP --%>
        <div :if={@ip} class="flex items-center justify-between mb-2">
          <span class="text-primary-content/70">ip</span>
          <span class="font-bold">{@ip}</span>
        </div>

        <%!-- Confirmation warning --%>
        <div
          :if={@confirming}
          class="mb-2 p-2 bg-warning/10 border border-warning/30 rounded text-warning text-xs"
        >
          <p class="mb-2">This will disconnect from the current WiFi network.</p>
          <div class="flex gap-2 justify-end">
            <button
              phx-click="cancel_hotspot"
              phx-target={@myself}
              class="px-2 py-1 border border-accent/50 rounded hover:bg-base-300 transition-colors"
            >
              cancel
            </button>
            <button
              phx-click="confirm_hotspot"
              phx-target={@myself}
              class="px-2 py-1 bg-warning/20 border border-warning/50 rounded hover:bg-warning/30 transition-colors"
            >
              proceed
            </button>
          </div>
        </div>

        <%!-- Toggle button --%>
        <button
          :if={!@confirming}
          phx-click="toggle_hotspot"
          phx-target={@myself}
          disabled={@status in [:starting, :stopping, :unsupported]}
          class={[
            "w-full mt-2 px-3 py-1.5 rounded transition-colors font-bold",
            toggle_button_class(@status)
          ]}
        >
          {toggle_label(@status)}
        </button>
      </div>
    </div>
    """
  end

  def handle_event("toggle_hotspot", _, %{assigns: %{status: :active}} = socket) do
    Task.start(fn -> Dojo.Hotspot.Server.stop_hotspot() end)
    {:noreply, socket}
  end

  def handle_event("toggle_hotspot", _, socket) do
    {:noreply, assign(socket, confirming: true)}
  end

  def handle_event("confirm_hotspot", _, socket) do
    Task.start(fn -> Dojo.Hotspot.Server.start_hotspot() end)
    {:noreply, assign(socket, confirming: false)}
  end

  def handle_event("cancel_hotspot", _, socket) do
    {:noreply, assign(socket, confirming: false)}
  end

  def handle_event("toggle_password", _, socket) do
    {:noreply, assign(socket, show_password: !socket.assigns.show_password)}
  end

  # ── View helpers ───────────────────────────────────────────────────

  defp status_color(:active), do: "text-green-500"
  defp status_color(:starting), do: "text-amber-400 animate-pulse"
  defp status_color(:stopping), do: "text-amber-400 animate-pulse"
  defp status_color(:error), do: "text-error"
  defp status_color(:unsupported), do: "text-error"
  defp status_color(_), do: "text-primary-content/50"

  defp status_label(:active), do: "broadcasting"
  defp status_label(:starting), do: "starting..."
  defp status_label(:stopping), do: "stopping..."
  defp status_label(:error), do: "error"
  defp status_label(:unsupported), do: "unsupported"
  defp status_label(_), do: "offline"

  defp toggle_button_class(:active),
    do: "bg-error/20 border border-error/50 hover:bg-error/30 text-error"

  defp toggle_button_class(:starting),
    do: "opacity-50 cursor-not-allowed bg-base-300 border border-accent/30"

  defp toggle_button_class(:stopping),
    do: "opacity-50 cursor-not-allowed bg-base-300 border border-accent/30"

  defp toggle_button_class(:unsupported),
    do: "opacity-50 cursor-not-allowed bg-base-300 border border-accent/30"

  defp toggle_button_class(_),
    do: "bg-accent/20 border border-accent/50 hover:bg-accent/30 text-accent-content"

  defp toggle_label(:active), do: "stop hotspot"
  defp toggle_label(:starting), do: "starting..."
  defp toggle_label(:stopping), do: "stopping..."
  defp toggle_label(:unsupported), do: "unsupported"
  defp toggle_label(_), do: "start hotspot"
end
