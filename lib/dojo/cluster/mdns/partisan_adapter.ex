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

  alias Dojo.Cluster.MDNS.PeerTrack

  @known_peers_table :mdns_known_peers

  @track_config %{
    grace_s: 15,
    max_failures: 3,
    cooldown_s: 30
  }

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

    update_specs = Enum.filter(specs, &evaluate_peer(&1, @track_config))

    if update_specs != [] do
      :partisan_peer_service.update_members(update_specs)
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

  @doc """
  Clear all peer tracking after a network change (WiFi roam / hotspot switch).

  Called by NetworkMonitor when IPs change. Deletes all entries from the
  known peers table so the next mDNS discovery poll treats every peer as
  "new" — triggering `join` (not `update_members`). This is critical because
  `join` → `add_to_active_view` fires the name-aware dedup that replaces
  stale specs with old IPs.
  """
  def on_network_change do
    ensure_known_peers_table()
    :ets.delete_all_objects(@known_peers_table)
    Logger.info("[PartisanAdapter] known peers cleared — will rejoin on next discovery")
  rescue
    _ -> :ok
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
# ── [LC] Instrumentation helpers ────────────────────────────────────────

  @doc """
  Snapshot HyParView active/passive views with full listen_addrs.
  Tagged with `label` so the caller can correlate across events.
  """
  def lc_snapshot_views(label) do
    try do
      {:ok, active} = :partisan_hyparview_peer_service_manager.active()
      {:ok, passive} = :partisan_hyparview_peer_service_manager.passive()

      Logger.info(
        "[LC] hyparview[#{label}] active=#{inspect(lc_fmt_set(active))} " <>
          "passive=#{inspect(lc_fmt_set(passive))}"
      )
    rescue
      _ -> :ok
    catch
      _, _ -> :ok
    end
  end

  @doc false
  def lc_fmt_spec(%{name: name, listen_addrs: addrs}) do
    addr_strs =
      Enum.map(addrs, fn
        %{ip: ip, port: port} -> "#{lc_fmt_ip(ip)}:#{port}"
        other -> inspect(other)
      end)

    "#{name}→[#{Enum.join(addr_strs, ",")}]"
  end

  def lc_fmt_spec(other), do: inspect(other)

  defp lc_fmt_set(set) do
    set |> :sets.to_list() |> Enum.map(&lc_fmt_spec/1)
  end

  defp lc_fmt_ip(ip) when is_tuple(ip), do: ip |> :inet.ntoa() |> to_string()
  defp lc_fmt_ip(ip), do: inspect(ip)

  # ── [LC] Instrumentation helpers ────────────────────────────────────────

  @doc """
  Snapshot HyParView active/passive views with full listen_addrs.
  Tagged with `label` so the caller can correlate across events.
  """
  def lc_snapshot_views(label) do
    try do
      {:ok, active} = :partisan_hyparview_peer_service_manager.active()
      {:ok, passive} = :partisan_hyparview_peer_service_manager.passive()

      Logger.info(
        "[LC] hyparview[#{label}] active=#{inspect(lc_fmt_set(active))} " <>
          "passive=#{inspect(lc_fmt_set(passive))}"
      )
    rescue
      _ -> :ok
    catch
      _, _ -> :ok
    end
  end

  @doc false
  def lc_fmt_spec(%{name: name, listen_addrs: addrs}) do
    addr_strs =
      Enum.map(addrs, fn
        %{ip: ip, port: port} -> "#{lc_fmt_ip(ip)}:#{port}"
        other -> inspect(other)
      end)

    "#{name}→[#{Enum.join(addr_strs, ",")}]"
  end

  def lc_fmt_spec(other), do: inspect(other)

  defp lc_fmt_set(set) do
    set |> :sets.to_list() |> Enum.map(&lc_fmt_spec/1)
  end

  defp lc_fmt_ip(ip) when is_tuple(ip), do: ip |> :inet.ntoa() |> to_string()
  defp lc_fmt_ip(ip), do: inspect(ip)

  # ── Peer evaluation pipeline ────────────────────────────────────────
  # observe → compare → execute
  #
  # PeerTrack.observe/4 is the pure state transition.
  # execute_transition/3 derives transport effects from old → new state.
  # Returns true if the peer should be included in the update_members batch.

  defp evaluate_peer(spec, config) do
    old = lookup_track(spec.name)
    connected? = if old != nil, do: peer_connected?(spec.name), else: false
    new = PeerTrack.observe(old, connected?, spec.name, config)

    persist_track(spec.name, new)
    execute_transition(old, new, spec)
  end

  defp persist_track(name, nil), do: :ets.delete(@known_peers_table, name)

  defp persist_track(_name, %PeerTrack{} = t),
    do: :ets.insert(@known_peers_table, PeerTrack.to_ets(t))

  # nil → active: first discovery → join
  defp execute_transition(nil, %PeerTrack{status: :active}, spec) do
    Logger.info("[PartisanAdapter] joining new mDNS peer: #{spec.name}")
    :partisan_peer_service.join(spec)
    false
  end

  # active → evicted: persistent TCP failure → evict from mDNS cache
  defp execute_transition(%PeerTrack{status: :active}, %PeerTrack{status: :evicted}, spec) do
    Logger.warning("[PartisanAdapter] evicting #{spec.name} — persistent TCP failure")
    Dojo.Cluster.MDNS.evict_peer(spec.name)
    false
  end

  # evicted → nil: cooldown elapsed → eligible for rediscovery
  defp execute_transition(%PeerTrack{status: :evicted}, nil, spec) do
    Logger.debug("[PartisanAdapter] #{spec.name} cooldown elapsed, eligible for rejoin")
    false
  end

  # active → active: healthy (include in update_members batch)
  defp execute_transition(%PeerTrack{status: :active}, %PeerTrack{status: :active}, _spec),
    do: true

  # evicted → evicted, or any other: noop
  defp execute_transition(_old, _new, _spec), do: false

  defp lookup_track(name) do
    case :ets.lookup(@known_peers_table, name) do
      [tuple] -> PeerTrack.from_ets(tuple)
      [] -> nil
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
