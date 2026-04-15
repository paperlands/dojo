defmodule DojoWeb.HotspotLive do
  use DojoWeb, :live_component
  import DojoWeb.CoreComponents

  @moduledoc """
  LiveComponent for WiFi hotspot toggle.

  Renders an aperture-style button that pulses when the hotspot is active,
  with a collapsible dropdown showing SSID, password, and status.

  Uses start_async/handle_async for non-blocking operations.
  """

  # ── Lifecycle ────────────────────────────────────────────────────────

  def mount(socket) do
    
    {:ok,
     socket
     |> assign(
       status: :loading,
       ssid: "PaperLand",
       password: "enterpaperland",
       interface: nil,
       ip: nil,
       error: nil,
       connected_to: nil,
       peer_count: 0,
       show_password: false,
       confirming: false
     )}
  end

  # PubSub relay from parent LiveView — authoritative state from Server
  def update(%{hotspot_status: status_map}, socket) do
    {:ok, assign_status(socket, status_map)}
  end

  # First update — kick off async fetch
  def update(%{id: id, username: name}, socket) when not is_map_key(socket.assigns, :id) do
    {:ok,
     socket
     |> assign(id: id, ssid: "#{name}@PaperLand", show_password: false, confirming: false)
     |> start_async(:fetch_status, fn -> Dojo.Hotspot.Server.get_status() end)}
  end

  # Subsequent updates — no-op
  def update(%{id: _id}, socket), do: {:ok, socket}

  # ── Async callbacks ──────────────────────────────────────────────────

  def handle_async(:fetch_status, {:ok, status}, socket) do
    {:noreply, assign_status(socket, status)}
  end

  def handle_async(:fetch_status, {:exit, _reason}, socket) do
    {:noreply,
     assign(socket,
       status: :error,
       error: %{message: "Failed to load hotspot status", hint: nil, kind: :error}
     )}
  end

  def handle_async(:start_hotspot, {:ok, :ok}, socket) do
    # Server broadcast will arrive via PubSub with authoritative state.
    # Set optimistic active in case relay hasn't arrived yet.
    {:noreply, assign(socket, status: :active)}
  end

  def handle_async(:start_hotspot, {:ok, {:error, _reason}}, socket) do
    # Error state comes via PubSub broadcast from Server — no-op here.
    {:noreply, socket}
  end

  def handle_async(:start_hotspot, {:exit, reason}, socket) do
    {:noreply,
     assign(socket,
       status: :error,
       error: %{message: "Start failed: #{inspect(reason)}", hint: nil, kind: :error}
     )}
  end

  def handle_async(:stop_hotspot, {:ok, _}, socket) do
    {:noreply, assign(socket, status: :inactive, ip: nil, peer_count: 0)}
  end

  def handle_async(:stop_hotspot, {:exit, reason}, socket) do
    {:noreply,
     assign(socket,
       status: :error,
       error: %{message: "Stop failed: #{inspect(reason)}", hint: nil, kind: :error}
     )}
  end

  # ── Template ─────────────────────────────────────────────────────────

  def render(assigns) do
    ~H"""
    <div class="relative inline-block">
      <%!-- Loading skeleton --%>
      <div
        :if={@status == :loading}
        class="flex items-center justify-center z-100 w-9 h-9 lg:w-8 lg:h-8"
      >
        <.icon name="hero-wifi" class="w-6 h-6 text-primary-content/30 animate-pulse" />
      </div>

      <%!-- Starting/stopping spinner --%>
      <button
        :if={@status in [:starting, :stopping]}
        class="flex items-center justify-center w-9 h-9 border-1 border-amber-400/50 backdrop-blur-xxs lg:w-8 lg:h-8 rounded-sm touch-manipulation"
        phx-click={JS.toggle(to: "##{@id}-panel", in: "fade-in-scale", out: "fade-out-scale")}
        phx-target={@myself}
      >
        <.icon name="hero-wifi" class="w-6 h-6 text-primary-content animate-pulse" />
      </button>

      <%!-- Inactive / error / unsupported button --%>
      <button
        :if={@status not in [:active, :loading, :starting, :stopping]}
        id={"#{@id}-inactive"}
        class="flex items-center justify-center w-9 h-9 border-1 border-accent backdrop-blur-sm transform transition-all duration-300 hover:scale-110 hover:rotate-[15deg] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:rotate-0 lg:w-8 lg:h-8 rounded-sm hover:fill-primary active:border-amber-500 touch-manipulation"
        phx-click={JS.toggle(to: "##{@id}-panel", in: "fade-in-scale", out: "fade-out-scale")}
        phx-target={@myself}
        disabled={@status == :unsupported}
      >
        <.icon
          name="hero-wifi"
          class={"w-6 h-6 #{if @status == :error, do: "text-error", else: "text-primary"}"}
        />
      </button>

      <%!-- Active button with green pulse --%>
      <button
        :if={@status == :active}
        id={"#{@id}-active"}
        class="flex items-center justify-center w-9 h-9 border-2 border-primary/50 backdrop-blur-sm transform transition-all duration-300 hover:scale-110 hover:rotate-[15deg] lg:w-8 lg:h-8 rounded-sm active:border-amber-500 touch-manipulation"
        phx-click={JS.toggle(to: "##{@id}-panel", in: "fade-in-scale", out: "fade-out-scale")}
        phx-target={@myself}
      >
        <.icon
          name="hero-wifi"
          class="w-6 h-6 text-accent-content drop-shadow-xs drop-shadow-accent-content  animate-pulse"
        />
      </button>

      <%!-- Dropdown panel --%>
      <div
        :if={@status != :loading}
        id={"#{@id}-panel"}
        class="hidden absolute z-100 right-0 top-full mt-2 w-64 bg-transparent backdrop-blur-sm border border-accent/50 rounded-lg p-3 font-mono text-xs text-primary shadow-lg"
      >
        <%!-- Status --%>
        <div class="flex items-center justify-between mb-2 pb-2 border-b border-accent">
          <span class="text-primary-content/70">status</span>
          <span class={[
            "font-bold",
            status_color(@status)
          ]}>
            {status_label(@status)}
          </span>
        </div>

        <%!-- Error with actionable guidance --%>
        <div
          :if={@error}
          class={["mb-2 p-2 rounded text-xs", error_style(@error.kind)]}
        >
          <div class="flex items-center gap-1.5">
            <.icon name={error_icon(@error.kind)} class="w-3.5 h-3.5 shrink-0" />
            <span class="font-bold">{@error.message}</span>
          </div>
          <div :if={@error.hint} class="mt-1.5 flex items-center gap-1.5">
            <code
              class="flex-1 px-1.5 py-0.5 bg-base-300/50 rounded text-[10px] font-mono cursor-pointer hover:bg-base-300 transition-colors"
              phx-click={JS.dispatch("dojo:yoink", to: "##{@id}-hint-val")}
            >
              {@error.hint}
            </code>
            <span id={"#{@id}-hint-val"} class="hidden">{@error.hint}</span>
            <.icon name="hero-clipboard-document" class="w-3 h-3 text-primary-content/40" />
          </div>
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
        <div :if={@ip} class="flex items-center justify-between mb-1">
          <span class="text-primary-content/70">ip</span>
          <span class="font-bold">{@ip}</span>
        </div>

        <%!-- Connected peers --%>
        <div
          :if={@status == :active and @peer_count > 0}
          class="flex items-center justify-between mb-1"
        >
          <span class="text-primary-content/70">peers</span>
          <span class="font-bold">{@peer_count}</span>
        </div>

        <%!-- Confirmation warning --%>
        <div
          :if={@confirming}
          class="mb-2 p-2 bg-warning/10 border border-warning/30 rounded text-warning text-xs"
        >
          <p :if={@connected_to} class="mb-1">
            Connected to <span class="font-bold">{@connected_to}</span>
          </p>
          <p class="mb-2">Starting a hotspot will disconnect from this network.</p>
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
              class="px-2 py-1 bg-warning/20 border border-accent-content/50 rounded hover:bg-warning/30 transition-colors"
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

  # ── Events ───────────────────────────────────────────────────────────

  def handle_event("toggle_hotspot", _, %{assigns: %{status: :active}} = socket) do
    {:noreply,
     socket
     |> assign(status: :stopping, error: nil)
     |> start_async(:stop_hotspot, fn -> Dojo.Hotspot.Server.stop_hotspot() end)}
  end

  def handle_event("toggle_hotspot", _, socket) do
    connected_to =
      if socket.assigns.interface do
        Dojo.Hotspot.connected_ssid(socket.assigns.interface)
      end

    {:noreply, assign(socket, confirming: true, connected_to: connected_to)}
  end

  def handle_event("confirm_hotspot", _, %{assigns: %{ssid: ssid}} = socket) do
    {:noreply,
     socket
     |> assign(confirming: false, status: :starting, error: nil)
     |> start_async(:start_hotspot, fn -> Dojo.Hotspot.Server.start_hotspot(%{ssid: ssid}) end)}
  end

  def handle_event("cancel_hotspot", _, socket) do
    {:noreply, assign(socket, confirming: false)}
  end

  def handle_event("toggle_password", _, socket) do
    {:noreply, assign(socket, show_password: !socket.assigns.show_password)}
  end

  # ── Helpers ──────────────────────────────────────────────────────────

  defp assign_status(socket, status_map) do
    assign(socket,
      status: status_map.status,
      #ssid: status_map.ssid,
      password: status_map.password,
      interface: status_map.interface,
      ip: status_map.ip,
      error: status_map.error,
      connected_to: status_map[:connected_to],
      peer_count: status_map[:peer_count] || 0
    )
  end

  # ── View helpers ─────────────────────────────────────────────────────

  defp status_color(:active), do: "text-accent-content"
  defp status_color(:starting), do: "text-amber-400 animate-pulse"
  defp status_color(:stopping), do: "text-amber-400 animate-pulse"
  defp status_color(:error), do: "text-error"
  defp status_color(:unsupported), do: "text-error"
  defp status_color(_), do: "text-primary-content"

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
    do: "bg-accent/20 border border-accent/50 hover:bg-accent/30 text-primary-content"

  defp toggle_label(:active), do: "stop hotspot"
  defp toggle_label(:starting), do: "starting..."
  defp toggle_label(:stopping), do: "stopping..."
  defp toggle_label(:unsupported), do: "unsupported"
  defp toggle_label(_), do: "start hotspot"

  defp error_style(:needs_install), do: "bg-warning/10 border border-warning/30 text-warning"
  defp error_style(:needs_action), do: "bg-warning/10 border border-warning/30 text-warning"
  defp error_style(:transient), do: "bg-info/10 border border-info/30 text-info"
  defp error_style(_), do: "bg-error/10 border border-error/30 text-error"

  defp error_icon(:needs_install), do: "hero-wrench-screwdriver-mini"
  defp error_icon(:needs_action), do: "hero-exclamation-triangle-mini"
  defp error_icon(:transient), do: "hero-arrow-path-mini"
  defp error_icon(_), do: "hero-exclamation-circle-mini"
end
