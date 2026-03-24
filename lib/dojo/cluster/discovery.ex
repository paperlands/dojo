defmodule Dojo.Cluster.MDNS.Discovery do
  @behaviour :partisan_peer_discovery_agent

  require Logger

  @mdns_addr {224, 0, 0, 251}
  @mdns_port 5454
  @dns_type_ptr 12
  @dns_type_txt 16

  # seconds — evict peers unseen for this long
  @peer_ttl 30
  # send multiple goodbyes for WiFi multicast reliability
  @goodbye_count 2
  # ms between goodbye packets
  @goodbye_interval 250
  @service_fqdn "_erlang._tcp.local"
  # RFC 6762 §6: random delay range (ms) before responding to shared-record queries
  @jitter_min_ms 20
  @jitter_max_ms 120
  # Standard announcement TTL — used for known-answer suppression calculations
  @announcement_ttl 120
  # POOF (RFC 6762 §10.5): evict after this many consecutive missed query cycles
  @poof_min_missed 2
  # Exponential backoff: cap proactive announcement interval (seconds)
  @max_announce_interval_s 60
  # Probe: wait time (ms) for conflict responses (RFC 6762 §8.1)
  @probe_wait_ms 250

  # ── init/1 ──────────────────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    own_name = partisan_own_name()
    own_port = partisan_own_port()
    service = Map.get(opts, :service, "_erlang._tcp.local")
    timeout = Map.get(opts, :timeout_ms, 2_000)

    state = %{
      socket: nil,
      own_name: own_name,
      own_port: own_port,
      service: service,
      timeout: timeout,
      cache: %{},
      # Exponential backoff for proactive announcements (RFC 6762 §11)
      announce_interval: 1,
      next_announce_at: System.monotonic_time(:second)
    }

    case open_socket() do
      {:ok, socket} ->
        state = %{state | socket: socket}
        ifaces = routable_ipv4_addrs()
        join_multicast(socket, ifaces)

        # RFC 6762 §8.1: single probe for UUID-based names before announcing
        probe_and_claim(state)

        # Boot burst with exponential backoff (RFC 6762 §11)
        # Intervals: 0 → 1s → 2s (total ~3s for 3 announcements)
        spawn_link(fn ->
          announce(state)
          send_query(state)
          Process.sleep(1_000)
          announce(state)
          send_query(state)
          Process.sleep(2_000)
          announce(state)
          send_query(state)
        end)

        {:ok, state}

      {:error, reason} ->
        # On Windows, port 5353 is often held by the DNS Client service (dnscache)
        # or Apple Bonjour. Run degraded — lookup/2 returns empty results,
        # but the agent stays alive so Partisan doesn't crash-loop.
        Logger.warning(
          "[mDNS] cannot bind port #{@mdns_port}: #{inspect(reason)} — " <>
            "peer discovery disabled. On Windows, stop the DNS Client service " <>
            "or ensure no other process owns UDP 5353."
        )

        {:ok, state}
    end
  end

  # ── lookup/2 ────────────────────────────────────────────────────────────────

  @impl true
  def lookup(%{socket: nil} = state, _timeout) do
    # Degraded mode — port 5353 was unavailable at init (common on Windows).
    # Return empty so Partisan doesn't crash, but log periodically.
    {:ok, [], state}
  end

  def lookup(%{socket: _socket, own_name: _own_name} = state, _timeout) do
    state = %{state | cache: sweep_cache(state.cache)}

    # Exponential backoff: only proactively announce when interval has elapsed
    now_s = System.monotonic_time(:second)
    state = maybe_announce(state, now_s)

    # Snapshot seen_at before collection for POOF tracking
    pre_seen = Map.new(state.cache, fn {k, %{seen_at: s}} -> {k, s} end)

    # Parse buffered packets instead of flushing
    cache = collect_buffered(state)

    send_query(%{state | cache: cache})
    cache = collect(%{state | cache: cache}, deadline(state.timeout))

    # POOF: track missed queries and evict unresponsive peers
    cache = apply_poof(cache, pre_seen)

    specs = cache |> Map.values() |> Enum.map(&build_node_spec/1)
    {:ok, specs, %{state | cache: cache}}
  rescue
    e ->
      Logger.error("[mDNS] lookup crashed: #{inspect(e)}")
      {:error, e, state}
  end

  # ── Public API: goodbye / reannounce ──────────────────────────────────────
  # These open ephemeral sockets and read identity from config/env,
  # independent of the callback state held by Partisan's gen_statem.

  @doc """
  Send mDNS goodbye packets (TTL=0) to tell peers we're departing.
  Sends `@goodbye_count` rounds with `@goodbye_interval` ms gap.
  """
  def goodbye(ips \\ routable_ipv4_addrs()) do
    send_announcements(ips, 0, @goodbye_count, @goodbye_interval)
  end

  @doc """
  Send mDNS re-announcement (TTL=120) on the given IPs.
  Used by NetworkMonitor after an IP change to make the node
  visible on the new network without waiting for the next lookup cycle.
  """
  def reannounce(ips \\ routable_ipv4_addrs()) do
    send_announcements(ips, 120, 1, 0)
  end

  # ── Exponential backoff for proactive announcements ────────────────────
  # RFC 6762 §11: space unsolicited announcements exponentially.
  # Query-triggered jittered responses (Step 2) handle ongoing visibility
  # once the backoff interval grows large.

  defp maybe_announce(state, now_s) do
    if now_s >= state.next_announce_at do
      announce(state)
      advance_announce_schedule(state, now_s)
    else
      state
    end
  end

  @doc false
  def advance_announce_schedule(state, now_s) do
    interval = Map.get(state, :announce_interval, 1)
    new_interval = min(interval * 2, @max_announce_interval_s)

    state
    |> Map.put(:announce_interval, new_interval)
    |> Map.put(:next_announce_at, now_s + new_interval)
  end

  # Drain buffered packets but PARSE them instead of discarding.
  # These are announcements that arrived between lookup cycles.
  defp collect_buffered(%{socket: socket, own_name: own_name, service: service} = state) do
    case :gen_udp.recv(socket, 0, 0) do
      {:ok, {src_ip, _port, raw}} ->
        cache =
          case Dojo.Cluster.MDNS.Packet.decode(raw) do
            {:ok, records} ->
              update_cache(state.cache, records, own_name, service, src_ip)

            _ ->
              state.cache
          end

        collect_buffered(%{state | cache: cache})

      {:error, :timeout} ->
        state.cache

      {:error, _} ->
        state.cache
    end
  end

  # ── Socket — active: false ──────────────────────────────────────────────────
  # active: false means NO messages land in the gen_statem mailbox between
  # lookup cycles. We pull packets explicitly with :gen_udp.recv/3.

  defp open_socket do
    base = [
      :binary,
      # ← KEY: we control reads, nothing leaks to gen_statem
      active: false,
      reuseaddr: true,
      # same-machine discovery
      multicast_loop: true,
      multicast_ttl: 255,
      ip: {0, 0, 0, 0}
    ]

    opts =
      case :gen_udp.open(0, reuseport: true) do
        {:ok, s} ->
          :gen_udp.close(s)
          [{:reuseport, true} | base]

        _ ->
          base
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
          cache =
            case classify_and_decode(raw, service) do
              {:response, records} ->
                update_cache(state.cache, records, own_name, service, src_ip)

              :query ->
                # RFC 6762 §6: 20-120ms random jitter before responding
                # to prevent response storms on congested WiFi.
                #
                # We intentionally do NOT check the query's known-answer section
                # to decide whether to suppress our response. Receiver-side
                # suppression would oscillate with POOF: suppress → POOF evicts →
                # rediscover → suppress → evict. Always responding keeps the
                # query-response cycle reliable and POOF well-calibrated.
                jitter = @jitter_min_ms + :rand.uniform(@jitter_max_ms - @jitter_min_ms)

                spawn(fn ->
                  Process.sleep(jitter)
                  announce(state)
                end)

                state.cache

              :unknown ->
                state.cache
            end

          collect(%{state | cache: cache}, deadline)

        {:error, :timeout} ->
          state.cache

        {:error, _} ->
          state.cache
      end
    end
  end

  defp classify_and_decode(raw, _service) do
    case raw do
      <<_id::16, 0::1, _::7, _::8, qdcount::16, _ancount::16, _::binary>>
      when qdcount > 0 ->
        # QR=0, has questions → it's a query
        :query

      <<_id::16, 1::1, _::15, _rest::binary>> ->
        # QR=1 → it's a response
        case Dojo.Cluster.MDNS.Packet.decode(raw) do
          {:ok, records} -> {:response, records}
          _ -> :unknown
        end

      _ ->
        :unknown
    end
  end

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

  defp send_query(%{socket: sock, service: svc, cache: cache}) do
    known_answers = build_known_answers(cache, svc)
    pkt = Dojo.Cluster.MDNS.Packet.query(svc, known_answers)

    Enum.each(routable_ipv4_addrs(), fn ip ->
      :inet.setopts(sock, [{:multicast_if, ip}])
      :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
    end)
  end

  # RFC 6762 §7.1: include cached PTR records in queries so that responders
  # whose records we already have can suppress their responses.
  # Only include entries whose remaining TTL exceeds half the original.
  @doc false
  def build_known_answers(cache, service) do
    now = System.monotonic_time(:second)
    half_ttl = div(@announcement_ttl, 2)

    cache
    |> Map.values()
    |> Enum.flat_map(fn %{name: name, seen_at: seen_at} ->
      remaining = @announcement_ttl - (now - seen_at)

      if remaining > half_ttl do
        name_str = Atom.to_string(name)
        instance_lbl = String.replace(name_str, ~r/[@\-]/, "-")
        instance_fqdn = "#{instance_lbl}.#{service}"
        [{instance_fqdn, remaining}]
      else
        []
      end
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
      with kv <- Map.get(txt_idx, instance_fqdn),
           true <- not is_nil(kv),
           node_str <- kv_get(kv, "erlang_node"),
           true <- is_binary(node_str) and node_str != "",
           port_str <- kv_get(kv, "partisan_port"),
           {port, ""} <- if(is_binary(port_str), do: Integer.parse(port_str), else: :error) do
        [{String.to_atom(node_str), src_ip, port}]
      else
        _ ->
          Logger.debug(
            "[mDNS] skipping instance #{instance_fqdn} — " <>
              "missing/bad TXT records in #{inspect(txt_idx[instance_fqdn])}"
          )

          []
      end
    end)
  end

  defp kv_get(kv, key) do
    case List.keyfind(kv, key, 0) do
      {^key, v} -> v
      _ -> nil
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

  # ── Cache management ─────────────────────────────────────────────────────────

  @doc false
  def sweep_cache(cache) do
    now = System.monotonic_time(:second)
    Map.filter(cache, fn {_name, %{seen_at: seen_at}} -> now - seen_at < @peer_ttl end)
  end

  @doc false
  def update_cache(cache, records, own_name, service, src_ip) do
    peers = extract_peers(records, service, src_ip)
    is_goodbye = Enum.all?(records, &(&1.ttl == 0))

    Enum.reduce(peers, cache, fn {name, ip, port}, acc ->
      cond do
        name == own_name ->
          acc

        is_goodbye ->
          Logger.debug("[mDNS] goodbye received for #{name} — evicting from cache")
          Map.delete(acc, name)

        true ->
          Map.put(acc, name, %{
            name: name,
            ip: ip,
            port: port,
            seen_at: System.monotonic_time(:second),
            missed_queries: 0
          })
      end
    end)
  end

  # ── POOF (Passive Observation Of Failure, RFC 6762 §10.5) ──────────────
  # After each lookup cycle, increment missed_queries for peers that didn't
  # respond. Evict peers that have missed >= @poof_min_missed consecutive
  # cycles — they're almost certainly gone, no need to wait for full TTL.

  @doc false
  def apply_poof(cache, pre_seen) do
    cache
    |> Map.new(fn {name, entry} ->
      old_seen = Map.get(pre_seen, name)
      was_refreshed = old_seen == nil or entry.seen_at != old_seen
      missed = if was_refreshed, do: 0, else: Map.get(entry, :missed_queries, 0) + 1
      {name, Map.put(entry, :missed_queries, missed)}
    end)
    |> Map.filter(fn {name, entry} ->
      missed = Map.get(entry, :missed_queries, 0)

      if missed >= @poof_min_missed do
        Logger.debug("[mDNS] POOF: evicting #{name} after #{missed} unanswered queries")
        false
      else
        true
      end
    end)
  end

  # ── Probing (RFC 6762 §8.1) ──────────────────────────────────────────
  # Single probe for UUID-based names. Collision is vanishingly unlikely,
  # but the probe is cheap (250ms at startup) and follows the RFC.

  defp probe_and_claim(%{socket: sock, own_name: name, service: svc}) do
    name_str = Atom.to_string(name)
    instance_lbl = String.replace(name_str, ~r/[@\-]/, "-")
    instance_fqdn = "#{instance_lbl}.#{svc}"

    pkt = Dojo.Cluster.MDNS.Packet.probe(instance_fqdn)

    Enum.each(routable_ipv4_addrs(), fn ip ->
      :inet.setopts(sock, [{:multicast_if, ip}])
      :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
    end)

    Process.sleep(@probe_wait_ms)

    case check_probe_conflict(sock, instance_fqdn) do
      :clear ->
        Logger.debug("[mDNS] probe clear — claiming #{instance_fqdn}")

      :conflict ->
        Logger.warning(
          "[mDNS] probe conflict for #{instance_fqdn} — " <>
            "UUID collision is extremely unlikely, proceeding anyway"
        )
    end
  end

  defp check_probe_conflict(sock, instance_fqdn) do
    case :gen_udp.recv(sock, 0, 0) do
      {:ok, {_ip, _port, raw}} ->
        case Dojo.Cluster.MDNS.Packet.decode(raw) do
          {:ok, records} ->
            has_conflict =
              Enum.any?(records, fn rr ->
                rr.type in [1, 16, 33] and rr.name == instance_fqdn
              end)

            if has_conflict, do: :conflict, else: check_probe_conflict(sock, instance_fqdn)

          _ ->
            check_probe_conflict(sock, instance_fqdn)
        end

      {:error, _} ->
        :clear
    end
  end

  # ── Ephemeral announcement helpers ─────────────────────────────────────────
  # Used by goodbye/1 and reannounce/1. Opens a temporary socket,
  # sends packets, and closes it — independent of the callback socket.

  defp send_announcements(ips, ttl, count, interval) do
    name_str = Atom.to_string(partisan_own_name())
    port = partisan_own_port()

    case open_ephemeral_socket() do
      {:ok, sock} ->
        try do
          Enum.each(1..count, fn i ->
            Enum.each(ips, fn ip ->
              :inet.setopts(sock, [{:multicast_if, ip}])
              pkt = Dojo.Cluster.MDNS.Packet.announcement(@service_fqdn, name_str, ip, ttl, port)
              :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
            end)

            if i < count, do: Process.sleep(interval)
          end)
        after
          :gen_udp.close(sock)
        end

      {:error, reason} ->
        Logger.warning("[mDNS] ephemeral socket failed: #{inspect(reason)}")
    end

    :ok
  end

  defp open_ephemeral_socket do
    :gen_udp.open(0, [:binary, multicast_loop: true, multicast_ttl: 255])
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
            not virtual_interface?(name)
        end)
        |> Enum.flat_map(fn {_, opts} -> Keyword.get_values(opts, :addr) end)
        |> Enum.filter(fn
          {127, _, _, _} -> false
          {169, 254, _, _} -> false
          {a, _, _, _} when is_integer(a) -> true
          _ -> false
        end)
        |> Enum.uniq()

      _ ->
        []
    end
  end

  # Filter virtual/container interfaces by name patterns.
  # Linux: docker*, br-*, veth*, lo*
  # Windows: vEthernet (Hyper-V), VMware, VirtualBox, Loopback Pseudo-Interface, isatap
  defp virtual_interface?(name) do
    downcased = String.downcase(name)

    String.starts_with?(name, "docker") or
      String.starts_with?(name, "br-") or
      String.starts_with?(name, "veth") or
      String.starts_with?(name, "lo") or
      String.contains?(downcased, "vmware") or
      String.contains?(downcased, "virtualbox") or
      String.contains?(downcased, "vethernet") or
      String.contains?(downcased, "hyper-v") or
      String.contains?(downcased, "isatap") or
      String.contains?(downcased, "loopback pseudo")
  end

  def get_routable_ipv4_addr do
    routable_ipv4_addrs()
    |> List.first()
    |> fmt()
  end

  defp deadline(ms), do: System.monotonic_time(:millisecond) + ms
  defp fmt(nil), do: ""
  defp fmt(ip), do: ip |> :inet.ntoa() |> to_string()

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

      _ ->
        9090
    end
  end
end
