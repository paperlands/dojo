defmodule Dojo.Cluster.MDNS.Discovery do
  @behaviour :partisan_peer_discovery_agent

  require Logger

  @mdns_addr   {224, 0, 0, 251}
  @mdns_port   5353
  @dns_type_ptr 12
  @dns_type_txt 16

  # ── init/1 ──────────────────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    own_name = partisan_own_name()
    own_port = partisan_own_port()
    service  = Map.get(opts, :service, "_erlang._tcp.local")
    timeout  = Map.get(opts, :timeout_ms, 2_000)

    with {:ok, socket} <- open_socket() do
      ifaces = routable_ipv4_addrs()
      join_multicast(socket, ifaces)
      Logger.info("[mDNS] agent init — #{own_name}:#{own_port} ifaces=#{inspect(ifaces)}")

      {:ok, %{
        socket:   socket,
        own_name: own_name,
        own_port: own_port,
        service:  service,
        timeout:  timeout,
        cache:    %{}
      }}
    end
  end

  # ── lookup/2 ────────────────────────────────────────────────────────────────

  @impl true
  def lookup(%{socket: socket, own_name: _own_name} = state, _timeout) do
    announce(state)
    send_query(state)

    # Drain any stale packets accumulated since last cycle before we start
    # collecting fresh responses — avoids stale cache poisoning
    flush_socket(socket)

    cache = collect(state, deadline(state.timeout))

    specs = cache |> Map.values() |> Enum.map(&build_node_spec/1)

    Logger.debug("[mDNS] lookup → #{length(specs)} peers: " <>
                 "#{inspect(Enum.map(specs, & &1.name))}")

    {:ok, specs, %{state | cache: cache}}
  rescue
    e ->
      Logger.error("[mDNS] lookup crashed: #{inspect(e)}\n#{Exception.format_stacktrace(__STACKTRACE__)}")
      {:error, e, state}
  end

  # ── Socket — active: false ──────────────────────────────────────────────────
  # active: false means NO messages land in the gen_statem mailbox between
  # lookup cycles. We pull packets explicitly with :gen_udp.recv/3.

  defp open_socket do
    base = [
      :binary,
      active:         false,    # ← KEY: we control reads, nothing leaks to gen_statem
      reuseaddr:      true,
      multicast_loop: true,     # same-machine discovery
      multicast_ttl:  255,
      ip:             {0, 0, 0, 0}
    ]

    opts = case :gen_udp.open(0, [reuseport: true]) do
      {:ok, s} -> :gen_udp.close(s); [{:reuseport, true} | base]
      _        -> base
    end

    case :gen_udp.open(@mdns_port, opts) do
      {:ok, socket} ->
        Logger.debug("[mDNS] socket opened on *:#{@mdns_port}")
        {:ok, socket}
      {:error, reason} = err ->
        Logger.error("[mDNS] socket open failed: #{inspect(reason)}")
        err
    end
  end

  defp join_multicast(socket, ifaces) do
    Enum.each(ifaces, fn ip ->
      case :inet.setopts(socket, [{:add_membership, {@mdns_addr, ip}}]) do
        :ok -> Logger.debug("[mDNS] joined multicast on #{fmt(ip)}")
        {:error, r} -> Logger.warning("[mDNS] multicast join failed #{fmt(ip)}: #{inspect(r)}")
      end
    end)
  end

  # ── Collect loop ─────────────────────────────────────────────────────────────
  # Uses :gen_udp.recv with a shrinking timeout so the full window is honoured
  # even if many packets arrive.

  defp collect(%{socket: socket, own_name: own_name, service: service} = state, deadline) do
    now = System.monotonic_time(:millisecond)
    remaining = deadline - now

    if remaining <= 0 do
      state.cache
    else
      case :gen_udp.recv(socket, 0, remaining) do
        {:ok, {src_ip, _port, raw}} ->
          cache = case Dojo.Cluster.MDNS.Packet.decode(raw) do
            {:ok, records} ->
              peers = extract_peers(records, service, src_ip)
              before_count = map_size(state.cache)

              new_cache = Enum.reduce(peers, state.cache, fn {name, ip, port}, acc ->
                if name == own_name do
                  acc
                else
                  Logger.debug("[mDNS] saw peer #{inspect(name)} @ #{fmt(ip)}:#{port}")
                  Map.put(acc, name, %{name: name, ip: ip, port: port})
                end
              end)

              if map_size(new_cache) > before_count do
                Logger.info("[mDNS] cache grew to #{map_size(new_cache)} peers")
              end

              new_cache

            {:error, reason} ->
              Logger.debug("[mDNS] decode error: #{inspect(reason)}")
              state.cache
          end

          collect(%{state | cache: cache}, deadline)

        {:error, :timeout} ->
          state.cache

        {:error, reason} ->
          Logger.warning("[mDNS] recv error: #{inspect(reason)}")
          state.cache
      end
    end
  end

  # Drain accumulated packets before fresh collect window.
  # These are stale announcements that arrived between lookup cycles.
  defp flush_socket(socket) do
    case :gen_udp.recv(socket, 0, 0) do
      {:ok, _}         -> flush_socket(socket)
      {:error, :timeout} -> :ok
      {:error, _}      -> :ok
    end
  end

  # ── Announce / Query ─────────────────────────────────────────────────────────
  # defp announce(%{socket: sock, own_name: name, own_port: port, service: svc}) do
  #   name_str = Atom.to_string(name)
    
  #   # Use Partisan's configured listen_addrs as source of truth
  #   addrs = case :partisan_config.get(:listen_addrs) do
  #             addrs when is_list(addrs) and addrs != [] ->
  #               Enum.map(addrs, fn %{ip: ip} -> ip end)
  #             _ ->
  #               routable_ipv4_addrs()  # fallback
  #           end
    
  #   Logger.debug("[mDNS] announcing #{name_str}:#{port} on #{inspect(addrs)}")
  #   Enum.each(addrs, fn ip ->
  #     pkt = Dojo.Cluster.MDNS.Packet.announcement(svc, name_str, ip, 120, port)
  #     :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
  #   end)
  # end

  # defp send_query(%{socket: sock, service: svc}) do
  #   pkt = Dojo.Cluster.MDNS.Packet.query(svc)
  #   :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
  # end

  defp announce(%{socket: sock, own_name: name, own_port: port, service: svc}) do
  name_str = Atom.to_string(name)
  addrs = routable_ipv4_addrs()
  Logger.debug("[mDNS] announcing #{name_str}:#{port} on #{inspect(addrs)}")

  Enum.each(addrs, fn ip ->
    # Force this specific packet out through THIS interface
    :inet.setopts(sock, [{:multicast_if, ip}])
    pkt = Dojo.Cluster.MDNS.Packet.announcement(svc, name_str, ip, 120, port)
    :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
  end)
