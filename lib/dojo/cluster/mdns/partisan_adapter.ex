defmodule Dojo.Cluster.MDNS.PartisanAdapter do
  @moduledoc """
  Partisan transport adapter for mDNS discovery.

  Implements both `Dojo.Cluster.Discovery` (for the mDNS engine) and
  `:partisan_peer_discovery_agent` (for Partisan's discovery polling).

  Uses `join` for newly-discovered peers (immediate TCP connect) and
  `update_members` for already-known peers (passive view refresh).
  """
  @behaviour Dojo.Cluster.Discovery
  @behaviour :partisan_peer_discovery_agent
  require Logger

  @known_peers_table :mdns_known_peers
  # Skip peers that have been unreachable for this many consecutive poll cycles
  @max_connect_failures 3
  # Grace period (seconds) before we start counting failures for a newly joined peer
  @connect_grace_s 15
  # Cooldown (seconds) after eviction before allowing rejoin
  @eviction_cooldown_s 30

  # ── Discovery behaviour ──────────────────────────────────────────────────

  @impl Dojo.Cluster.Discovery
  def identity do
    name =
      case System.get_env("PARTISAN_NAME") do
        s when is_binary(s) and s != "" -> String.to_atom(s)
        _ -> Application.get_env(:partisan, :name, node())
      end

    port =
      case System.get_env("PARTISAN_PORT") do
        s when is_binary(s) ->
          case Integer.parse(s) do
            {n, ""} when n > 0 and n < 65536 -> n
            _ -> 9090
          end

        _ ->
          9090
      end

    {name, port}
  end

  @impl Dojo.Cluster.Discovery
  def channels do
    case Application.get_env(:partisan, :channels) do
      map when is_map(map) and map_size(map) > 0 -> map
      _ -> %{gossip: %{monotonic: false, parallelism: 1, compression: false}}
    end
  end

  @impl Dojo.Cluster.Discovery
  def on_peers_discovered(peers) do
    ensure_known_peers_table()

    specs =
      Enum.map(peers, fn {name, ip, port} ->
        %{name: name, listen_addrs: [%{ip: ip, port: port}], channels: channels()}
      end)

    {new_specs, existing_specs} =
      Enum.split_with(specs, fn spec ->
        :ets.lookup(@known_peers_table, spec.name) == []
      end)

    # Join NEW peers immediately — triggers TCP connect + JOIN handshake
    # This bypasses the passive view and directly enters the active view.
    # Critical for Windows nodes that can't receive UDP multicast but can
    # accept TCP connections from peers that discovered them.
    Enum.each(new_specs, fn spec ->
      Logger.info("[PartisanAdapter] joining new mDNS peer: #{spec.name}")
      :partisan_peer_service.join(spec)
      # {name, joined_at, failure_count}
      :ets.insert(@known_peers_table, {spec.name, System.monotonic_time(:second), 0})
    end)

    # For existing peers: cross-reference mDNS cache with Partisan connection state.
    # Peers that remain in mDNS but persistently fail TCP get evicted.
    {healthy_specs, _evicted} =
      Enum.split_with(existing_specs, fn spec ->
        check_and_track_connection(spec.name)
      end)

    # Refresh healthy existing peers via passive view update
    if healthy_specs != [] do
      :partisan_peer_service.update_members(healthy_specs)
    end

    :ok
  rescue
    e ->
      maybe_warn_partisan_unavailable("on_peers_discovered", e)
      :ok
  catch
    :exit, reason ->
      maybe_warn_partisan_unavailable("on_peers_discovered", {:exit, reason})
      :ok
  end

  @impl Dojo.Cluster.Discovery
  def on_peer_departed(name) do
    ensure_known_peers_table()
    :ets.delete(@known_peers_table, name)
    :partisan_peer_service.leave(%{name: name, listen_addrs: [], channels: channels()})
    :ok
  rescue
    e ->
      maybe_warn_partisan_unavailable("on_peer_departed", e)
      :ok
  catch
    :exit, reason ->
      maybe_warn_partisan_unavailable("on_peer_departed", {:exit, reason})
      :ok
  end

  @impl Dojo.Cluster.Discovery
  def supports_node_monitor?, do: false

  @impl Dojo.Cluster.Discovery
  def diag do
    %{
      identity: safe(fn -> identity() end),
      members: safe(fn -> :partisan_peer_service.members() end),
      connections: partisan_connection_report(),
      hyparview: hyparview_state(),
      discovery_agent: safe(fn -> :partisan_peer_discovery_agent.status() end),
      config: partisan_config_snapshot()
    }
  end

  defp partisan_connection_report do
    safe(fn ->
      nodes = :partisan_peer_connections.nodes()

      Enum.map(nodes, fn node ->
        count = :partisan_peer_connections.count(node)
        fully = :partisan_peer_connections.is_fully_connected(node)

        channels =
          safe(fn ->
            :partisan_peer_connections.connections(node)
            |> Enum.map(fn conn ->
              %{
                channel: :partisan_peer_connections.channel(conn),
                pid: :partisan_peer_connections.pid(conn),
                listen_addr: :partisan_peer_connections.listen_addr(conn)
              }
            end)
          end)

        %{
          node: node,
          connection_count: count,
          fully_connected: fully,
          channels: channels || []
        }
      end)
    end)
  end

  defp hyparview_state do
    safe(fn ->
      {:ok, active} = :partisan_hyparview_peer_service_manager.active()
      {:ok, passive} = :partisan_hyparview_peer_service_manager.passive()

      %{
        active_view: :sets.to_list(active) |> Enum.map(& &1.name),
        active_size: :sets.size(active),
        passive_view: :sets.to_list(passive) |> Enum.map(& &1.name),
        passive_size: :sets.size(passive)
      }
    end)
  end

  defp partisan_config_snapshot do
    safe(fn ->
      %{
        name: :partisan_config.get(:name),
        listen_addrs: :partisan_config.get(:listen_addrs),
        channels: :partisan_config.get(:channels),
        parallelism: :partisan_config.get(:parallelism, 1),
        connect_disterl: :partisan_config.get(:connect_disterl, false),
        tls: :partisan_config.get(:tls, false),
        peer_service_manager: :partisan_config.get(:peer_service_manager),
        connect_timeout: :partisan_config.get(:connect_timeout, 5000)
      }
    end)
  end

  # Returns true if the peer is healthy (keep in rotation), false if evicted.
  # Tracks consecutive connection failures in ETS and evicts from mDNS cache
  # when a peer exceeds @max_connect_failures after the grace period.
  defp check_and_track_connection(name) do
    now = System.monotonic_time(:second)

    case :ets.lookup(@known_peers_table, name) do
      [{^name, joined_at, failures}] ->
        connected = peer_connected?(name)

        cond do
          connected ->
            # Reset failure count — peer is alive
            if failures > 0 do
              :ets.insert(@known_peers_table, {name, joined_at, 0})
            end

            true

          now - joined_at < @connect_grace_s ->
            # Still in grace period — don't count failures yet
            true

          true ->
            new_failures = failures + 1
            :ets.insert(@known_peers_table, {name, joined_at, new_failures})

            if new_failures >= @max_connect_failures do
              Logger.warning(
                "[PartisanAdapter] evicting #{name} — #{new_failures} consecutive poll cycles without TCP connection"
              )

              # Record eviction time — cooldown prevents rapid rejoin storm
              :ets.insert(@known_peers_table, {name, :evicted, System.monotonic_time(:second)})
              Dojo.Cluster.MDNS.evict_peer(name)
              false
            else
              Logger.debug(
                "[PartisanAdapter] #{name} not connected (#{new_failures}/#{@max_connect_failures})"
              )

              true
            end
        end

      # Evicted peer — in cooldown, wait before allowing rediscovery
      [{^name, :evicted, evicted_at}] ->
        if now - evicted_at >= @eviction_cooldown_s do
          # Cooldown elapsed — clear entry so next poll treats it as new
          :ets.delete(@known_peers_table, name)

          Logger.debug("[PartisanAdapter] #{name} eviction cooldown elapsed, eligible for rejoin")
        end

        false

      # Legacy 2-tuple entry (pre-failure-tracking) — upgrade in place
      [{^name, joined_at}] ->
        :ets.insert(@known_peers_table, {name, joined_at, 0})
        true

      [] ->
        # Not in our table — shouldn't happen for existing specs, but be safe
        true
    end
  end

  defp peer_connected?(name) do
    case safe(fn -> :partisan_peer_connections.connections(name) end) do
      conns when is_list(conns) and conns != [] ->
        {alive, dead} =
          Enum.split_with(conns, fn conn ->
            pid = :partisan_peer_connections.pid(conn)
            is_pid(pid) and Process.alive?(pid)
          end)

        # Opportunistically prune dead connections we discover
        Enum.each(dead, fn conn ->
          pid = :partisan_peer_connections.pid(conn)
          safe(fn -> :partisan_peer_connections.prune(pid) end)
        end)

        alive != []

      _ ->
        false
    end
  end

  defp ensure_known_peers_table do
    case :ets.info(@known_peers_table) do
      :undefined -> :ets.new(@known_peers_table, [:named_table, :set, :public])
      _ -> :ok
    end
  rescue
    ArgumentError -> :ok
  end

  defp maybe_warn_partisan_unavailable(context, reason) do
    now = System.monotonic_time(:second)
    last = Process.get(:partisan_warn_at, 0)

    if now - last >= 30 do
      Process.put(:partisan_warn_at, now)

      Logger.warning(
        "[PartisanAdapter] #{context} failed: #{inspect(reason)} — Partisan may not be running"
      )
    end
  end

  defp safe(fun) do
    fun.()
  rescue
    e -> {:error, Exception.message(e)}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  # ── partisan_peer_discovery_agent behaviour ──────────────────────────────
  # The MDNS GenServer handles its own polling cycle. These callbacks
  # exist so Partisan's discovery agent can also query the cache.

  @impl :partisan_peer_discovery_agent
  def init(opts) do
    {:ok, %{timeout: Map.get(opts, :timeout_ms, 2_000)}}
  end

  @impl :partisan_peer_discovery_agent
  def lookup(state, _timeout) do
    peers = Dojo.Cluster.MDNS.cached_peers()

    specs =
      Enum.map(peers, fn {name, ip, port} ->
        %{name: name, listen_addrs: [%{ip: ip, port: port}], channels: channels()}
      end)

    {:ok, specs, state}
  rescue
    # Module may be temporarily unavailable during dev code reloading
    UndefinedFunctionError -> {:ok, [], state}
  catch
    :exit, _ -> {:ok, [], state}
  end
end
