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
  # Require N consecutive polls with same new IPs before triggering change.
  # Absorbs transient WiFi flaps without delaying genuine roaming too much.
  @debounce_stable_count 2

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

    # Seed addr cache so Gate.routable_addr/0 reads from cache instead of live syscall
    current_addr = Dojo.Cluster.Routing.routable_addr()
    :persistent_term.put({Dojo.Gate, :addr}, current_addr)
    Logger.info("[NetworkMonitor] seeded addr=#{current_addr}")

    schedule_poll()
    {:ok, %{ips: current_ips, port: port, pending_ips: nil, stable_count: 0}}
  end

  @impl true
  def handle_info(:poll, state) do
    new_ips = Dojo.Cluster.MDNS.routable_ipv4_addrs()
    state = debounce_ip_change(new_ips, state)
    schedule_poll()
    {:noreply, state}
  end

  # Debounce state machine: require @debounce_stable_count consecutive polls
  # seeing the same new IPs before triggering the expensive handle_ip_change.
  defp debounce_ip_change(new_ips, %{ips: old_ips} = state) do
    new_set = MapSet.new(new_ips)
    old_set = MapSet.new(old_ips)

    cond do
      # No change — reset any pending debounce
      new_set == old_set ->
        %{state | pending_ips: nil, stable_count: 0}

      # Same new IPs seen again — increment stable count
      state.pending_ips != nil and MapSet.new(state.pending_ips) == new_set ->
        count = state.stable_count + 1

        if count >= @debounce_stable_count do
          Logger.warning(
            "[NetworkMonitor] IP change confirmed after #{count} polls: " <>
              "#{inspect(Enum.map(old_ips, &fmt/1))} → #{inspect(Enum.map(new_ips, &fmt/1))}"
          )

          handle_ip_change(new_ips, old_ips, state.port)
          %{state | ips: new_ips, pending_ips: nil, stable_count: 0}
        else
          Logger.debug("[NetworkMonitor] debouncing IP change, stable_count=#{count}")
          %{state | stable_count: count}
        end

      # New IPs detected (or different from pending) — start fresh debounce
      true ->
        Logger.debug("[NetworkMonitor] IP change detected, starting debounce")
        %{state | pending_ips: new_ips, stable_count: 1}
    end
  end

  # ── The critical hot-swap sequence ──────────────────────────────────────

  defp handle_ip_change(new_ips, old_ips, port) do
    Logger.info(
      "[LC] hot-swap START old=#{inspect(Enum.map(old_ips, &fmt/1))} " <>
        "new=#{inspect(Enum.map(new_ips, &fmt/1))}"
    )

    Dojo.Cluster.MDNS.PartisanAdapter.lc_snapshot_views("hot-swap:before")

    # 1. Goodbye on OLD IPs — tell peers on the departing network we're leaving.
    #    Must happen BEFORE config update so packets carry the recognizable identity.
    #    Sends @goodbye_count TTL=0 packets with @goodbye_interval ms gap.
    Dojo.Cluster.MDNS.goodbye(old_ips)

    new_addrs = Enum.map(new_ips, fn ip -> %{ip: ip, port: port} end)

    # 2. Update Partisan's config so node_spec() returns new addresses.
    :partisan_config.set(:listen_addrs, new_addrs)

    Logger.info("[LC] partisan_config:listen_addrs set → #{inspect(new_addrs)}")

    # 2.5 Refresh the HyParView manager's cached self-spec.
    #     init/1 caches partisan:node_spec() in State#state.node_spec and
    #     uses it as `Myself` in every outgoing JOIN / NEIGHBOR /
    #     FORWARD_JOIN / SHUFFLE message, plus as the self element in the
    #     active view set. Without this refresh, peers that process our
    #     next JOIN will call connect(OurStaleSpec), dial dead IPs, fail
    #     to add us to their active view, and never create the reverse
    #     outbound connection that Phoenix.PubSub + Phoenix.Tracker need
    #     to dispatch by name — presence never re-converges.
    refresh_hyparview_node_spec()

    # 3. Restart listeners — if bind fails, revert config and bail.
    #    Without validation, we'd advertise IPs with no listener bound.
    case restart_listeners() do
      :ok ->
        # 4. Force disconnect stale connections.
        #    TCP connections on old IPs are half-dead; disconnecting triggers HyParView healing.
        disconnect_stale_peers()

        Dojo.Cluster.MDNS.PartisanAdapter.lc_snapshot_views("hot-swap:after-disconnect")

        # 4.5 Reset adapter failure tracking — this is a network change, not peer death.
        #     Without this, the adapter misinterprets post-disconnect connection failures
        #     as peer death and evicts peers that are still alive on the new network.
        Dojo.Cluster.MDNS.PartisanAdapter.on_network_change()

        # 5. Rejoin multicast on the main mDNS socket for the new interfaces.
        #    Without this, the socket can only hear multicast on the old interfaces.
        #    Pass old_ips explicitly — by this point routable_ipv4_addrs() returns
        #    the new IPs, so the handler needs old_ips to know what to drop.
        GenServer.cast(Dojo.Cluster.MDNS, {:rejoin_multicast, old_ips, new_ips})

        # 6. Re-announce on NEW IPs — make us visible on the new network immediately
        #    instead of waiting up to 5s for the next mDNS lookup cycle.
        Dojo.Cluster.MDNS.reannounce(new_ips)

        # 7. Update addr cache and notify all Tables on this node
        new_addr = Dojo.Cluster.Routing.routable_addr()
        :persistent_term.put({Dojo.Gate, :addr}, new_addr)

        if Application.get_env(:dojo, :routing_strategy) == Dojo.Cluster.Routing.Local do
          Phoenix.PubSub.local_broadcast(
            Dojo.PubSub,
            "system:network",
            {:network_change, new_addr}
          )

          Logger.info("[NetworkMonitor] addr updated → #{new_addr}, broadcast to system:network")
        else
          Logger.info("[NetworkMonitor] addr updated → #{new_addr}")
        end

        Logger.info("[LC] hot-swap DONE")
        Dojo.Cluster.MDNS.PartisanAdapter.lc_snapshot_views("hot-swap:after")

      :error ->
        # Bind failed — revert config so we don't advertise unreachable addrs.
        # The next poll cycle will re-detect the IP change and retry.
        old_addrs = Enum.map(old_ips, fn ip -> %{ip: ip, port: port} end)
        :partisan_config.set(:listen_addrs, old_addrs)

        Logger.warning(
          "[NetworkMonitor] listener bind failed, reverted config — will retry next poll"
        )
    end
  end

  defp refresh_hyparview_node_spec do
    try do
      case GenServer.call(:partisan_hyparview_peer_service_manager, :refresh_node_spec, 5_000) do
        :updated -> Logger.info("[NetworkMonitor] hyparview node_spec refreshed")
        :unchanged -> :ok
        other -> Logger.debug("[NetworkMonitor] hyparview refresh: #{inspect(other)}")
      end
    catch
      kind, reason ->
        Logger.warning("[NetworkMonitor] hyparview refresh failed: #{inspect({kind, reason})}")
        :ok
    end
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
              :ok

            {:error, reason} ->
              Logger.error("[NetworkMonitor] acceptor pool restart failed: #{inspect(reason)}")
              :error
          end

        {:error, reason} ->
          Logger.error("[NetworkMonitor] acceptor pool terminate failed: #{inspect(reason)}")
          :error
      end
    rescue
      e ->
        Logger.error("[NetworkMonitor] listener restart error: #{inspect(e)}")
        :error
    end
  end

  defp disconnect_stale_peers do
    try do
      case :partisan_peer_service.members() do
        {:ok, members} when is_list(members) and members != [] ->
          Logger.info("[LC] disconnect_stale_peers members=#{inspect(members)}")

          # Clear PLUMTREE_OUTSTANDING lazy push entries for these peers BEFORE
          # leaving. Without this, reconnection triggers a burst of stale
          # i_have messages from accumulated outstanding entries.
          clear_outstanding_for_peers(members)

          # Use `leave` (not `disconnect`) so HyParView's active AND passive
          # views are purged atomically. `disconnect` only kills TCP + ETS
          # records; it leaves stale specs in views, causing `random_promotion`
          # to pick them every 3s and endlessly retry connections to dead IPs.
          # With intro of name-aware leave handler partisan now removes by name so
          # stale `listen_addrs` don't block matching.
          Enum.each(members, fn member ->
            Logger.info("[LC] leave peer #{inspect(member)}")

            try do
              :partisan_peer_service.leave(%{
                name: member,
                listen_addrs: [],
                channels: %{}
              })
            catch
              _, _ -> :ok
            end
          end)

        _ ->
          Logger.info("[LC] disconnect_stale_peers members=[] — nothing to leave")
          :ok
      end
    rescue
      _ -> :ok
    end
  end

  defp clear_outstanding_for_peers(members) do
    # PLUMTREE_OUTSTANDING is a duplicate_bag ETS table owned by
    # partisan_plumtree_broadcast. Entries are keyed by peer node.
    # Deleting entries for disconnecting peers prevents stale i_have bursts.
    Enum.each(members, fn member ->
      try do
        :ets.delete(:partisan_plumtree_broadcast, member)
      catch
        _, _ -> :ok
      end
    end)
  rescue
    _ -> :ok
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
