defmodule Dojo.Cluster.NetworkMonitor do
  @moduledoc """
  Monitors network interface changes and hot-swaps Partisan's listen_addrs.

  When the node roams (WiFi hop, hotspot change), this process:
  1. Detects the new set of routable IPs
  2. Updates partisan_config:listen_addrs so node_spec() advertises correctly
  3. Restarts the Partisan peer_service_server listeners on new IPs
  4. Triggers an immediate mDNS re-announcement on the new interfaces

  Does NOT restart the node, the BEAM, or the Partisan application.
  """
  use GenServer
  require Logger

  # 3s — fast enough for WiFi hops, cheap enough for constrained devices
  @poll_interval 3_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    current_ips = Dojo.Cluster.MDNS.routable_ipv4_addrs()
    port = partisan_port()

    Logger.info(
      "[NetworkMonitor] init — IPs=#{inspect(Enum.map(current_ips, &fmt/1))} port=#{port}"
    )

    schedule_poll()
    {:ok, %{ips: current_ips, port: port}}
  end

  @impl true
  def handle_info(:poll, %{ips: old_ips, port: port} = state) do
    new_ips = Dojo.Cluster.MDNS.routable_ipv4_addrs()

    state =
      if MapSet.new(new_ips) != MapSet.new(old_ips) do
        Logger.warning(
          "[NetworkMonitor] IP change detected! " <>
            "#{inspect(Enum.map(old_ips, &fmt/1))} → #{inspect(Enum.map(new_ips, &fmt/1))}"
        )

        handle_ip_change(new_ips, old_ips, port)
        %{state | ips: new_ips}
      else
        state
      end

    schedule_poll()
    {:noreply, state}
  end

  # ── The critical hot-swap sequence ──────────────────────────────────────

  defp handle_ip_change(new_ips, old_ips, port) do
    # 1. Goodbye on OLD IPs — tell peers on the departing network we're leaving.
    #    Must happen BEFORE config update so packets carry the recognizable identity.
    #    Sends @goodbye_count TTL=0 packets with @goodbye_interval ms gap.
    Dojo.Cluster.MDNS.goodbye(old_ips)

    new_addrs = Enum.map(new_ips, fn ip -> %{ip: ip, port: port} end)

    # 2. Update Partisan's config so node_spec() returns new addresses.
    :partisan_config.set(:listen_addrs, new_addrs)
    Logger.info("[NetworkMonitor] partisan_config:listen_addrs updated → #{inspect(new_addrs)}")

    # 3. Restart the Partisan peer service server to rebind listeners.
    restart_listeners()

    # 4. Force disconnect stale connections.
    #    TCP connections on old IPs are half-dead; disconnecting triggers HyParView healing.
    disconnect_stale_peers()

    # 5. Re-announce on NEW IPs — make us visible on the new network immediately
    #    instead of waiting up to 5s for the next mDNS lookup cycle.
    Dojo.Cluster.MDNS.reannounce(new_ips)
  end

  defp restart_listeners do
    # The acceptor pool is the TCP listener that binds to listen_addrs.
    # Restarting it forces rebind on the new IPs from partisan_config.
    # The HyParView manager (under partisan_peer_service_sup) is left alone —
    # its membership state (active/passive views) survives the listener restart.
    try do
      case Supervisor.terminate_child(:partisan_sup, :partisan_acceptor_socket_pool_sup) do
        :ok ->
          case Supervisor.restart_child(:partisan_sup, :partisan_acceptor_socket_pool_sup) do
            {:ok, pid} ->
              Logger.info("[NetworkMonitor] acceptor pool restarted → #{inspect(pid)}")

            {:error, reason} ->
              Logger.error("[NetworkMonitor] acceptor pool restart failed: #{inspect(reason)}")
          end

        {:error, reason} ->
          Logger.error("[NetworkMonitor] acceptor pool terminate failed: #{inspect(reason)}")
      end
    rescue
      e -> Logger.error("[NetworkMonitor] listener restart error: #{inspect(e)}")
    end
  end

  defp disconnect_stale_peers do
    try do
      # partisan_peer_connections is the ETS table holding live TCP connections.
      # Disconnecting peers forces HyParView to reconnect using fresh node_specs
      # that now carry our updated listen_addrs.
      case :partisan_peer_service.members() do
        members when is_list(members) and members != [] ->
          Logger.info(
            "[NetworkMonitor] disconnecting #{length(members)} peers to force reconnect"
          )

          :partisan_peer_service_manager.disconnect(members)

        _ ->
          :ok
      end
    rescue
      _ -> :ok
    end
  end

  # ── Helpers ─────────────────────────────────────────────────────────────

  defp partisan_port do
    case :partisan_config.get(:listen_addrs) do
      [%{port: p} | _] -> p
      _ -> 9090
    end
  end

  defp schedule_poll, do: Process.send_after(self(), :poll, @poll_interval)
  defp fmt(ip), do: ip |> :inet.ntoa() |> to_string()
end
