defmodule Dojo.Cluster.MDNS.PartisanAdapter do
  @moduledoc """
  Partisan transport adapter for mDNS discovery.

  Implements both `Dojo.Cluster.Discovery` (for the mDNS engine) and
  `:partisan_peer_discovery_agent` (for Partisan's discovery polling).
  """
  @behaviour Dojo.Cluster.Discovery
  @behaviour :partisan_peer_discovery_agent

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
    specs =
      Enum.map(peers, fn {name, ip, port} ->
        %{name: name, listen_addrs: [%{ip: ip, port: port}], channels: channels()}
      end)

    :partisan_peer_service.update_members(specs)
    :ok
  end

  @impl Dojo.Cluster.Discovery
  def on_peer_departed(name) do
    :partisan_peer_service.leave(%{name: name, listen_addrs: [], channels: channels()})
    :ok
  rescue
    _ -> :ok
  end

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
  end
end
