defmodule Dojo.Hotspot.Server do
  @moduledoc """
  GenServer managing WiFi hotspot lifecycle and state.

  Polls hotspot status every 5s and broadcasts changes via PubSub.
  Follows the Dojo.Cluster.NetworkMonitor pattern.
  """
  use GenServer
  require Logger

  @poll_interval 5_000
  @default_ssid "Dojo"
  @default_password "enterthedojo"

  defstruct status: :inactive,
            ssid: @default_ssid,
            password: @default_password,
            interface: nil,
            ip: nil,
            error: nil

  # ── Client API ─────────────────────────────────────────────────────

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec start_hotspot(keyword()) :: :ok | {:error, term()}
  def start_hotspot(opts \\ []) do
    GenServer.call(__MODULE__, {:start, opts}, 15_000)
  end

  @spec stop_hotspot() :: :ok | {:error, term()}
  def stop_hotspot do
    GenServer.call(__MODULE__, :stop, 15_000)
  end

  @spec get_status() :: map()
  def get_status do
    GenServer.call(__MODULE__, :status)
  end

  # ── Server Callbacks ───────────────────────────────────────────────

  @impl true
  def init(_opts) do
    {:ok, %__MODULE__{}, {:continue, :detect_interface}}
  end

  @impl true
  def handle_continue(:detect_interface, state) do
    state =
      case Dojo.Hotspot.detect_wifi_interface() do
        {:ok, iface} ->
          Logger.info("[Hotspot.Server] WiFi interface detected: #{iface}")
          %{state | interface: iface}

        {:error, reason} ->
          Logger.warning("[Hotspot.Server] No WiFi interface: #{inspect(reason)}")
          %{state | status: :unsupported, error: "No WiFi adapter found"}
      end

    schedule_poll()
    broadcast(state)
    {:noreply, state}
  end

  @impl true
  def handle_call({:start, opts}, _from, %{status: :unsupported} = state) do
    {:reply, {:error, :unsupported}, %{state | error: opts[:error] || state.error}}
  end

  def handle_call({:start, opts}, _from, state) do
    ssid = opts[:ssid] || state.ssid
    password = opts[:password] || state.password

    state = %{state | status: :starting, ssid: ssid, password: password, error: nil}
    broadcast(state)

    case Dojo.Hotspot.start(ssid, password) do
      :ok ->
        state = %{state | status: :active}
        state = sync_status(state)
        broadcast(state)
        {:reply, :ok, state}

      {:error, reason} = err ->
        state = %{state | status: :error, error: format_error(reason)}
        broadcast(state)
        {:reply, err, state}
    end
  end

  def handle_call(:stop, _from, state) do
    state = %{state | status: :stopping, error: nil}
    broadcast(state)

    case Dojo.Hotspot.stop() do
      :ok ->
        state = %{state | status: :inactive, ip: nil}
        broadcast(state)
        {:reply, :ok, state}

      {:error, _reason} = err ->
        state = sync_status(state)
        broadcast(state)
        {:reply, err, state}
    end
  end

  def handle_call(:status, _from, state) do
    {:reply, Map.from_struct(state), state}
  end

  @impl true
  def handle_info(:poll, %{status: :unsupported} = state) do
    schedule_poll()
    {:noreply, state}
  end

  def handle_info(:poll, state) do
    new_state = sync_status(state)

    if new_state.status != state.status or new_state.ip != state.ip do
      broadcast(new_state)
    end

    schedule_poll()
    {:noreply, new_state}
  end

  # ── Helpers ────────────────────────────────────────────────────────

  defp sync_status(state) do
    case Dojo.Hotspot.status() do
      {:ok, %{active: true} = info} ->
        %{
          state
          | status: :active,
            ssid: info.ssid || state.ssid,
            ip: info.ip,
            interface: info.interface || state.interface
        }

      {:ok, %{active: false}} ->
        if state.status in [:active, :stopping] do
          %{state | status: :inactive, ip: nil}
        else
          state
        end

      {:error, _} ->
        state
    end
  end

  defp broadcast(state) do
    status_map = Map.from_struct(state)
    #later handle local broadcasting on Dojo.Pubsub module itself
    Phoenix.PubSub.local_broadcast(
      Dojo.PubSub,
      "dojo:hotspot",
      {Dojo.PubSub, :hotspot_changed, status_map}
    )
  end

  defp schedule_poll, do: Process.send_after(self(), :poll, @poll_interval)

  defp format_error(:privilege_required), do: "Permission denied. Check your user permissions."
  defp format_error(:no_wifi), do: "No WiFi adapter found."
  defp format_error(:nmcli_not_found), do: "nmcli not found. Install NetworkManager."

  defp format_error(:ip_config_failed),
    do: "IP config failed. Try: nmcli connection delete Hotspot, then retry."

  defp format_error(:powershell_not_found), do: "PowerShell not found."

  defp format_error(:platform_limited),
    do: "Enable Internet Sharing manually in System Preferences."

  defp format_error(:launchctl_not_found), do: "launchctl not found."
  defp format_error({:hotspot_failed, msg}), do: msg
  defp format_error(other), do: inspect(other)
end
