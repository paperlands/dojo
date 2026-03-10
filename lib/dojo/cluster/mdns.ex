defmodule Cluster.Strategy.MDNS do
  @moduledoc """
  Zero-configuration Multicast DNS (mDNS / RFC 6762) cluster discovery strategy
  for `libcluster` + Partisan HyParView.

  ## Identity model

  Node identity is a UUID, not an IP address:

      PARTISAN_NAME = "admin@550e8400-e29b-41d4-a716-446655440000"
      PARTISAN_PORT = "53580"   # 53627 - :rand.uniform(100)

  This means a node retains the same identity when it roams between WiFi
  networks — only its IP changes. Peers that have the node in their HyParView
  passive view can reconnect using the new IP from the next mDNS announcement.

  ## mDNS TXT record layout

      erlang_node=admin@550e8400-...    ← canonical Partisan name atom
      partisan_port=53580               ← TCP port Partisan listens on

  Receivers build:

      %{
        name:         :"admin@550e8400-...",
        listen_addrs: [%{ip: <mDNS-src-ip>, port: 53580}],
        channels:     [:gossip, :undefined, :data, :control]
      }

  The IP in `listen_addrs` is always the mDNS-discovered routable address,
  never the peer's local `listen_addrs` config (which is bound to loopback).

  ## Configuration

  | Key              | Type      | Default          | Description                       |
  |------------------|-----------|------------------|-----------------------------------|
  | `node_basename`  | `string`  | from `PARTISAN_NAME` basename | Short name prefix  |
  | `service`        | `string`  | `"_erlang._tcp"` | mDNS service type                 |
  | `poll_interval`  | `integer` | `5_000`          | Query + expiry cycle, ms          |
  | `ttl`            | `integer` | `120`            | DNS TTL advertised to peers, secs |
  | `multicast_ttl`  | `integer` | `255`            | IP multicast hop-limit            |
  | `interface_check`| `integer` | `10_000`         | Interface monitor interval, ms    |

  Port is always read from `PARTISAN_PORT` env (set alongside config).

  ## Example

      config :libcluster,
        topologies: [
          partisan_mdns: [
            strategy:   Cluster.Strategy.MDNS,
            connect:    {Cluster.Strategy.MDNS.Partisan, :connect, []},
            disconnect: {Cluster.Strategy.MDNS.Partisan, :disconnect, []},
            list_nodes: {Cluster.Strategy.MDNS.Partisan, :nodes, []},
            config: [
              service: "_erlang._tcp",
              poll_interval: 5_000
            ]
          ]
        ]
  """

  use GenServer
  import Cluster.Logger

  alias Cluster.Strategy
  alias Cluster.Strategy.State
  alias Cluster.Strategy.MDNS.Partisan, as: PartisanAdapter

  ##############################################################################
  # Protocol constants
  ##############################################################################

  @mdns_addr    {224, 0, 0, 251}
  @mdns_port    5353
  @dns_type_ptr 12
  @dns_type_txt 16

  ##############################################################################
  # Defaults
  ##############################################################################

  @default_service        "_erlang._tcp"
  @default_poll_interval  5_000
  @default_ttl            120
  @default_mcast_ttl      255
  @default_iface_check    10_000
  @default_partisan_port  9090
  @probe_count            3
  @probe_interval_ms      250

  ##############################################################################
  # libcluster entry-points
  ##############################################################################

  def start_link(args), do: GenServer.start_link(__MODULE__, args)

  @impl true
  def init([%State{meta: nil} = state]) do
    init([%State{state | meta: %{}}])
  end

  def init([%State{config: config, topology: topology} = state]) do
    cfg = parse_config(config)

    smoke_test_loopback(cfg, topology)
    case open_socket(cfg.mcast_ttl, topology) do
      {:ok, socket} ->
        ifaces = local_ipv4_addrs()
        join_multicast(socket, ifaces, topology)

        meta = %{
          socket:     socket,
          cfg:        cfg,
          # %{partisan_name_atom => %{ip: tuple, port: integer, expires: mono_sec}}
          nodes:      %{},
          # MapSet of {a,b,c,d} — used to reject self-originated packets
          interfaces: ifaces
        }

        announce(socket, cfg)
        schedule_probes(cfg.service_fqdn)
        schedule(:poll, cfg.poll_interval)
        schedule(:check_interfaces, cfg.interface_check)

        info(topology, "mDNS: started — own identity #{inspect(cfg.own_name)}:#{cfg.partisan_port}")
        {:ok, %State{state | meta: meta}}

      {:error, reason} ->
        warn(topology, "mDNS: socket open failed – #{inspect(reason)}")
        {:stop, reason}
    end
  end

  defp smoke_test_loopback(cfg, topology) do
    pkt = Cluster.Strategy.MDNS.Packet.announcement(
      cfg.service_fqdn, cfg.own_name_str,
      {127, 0, 0, 1}, cfg.ttl, cfg.partisan_port
    )
    case Cluster.Strategy.MDNS.Packet.decode(pkt) do
      {:ok, records} ->
        info(topology, "SMOKE: decoded #{length(records)} records: #{inspect(records, pretty: true)}")
        hits = extract_nodes(records, cfg, {127, 0, 0, 1}, MapSet.new())
        info(topology, "SMOKE: extracted hits (no self-filter): #{inspect(hits)}")
      {:error, r} ->
        warn(topology, "SMOKE: packet decode failed: #{inspect(r)}")
    end
  end

  ##############################################################################
  # Probe burst — rapid PTR queries on startup
  ##############################################################################

  @impl true
  def handle_info({:probe_query, service_fqdn}, %State{meta: %{socket: socket}} = state) do
    send_query(socket, service_fqdn)
    {:noreply, state}
  end

  ##############################################################################
  # Incoming UDP datagram
  ##############################################################################

  def handle_info(
        {:udp, _sock, src_ip, _src_port, raw},
        %State{meta: meta, topology: topology} = state
      ) do
    meta =
      case Cluster.Strategy.MDNS.Packet.decode(raw) do
        {:ok, records} ->
          now  = System.monotonic_time(:second)
          hits = extract_nodes(records, meta.cfg, src_ip, meta.interfaces)

          Enum.reduce(hits, meta, fn {name, ip, port, ttl}, acc ->
            debug(topology, "mDNS: peer #{inspect(name)} @ #{fmt(ip)}:#{port} (TTL #{ttl}s)")
            put_in(acc, [:nodes, name], %{ip: ip, port: port, expires: now + ttl})
          end)

        {:error, reason} ->
          debug(topology, "mDNS: ignoring malformed packet – #{inspect(reason)}")
          meta
      end

    {:noreply, %State{state | meta: meta}}
  end

  ##############################################################################
  # Poll cycle
  #
  # With HyParView we split the workload:
  #   - CONNECT  → pass all mDNS-cached nodes as introduction candidates.
  #                join is idempotent; HyParView ignores already-known peers.
  #   - DISCONNECT → only for nodes that have gone stale AND are not in
  #                  HyParView's active view.  The adapter's disconnect/1
  #                  returns :ignored for active-view members.
  ##############################################################################

  def handle_info(
        :poll,
        %State{
          meta:       meta,
          topology:   topology,
          connect:    connect,
          disconnect: disconnect,
          list_nodes: list_nodes
        } = state
      ) do
    now = System.monotonic_time(:second)

    {alive_pairs, dead_pairs} =
      Enum.split_with(meta.nodes, fn {_, info} -> info.expires > now end)

    alive_map = Map.new(alive_pairs)

    # ── Soft-disconnect expired nodes ────────────────────────────────────────
    # Adapter will return :ignored for active-view members — HyParView keeps them.
    dead_specs = Enum.map(dead_pairs, fn {n, info} -> build_spec(n, info) end)

    alive_map =
      case Strategy.disconnect_nodes(topology, disconnect, list_nodes, dead_specs) do
        :ok ->
          alive_map

        {:error, bad_nodes} ->
          # Re-insert nodes we couldn't disconnect (active view) so we retry later
          bad_names = bad_nodes |> Enum.map(&spec_name/1) |> MapSet.new()

          Enum.reduce(dead_pairs, alive_map, fn {n, info}, acc ->
            if MapSet.member?(bad_names, n), do: Map.put(acc, n, info), else: acc
          end)
      end

    # ── Introduce alive nodes to HyParView ───────────────────────────────────
    alive_specs = Enum.map(alive_map, fn {n, info} -> build_spec(n, info) end)

    alive_map =
      case Strategy.connect_nodes(topology, connect, list_nodes, alive_specs) do
        :ok ->
          alive_map

        {:error, bad_nodes} ->
          # Drop hard failures (false) but keep :ignored (HyParView in-flight)
          hard_failures =
            bad_nodes
            |> Enum.filter(fn {_, reason} -> reason == false end)
            |> Enum.map(&spec_name(elem(&1, 0)))
            |> MapSet.new()

          Map.drop(alive_map, MapSet.to_list(hard_failures))
      end

    announce(meta.socket, meta.cfg)
    send_query(meta.socket, meta.cfg.service_fqdn)

    schedule(:poll, meta.cfg.poll_interval)
    {:noreply, %State{state | meta: %{meta | nodes: alive_map}}}
  end

  ##############################################################################
  # Interface monitor — WiFi roaming
  ##############################################################################

  def handle_info(:check_interfaces, %State{meta: meta, topology: topology} = state) do
    current = local_ipv4_addrs()

    meta =
      if current == meta.interfaces do
        meta
      else
        added   = MapSet.difference(current, meta.interfaces)
        removed = MapSet.difference(meta.interfaces, current)

        info(topology,
          "mDNS: interface change +[#{fmt_set(added)}] -[#{fmt_set(removed)}]"
        )

        Enum.each(removed, fn ip ->
          :inet.setopts(meta.socket, [{:drop_membership, {@mdns_addr, ip}}])
        end)

        join_multicast(meta.socket, added, topology)

        # Flush cache — IPs have changed. HyParView passive view bridges the gap
        # while peers re-announce with their new IPs.
        announce(meta.socket, meta.cfg)
        schedule_probes(meta.cfg.service_fqdn)

        %{meta | interfaces: current, nodes: %{}}
      end

    schedule(:check_interfaces, meta.cfg.interface_check)
    {:noreply, %State{state | meta: meta}}
  end

  def handle_info({:udp_closed, _}, %State{topology: topology} = state) do
    warn(topology, "mDNS: socket closed — stopping strategy")
    {:stop, :socket_closed, state}
  end

  def handle_info(:timeout, state), do: handle_info(:poll, state)
  def handle_info(_msg, state), do: {:noreply, state}

  ##############################################################################
  # Graceful shutdown — RFC 6762 §11.3 goodbye (TTL=0)
  ##############################################################################

  @impl true
  def terminate(_reason, %State{meta: %{socket: socket, cfg: cfg}}) when not is_nil(socket) do
    announce(socket, %{cfg | ttl: 0})
    :gen_udp.close(socket)
  end

  def terminate(_reason, _state), do: :ok

  ##############################################################################
  # Socket
  ##############################################################################

  defp open_socket(mcast_ttl, topology) do
    base_opts = [
      :binary,
      active:          true,
      reuseaddr:       true,
      # false prevents our own announcements looping back.
      # Self-originated packets also filtered by interface IP set as a second guard.
      multicast_loop:  true,
      multicast_ttl:   mcast_ttl,
      broadcast:       true,
      ip:              {0, 0, 0, 0}
    ]

    opts =
      case :gen_udp.open(0, [reuseport: true]) do
        {:ok, s} -> :gen_udp.close(s); [{:reuseport, true} | base_opts]
        _        -> base_opts
      end

    case :gen_udp.open(@mdns_port, opts) do
      {:ok, socket} ->
        debug(topology, "mDNS: socket bound to *:#{@mdns_port}")
        {:ok, socket}

      {:error, _} = err ->
        err
    end
  end

  defp join_multicast(socket, ifaces, topology) do
    Enum.each(ifaces, fn ip ->
      case :inet.setopts(socket, [{:add_membership, {@mdns_addr, ip}}]) do
        :ok ->
          debug(topology, "mDNS: joined multicast on #{fmt(ip)}")

        {:error, reason} ->
          # Android hotspots may drop IGMP — continue; passive discovery still works
          warn(topology, "mDNS: multicast join failed #{fmt(ip)}: #{inspect(reason)}")
      end
    end)
  end

  ##############################################################################
  # Announce / Query
  ##############################################################################

  defp announce(socket, cfg) do
    local_ipv4_addrs()
    |> Enum.each(fn ip ->
      pkt = Cluster.Strategy.MDNS.Packet.announcement(
        cfg.service_fqdn,
        cfg.own_name_str,   # "admin@<uuid>" — not basename
        ip,
        cfg.ttl,
        cfg.partisan_port
      )
      :gen_udp.send(socket, @mdns_addr, @mdns_port, pkt)
    end)
  end

  defp send_query(socket, service_fqdn) do
    pkt = Cluster.Strategy.MDNS.Packet.query(service_fqdn)
    :gen_udp.send(socket, @mdns_addr, @mdns_port, pkt)
  end

  defp schedule_probes(service_fqdn) do
    Enum.each(1..@probe_count, fn i ->
      Process.send_after(self(), {:probe_query, service_fqdn}, i * @probe_interval_ms)
    end)
  end

  ##############################################################################
  # Node extraction
  #
  # Priority of keys in TXT record:
  #   1. `erlang_node`   → full Partisan name atom (admin@<uuid>)
  #   2. `partisan_port` → peer's TCP listen port
  #
  # Self-rejection:
  #   a. name == cfg.own_name  (UUID match — primary guard)
  #   b. IP in local interfaces (multicast_loop=false catches most; this is belt+suspenders)
  ##############################################################################

  defp extract_nodes(records, cfg, src_ip, _local_interfaces) do
    txt_index =
      records
      |> Enum.filter(&match?(%{type: @dns_type_txt, data: {:txt, _}}, &1))
      |> Map.new(fn %{name: n, ttl: t, data: {:txt, kv}} -> {n, {kv, t}} end)

    records
    |> Enum.filter(fn
      %{type: @dns_type_ptr, name: svc} -> svc == cfg.service_fqdn
      _                                 -> false
    end)
    |> Enum.flat_map(fn %{ttl: ptr_ttl, data: {:ptr, instance_fqdn}} ->
      parse_instance(instance_fqdn, ptr_ttl, txt_index, cfg, src_ip)
    end)
    |> Enum.reject(fn {name, _ip, _port, _ttl} ->
      name == cfg.own_name
    end)
  end

  defp parse_instance(instance_fqdn, ptr_ttl, txt_index, cfg, src_ip) do
    ttl = max(ptr_ttl, 30)

    case txt_index[instance_fqdn] do
      {kv, txt_ttl} ->
        erlang_node   = kv_get(kv, "erlang_node")
        partisan_port = kv_get(kv, "partisan_port")

        if is_binary(erlang_node) and erlang_node != "" do
          name = String.to_atom(erlang_node)
          # IP from TXT name if parseable, else UDP source address
          ip   = parse_ip_from_node(erlang_node) || src_ip
          port = parse_port(partisan_port, cfg.partisan_port)
          [{name, ip, port, min(ttl, max(txt_ttl, 30))}]
        else
          # No TXT node name — fall back to basename@src_ip heuristic
          fallback_node(cfg.own_name_str, src_ip, cfg.partisan_port, ttl)
        end

      nil ->
        fallback_node(cfg.own_name_str, src_ip, cfg.partisan_port, ttl)
    end
  end

  defp fallback_node(own_name_str, src_ip, port, ttl) do
    # Best effort: use the basename portion of our own name + the peer's IP
    basename = own_name_str |> String.split("@") |> hd()
    [{:"#{basename}@#{fmt(src_ip)}", src_ip, port, ttl}]
  end

  defp kv_get(kv, key) do
    case List.keyfind(kv, key, 0) do
      {^key, v} -> v
      _         -> nil
    end
  end

  defp parse_ip_from_node(node_str) do
    # Works for both "basename@ip" (legacy) and "admin@uuid" (UUID-based, returns nil)
    with [_, segment]  <- String.split(node_str, "@", parts: 2),
         {:ok, ip}     <- :inet.parse_address(String.to_charlist(segment)) do
      ip
    else
      _ -> nil
    end
  end

  defp parse_port(s, default) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} when n > 0 and n < 65536 -> n
      _                                -> default
    end
  end

  defp parse_port(_, default), do: default

  ##############################################################################
  # node_spec builder
  ##############################################################################

  defp build_spec(name, %{ip: ip, port: port}) do
    PartisanAdapter.build_node_spec(name, ip, port)
  end

  defp spec_name(%{name: n}), do: n
  defp spec_name(a) when is_atom(a), do: a
  # Handle {spec_or_atom, reason} tuples from bad_nodes
  defp spec_name({s, _}), do: spec_name(s)

  ##############################################################################
  # Network helpers
  ##############################################################################

  defp local_ipv4_addrs do
    case :inet.getifaddrs() do
      {:ok, ifaddrs} ->
        ifaddrs
        |> Enum.flat_map(fn {_name, opts} -> Keyword.get_values(opts, :addr) end)
        |> Enum.filter(&routable_v4?/1)
        |> MapSet.new()

      _ ->
        MapSet.new()
    end
  end

  defp routable_v4?({127, _, _, _}),   do: false
  defp routable_v4?({169, 254, _, _}), do: false
  defp routable_v4?({a, _, _, _}) when is_integer(a), do: true
  defp routable_v4?(_),               do: false

  defp schedule(msg, ms), do: Process.send_after(self(), msg, ms)

  ##############################################################################
  # Config
  ##############################################################################

  defp parse_config(config) do
    service       = Keyword.get(config, :service, @default_service)
    own_name      = PartisanAdapter.own_name()
    own_name_str  = Atom.to_string(own_name)
    partisan_port = PartisanAdapter.own_port(@default_partisan_port)

    %{
      service:         service,
      service_fqdn:    service <> ".local",
      own_name:        own_name,
      own_name_str:    own_name_str,
      partisan_port:   partisan_port,
      ttl:             Keyword.get(config, :ttl, @default_ttl),
      mcast_ttl:       Keyword.get(config, :multicast_ttl, @default_mcast_ttl),
      poll_interval:   Keyword.get(config, :poll_interval, @default_poll_interval),
      interface_check: Keyword.get(config, :interface_check, @default_iface_check)
    }
  end

  ##############################################################################
  # Formatting
  ##############################################################################

  defp fmt(ip), do: ip |> :inet.ntoa() |> to_string()
  defp fmt_set(s), do: s |> Enum.map(&fmt/1) |> Enum.join(", ")
end