end

defp send_query(%{socket: sock, service: svc}) do
  pkt = Dojo.Cluster.MDNS.Packet.query(svc)
  Enum.each(routable_ipv4_addrs(), fn ip ->
    :inet.setopts(sock, [{:multicast_if, ip}])
    :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
  end)
end

  # ── Packet parsing ───────────────────────────────────────────────────────────

  defp extract_peers(records, service, src_ip) do
    txt_idx =
      records
      |> Enum.filter(&match?(%{type: @dns_type_txt, data: {:txt, _}}, &1))
      |> Map.new(fn %{name: n, data: {:txt, kv}} -> {n, kv} end)

    records
    |> Enum.filter(&match?(%{type: @dns_type_ptr, name: ^service}, &1))
    |> Enum.flat_map(fn %{data: {:ptr, instance_fqdn}} ->
      with kv        <- Map.get(txt_idx, instance_fqdn),
           true      <- not is_nil(kv),
           node_str  <- kv_get(kv, "erlang_node"),
           true      <- is_binary(node_str) and node_str != "",
           port_str  <- kv_get(kv, "partisan_port"),
           {port, ""} <- (if is_binary(port_str), do: Integer.parse(port_str), else: :error) do
        [{String.to_atom(node_str), src_ip, port}]
      else
        _ ->
          Logger.debug("[mDNS] skipping instance #{instance_fqdn} — " <>
                       "missing/bad TXT records in #{inspect(txt_idx[instance_fqdn])}")
          []
      end
    end)
  end

  defp kv_get(kv, key) do
    case List.keyfind(kv, key, 0) do
      {^key, v} -> v
      _         -> nil
    end
  end

  # ── Node spec / channels ─────────────────────────────────────────────────────

  defp build_node_spec(%{name: name, ip: ip, port: port}) do
    %{name: name, listen_addrs: [%{ip: ip, port: port}], channels: channels_spec()}
  end

  defp channels_spec do
    case Application.get_env(:partisan, :channels) do
      map when is_map(map) and map_size(map) > 0 -> map
      _ -> %{gossip: %{monotonic: false, parallelism: 1, compression: false}}
    end
  end

  # ── Helpers ──────────────────────────────────────────────────────────────────
  def routable_ipv4_addrs do
    case :inet.getifaddrs() do
      {:ok, ifaddrs} ->
        ifaddrs
        |> Enum.filter(fn {iface_name, opts} ->
          name = to_string(iface_name)
          flags = Keyword.get(opts, :flags, [])
          :up in flags and :running in flags and
          not String.starts_with?(name, "docker") and
          not String.starts_with?(name, "br-") and
          not String.starts_with?(name, "veth") and
          not String.starts_with?(name, "lo")
        end)
        |> Enum.flat_map(fn {_, opts} -> Keyword.get_values(opts, :addr) end)
        |> Enum.filter(fn
          {127, _, _, _}   -> false
          {169, 254, _, _} -> false
          {a, _, _, _} when is_integer(a) -> true
          _ -> false
        end)
        |> Enum.uniq()
      _ -> []
    end
  end
  
  defp deadline(ms), do: System.monotonic_time(:millisecond) + ms
  defp fmt(ip),      do: ip |> :inet.ntoa() |> to_string()

  defp partisan_own_name do
    case System.get_env("PARTISAN_NAME") do
      s when is_binary(s) and s != "" -> String.to_atom(s)
      _ -> Application.get_env(:partisan, :name, node())
    end
  end

  defp partisan_own_port do
    case System.get_env("PARTISAN_PORT") do
      s when is_binary(s) ->
        case Integer.parse(s) do
          {n, ""} when n > 0 and n < 65536 -> n
          _ -> 9090
        end
      _ -> 9090
    end
  end
end

