defmodule Dojo.Cluster.DNS.Adapter do
  @moduledoc """
  DNS-based Partisan peer discovery adapter.

  Resolves DNS A/AAAA records to discover peers, then constructs Partisan
  node specs for each discovered IP. Works with any platform that provides
  DNS-based service discovery: Fly.io internal DNS, Kubernetes headless
  services, Consul DNS, etc.

  ## Name convention

  mDNS carries node names in TXT records. DNS only gives IPs. This adapter
  derives Partisan names deterministically: `<prefix>@<ip>`. Both the node
  itself (configured in runtime.exs) and peers discovering it agree on this
  convention, so no metadata exchange is needed.

  ## Configuration

  All values are injected via Partisan's `peer_discovery.config` map — the
  adapter reads zero env vars:

      config :partisan,
        peer_discovery: %{
          type: Dojo.Cluster.DNS.Adapter,
          config: %{
            query: "myapp.internal",   # DNS name to resolve
            port: 9090,                # Partisan listen port (fixed)
            own_ip: "fdaa:0:...",      # This node's IP (for self-filtering)
            name_prefix: "dojo"        # Optional, default "dojo"
          }
        }
  """
  @behaviour :partisan_peer_discovery_agent
  require Logger

  @impl true
  def init(opts) do
    query = Map.fetch!(opts, :query)
    port = Map.fetch!(opts, :port)
    own_ip = Map.fetch!(opts, :own_ip)
    name_prefix = Map.get(opts, :name_prefix, "dojo")

    Logger.info("[DNS.Adapter] init query=#{query} port=#{port} own_ip=#{own_ip}")
    {:ok, %{query: query, port: port, own_ip: own_ip, name_prefix: name_prefix}}
  end

  @impl true
  def lookup(%{query: query, port: port, own_ip: own_ip, name_prefix: prefix} = state, _timeout) do
    channels = Application.get_env(:partisan, :channels, %{})

    specs =
      query
      |> resolve_peers()
      |> Enum.reject(fn ip_str -> ip_str == own_ip end)
      |> Enum.map(fn ip_str ->
        {:ok, ip_tuple} = :inet.parse_address(String.to_charlist(ip_str))

        %{
          name: :"#{prefix}@#{ip_str}",
          listen_addrs: [%{ip: ip_tuple, port: port}],
          channels: channels
        }
      end)

    if specs != [] do
      Logger.debug("[DNS.Adapter] discovered #{length(specs)} peers via #{query}")
    end

    {:ok, specs, state}
  rescue
    e ->
      Logger.warning("[DNS.Adapter] lookup failed: #{Exception.message(e)}")
      {:ok, [], state}
  catch
    :exit, reason ->
      Logger.warning("[DNS.Adapter] lookup exited: #{inspect(reason)}")
      {:ok, [], state}
  end

  defp resolve_peers(query) do
    charlist = String.to_charlist(query)

    # Try AAAA records first (Fly uses IPv6 internally), fall back to A.
    case :inet_res.lookup(charlist, :in, :aaaa) do
      [] ->
        :inet_res.lookup(charlist, :in, :a)
        |> Enum.map(fn ip -> ip |> :inet.ntoa() |> to_string() end)

      aaaa ->
        Enum.map(aaaa, fn ip -> ip |> :inet.ntoa() |> to_string() end)
    end
  end
end
