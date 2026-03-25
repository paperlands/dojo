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
