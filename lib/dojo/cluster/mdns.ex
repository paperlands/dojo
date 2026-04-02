defmodule Dojo.Cluster.MDNS do
  @moduledoc """
  Core mDNS discovery engine.

  Transport-agnostic GenServer that owns the UDP socket, peer cache,
  and announce/query/collect cycle. Parameterized by an adapter module
  implementing `Dojo.Cluster.Discovery`.
  """
  use GenServer
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
  # POOF (RFC 6762 §10.5): evict after this many consecutive missed query cycles.
  # Invariant: @poof_min_missed * poll_interval_s > @max_announce_interval_s
  # With poll_interval=5s: 4 * 5 = 20s > 15s ✓
  @poof_min_missed 4
  # Exponential backoff: cap proactive announcement interval (seconds).
  # Kept below POOF tolerance so peers are never evicted between proactive announces.
  @max_announce_interval_s 15
  # Probe: wait time (ms) for conflict responses (RFC 6762 §8.1)
  @probe_wait_ms 250

  # ── Public API ──────────────────────────────────────────────────────────

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Return the current peer cache as a list of `{name, ip, port}` tuples."
  def cached_peers do
    GenServer.call(__MODULE__, :cached_peers)
  catch
    :exit, _ -> []
  end

  @doc "Evict a peer from the mDNS cache. Called by the adapter when persistent connection failures indicate the peer is unreachable."
  def evict_peer(name) do
    GenServer.cast(__MODULE__, {:evict_peer, name})
  catch
    :exit, _ -> :ok
  end

  @doc "Return a diagnostic snapshot of all observable mDNS state."
  def diag do
    GenServer.call(__MODULE__, :diag)
  catch
    :exit, _ -> {:error, :not_running}
  end

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
  visible on the new network without waiting for the next poll cycle.
  """
  def reannounce(ips \\ routable_ipv4_addrs()) do
    send_announcements(ips, 120, 1, 0)
  end

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

  def get_routable_ipv4_addr do
    routable_ipv4_addrs()
    |> List.first()
    |> fmt()
  end

  # ── GenServer callbacks ─────────────────────────────────────────────────

  @impl true
  def init(opts) do
    adapter = Keyword.fetch!(opts, :adapter)
    poll_interval = Keyword.get(opts, :poll_interval, 5_000)
    {name, port} = adapter.identity()
    service = Keyword.get(opts, :service, @service_fqdn)
    timeout = Keyword.get(opts, :timeout, 2_000)
    debug = Keyword.get(opts, :debug, false)

    state = %{
      socket: nil,
      adapter: adapter,
      own_name: name,
      own_port: port,
      service: service,
      timeout: timeout,
      cache: %{},
      announce_interval: 1,
      next_announce_at: System.monotonic_time(:second),
      poll_interval: poll_interval,
      socket_retries: 0,
      poll_cycles: 0,
      deaf_warned: false,
      monitored_nodes: MapSet.new(),
      debug: debug
    }

    if debug, do: log_interface_report()

    case open_socket() do
      {:ok, socket} ->
        state = %{state | socket: socket}
        ifaces = routable_ipv4_addrs()
        join_multicast(socket, ifaces)

        # RFC 6762 §8.1: single probe for UUID-based names before announcing
        probe_and_claim(state)

        # Boot burst with exponential backoff (RFC 6762 §11)
        spawn_link(fn ->
          do_announce(state)
          send_query(state)
          Process.sleep(1_000)
          do_announce(state)
          send_query(state)
          Process.sleep(2_000)
          do_announce(state)
          send_query(state)
        end)

        schedule_poll(state)
        {:ok, state}

      {:error, reason} ->
        Logger.warning(
          "[mDNS] cannot bind port #{@mdns_port}: #{inspect(reason)} — " <>
            "peer discovery disabled. On Windows, stop the DNS Client service " <>
            "or ensure no other process owns UDP #{@mdns_port}."
        )

        schedule_poll(state)
        {:ok, state}
    end
  end

  @impl true
  def handle_call(:cached_peers, _from, state) do
    peers = state.cache |> Map.values() |> Enum.map(&{&1.name, &1.ip, &1.port})
    {:reply, peers, state}
  end

  def handle_call(:identity, _from, state) do
    {:reply, {state.own_name, state.own_port}, state}
  end

  def handle_call(:diag, _from, state) do
    socket_info =
      if state.socket do
        case :inet.sockname(state.socket) do
          {:ok, {addr, port}} -> %{bound: {addr, port}, status: :open}
          _ -> %{status: :unknown}
        end
      else
        %{status: :closed, retries: state.socket_retries}
      end

    diag = %{
      socket: socket_info,
      own_name: state.own_name,
      own_port: state.own_port,
      adapter: state.adapter,
      cache: state.cache,
      cache_size: map_size(state.cache),
      interfaces: interface_report(),
      monitored_nodes: state.monitored_nodes,
      announce_interval: state.announce_interval,
      next_announce_at: state.next_announce_at,
      poll_interval: state.poll_interval,
      debug: state.debug
    }

    {:reply, diag, state}
  end

  @impl true
  def handle_cast({:evict_peer, name}, state) do
    if Map.has_key?(state.cache, name) do
      Logger.info("[mDNS] evicting unreachable peer #{name} from cache (adapter request)")
      cache = Map.delete(state.cache, name)
      state.adapter.on_peer_departed(name)

      :telemetry.execute([:dojo, :cluster, :peer_departed], %{}, %{
        node: name,
        reason: :connect_failure
      })

      {:noreply, %{state | cache: cache}}
    else
      {:noreply, state}
    end
  end

  def handle_cast({:rejoin_multicast, new_ips}, %{socket: socket} = state)
      when not is_nil(socket) do
    Logger.info("[mDNS] rejoining multicast on #{inspect(Enum.map(new_ips, &fmt/1))}")

    # Drop existing memberships (best-effort — may fail if already dropped)
    Enum.each(routable_ipv4_addrs(), fn ip ->
      :inet.setopts(socket, [{:drop_membership, {@mdns_addr, ip}}])
    end)

    join_multicast(socket, new_ips)
    {:noreply, state}
  end

  def handle_cast({:rejoin_multicast, _new_ips}, state) do
    # Socket not open — will rejoin on next recovery
    {:noreply, state}
  end

  @impl true
  def handle_info(:poll, %{socket: nil} = state) do
    case open_socket() do
      {:ok, socket} ->
        Logger.info("[mDNS] socket recovered after #{state.socket_retries} retries")
        :telemetry.execute([:dojo, :cluster, :socket_recovered], %{retries: state.socket_retries})
        ifaces = routable_ipv4_addrs()
        join_multicast(socket, ifaces)
        state = %{state | socket: socket, socket_retries: 0}
        probe_and_claim(state)
        do_announce(state)
        schedule_poll(state)
        {:noreply, state}

      {:error, _reason} ->
        retries = state.socket_retries + 1
        delay = min(5_000 * Integer.pow(2, retries - 1), 60_000)
        Process.send_after(self(), :poll, delay)
        {:noreply, %{state | socket_retries: retries}}
    end
  end

  def handle_info(:poll, state) do
    pre_sweep_count = map_size(state.cache)
    swept = sweep_cache(state.cache)
    evicted_count = pre_sweep_count - map_size(swept)
    state = %{state | cache: swept}

    :telemetry.execute(
      [:dojo, :cluster, :cache_sweep],
      %{evicted: evicted_count, remaining: map_size(swept)}
    )

    # Exponential backoff: only proactively announce when interval has elapsed
    now_s = System.monotonic_time(:second)
    state = maybe_announce(state, now_s)

    # Snapshot seen_at before collection for POOF tracking
    pre_seen = Map.new(state.cache, fn {k, %{seen_at: s}} -> {k, s} end)

    pre_cache_size = map_size(state.cache)

    # Parse buffered packets instead of flushing
    cache = collect_buffered(state)

    send_query(%{state | cache: cache})
    cache = collect(%{state | cache: cache}, deadline(state.timeout))

    # Reset announce backoff only when peer population changes
    # (new peer discovered or existing peer departed).
    # Previously reset on every query receipt, which meant backoff
    # never kicked in because queries arrive every 5s from each peer.
    state =
      if map_size(cache) != pre_cache_size do
        now_s = System.monotonic_time(:second)
        %{state | announce_interval: 1, next_announce_at: now_s}
      else
        state
      end

    # POOF: track missed queries and evict unresponsive peers
    cache = apply_poof(cache, pre_seen)

    # Notify adapter of discovered peers
    peers = cache |> Map.values() |> Enum.map(&{&1.name, &1.ip, &1.port})

    if state.debug do
      Logger.info(
        "[mDNS:diag] poll cycle complete — cache=#{map_size(cache)} peers=#{inspect(Enum.map(peers, &elem(&1, 0)))}"
      )
    end

    state.adapter.on_peers_discovered(peers)

    peer_names = Enum.map(peers, &elem(&1, 0))

    :telemetry.execute([:dojo, :cluster, :peers_discovered], %{count: length(peers)}, %{
      peers: peer_names
    })

    # Notify adapter of departed peers (goodbyes received during this cycle)
    departed = Map.keys(state.cache) -- Map.keys(cache)

    Enum.each(departed, fn name ->
      state.adapter.on_peer_departed(name)
      :telemetry.execute([:dojo, :cluster, :peer_departed], %{}, %{node: name, reason: :goodbye})
    end)

    # Node.monitor: monitor new connections for reactive failover
    state = maybe_monitor_nodes(%{state | cache: cache})

    # Deaf-node detection: warn once if no peers found after several cycles
    poll_cycles = state.poll_cycles + 1

    state =
      if poll_cycles >= 6 and map_size(cache) == 0 and not state.deaf_warned and
           state.socket != nil do
        Logger.warning("""
        [mDNS] 0 peers discovered after #{poll_cycles * div(state.poll_interval, 1000)}s. \
        Socket open, announcing normally.
          If on Windows, check that inbound UDP port 5454 is allowed through the firewall.
          Other nodes should still discover this node and connect via Partisan TCP.\
        """)

        %{state | deaf_warned: true, poll_cycles: poll_cycles}
      else
        %{state | poll_cycles: poll_cycles}
      end

    schedule_poll(state)
    {:noreply, %{state | cache: cache}}
  rescue
    e ->
      Logger.error("[mDNS] poll crashed: #{inspect(e)}")
      schedule_poll(state)
      {:noreply, state}
  catch
    :exit, reason ->
      Logger.error("[mDNS] poll exited: #{inspect(reason)}")
      schedule_poll(state)
      {:noreply, state}
  end

  # Node.monitor/2 → :erlang.monitor_node/2 sends {:nodedown, node}
  def handle_info({:nodedown, node}, state) do
    Logger.warning("[mDNS] nodedown: #{node}")
    :telemetry.execute([:dojo, :cluster, :peer_departed], %{}, %{node: node, reason: :nodedown})
    cache = Map.delete(state.cache, node)
    state.adapter.on_peer_departed(node)
    monitored = MapSet.delete(state.monitored_nodes, node)
    {:noreply, %{state | cache: cache, monitored_nodes: monitored}}
  end

  @impl true
  def terminate(_reason, %{socket: socket} = state) when not is_nil(socket) do
    try do
      ips = routable_ipv4_addrs()
      {name, port} = {state.own_name, state.own_port}
      name_str = Atom.to_string(name)

      Enum.each(ips, fn ip ->
        :inet.setopts(socket, [{:multicast_if, ip}])
        pkt = Dojo.Cluster.MDNS.Packet.announcement(@service_fqdn, name_str, ip, 0, port)
        :gen_udp.send(socket, @mdns_addr, @mdns_port, pkt)
      end)
    rescue
      _ -> :ok
    catch
      :exit, _ -> :ok
    after
      :gen_udp.close(socket)
    end
  end

  def terminate(_reason, _state), do: :ok

  # ── Node.monitor integration ────────────────────────────────────────────

  defp maybe_monitor_nodes(state) do
    if function_exported?(state.adapter, :supports_node_monitor?, 0) and
         state.adapter.supports_node_monitor?() do
      current = MapSet.new(Node.list())
      new_nodes = MapSet.difference(current, state.monitored_nodes)
      Enum.each(new_nodes, &Node.monitor(&1, true))
      %{state | monitored_nodes: MapSet.union(state.monitored_nodes, new_nodes)}
    else
      state
    end
  end

  # ── Exponential backoff for proactive announcements ────────────────────

  defp maybe_announce(state, now_s) do
    if now_s >= state.next_announce_at do
      do_announce(state)
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

  # ── Socket — active: false ──────────────────────────────────────────────

  defp open_socket do
    # NOTE: we intentionally do NOT use SO_REUSEPORT here.
    # On Linux, reuseport distributes incoming multicast packets across
    # sockets via hash — meaning two nodes on the same machine each get
    # ~half the packets instead of both receiving all of them.
    # SO_REUSEADDR alone is sufficient for multicast port sharing and
    # ensures every socket gets a copy of every multicast packet.
    opts = [
      :binary,
      :inet,
      active: false,
      reuseaddr: true,
      multicast_loop: true,
      multicast_ttl: 255,
      ip: {0, 0, 0, 0}
    ]

    Logger.info("[mDNS] opening socket on *:#{@mdns_port}")

    case :gen_udp.open(@mdns_port, opts) do
      {:ok, socket} ->
        Logger.info("[mDNS] socket opened on *:#{@mdns_port}")
        {:ok, socket}

      {:error, reason} = err ->
        Logger.error("[mDNS] socket open failed: #{inspect(reason)}")
        err
    end
  end

  defp join_multicast(socket, ifaces) do
    Enum.each(ifaces, fn ip ->
      case :inet.setopts(socket, [
             {:add_membership, {@mdns_addr, ip}},
             {:multicast_if, ip}
           ]) do
        :ok -> Logger.debug("[mDNS] joined multicast on #{fmt(ip)}")
        {:error, r} -> Logger.warning("[mDNS] multicast join failed #{fmt(ip)}: #{inspect(r)}")
      end
    end)
  end

  # ── Collect loop ─────────────────────────────────────────────────────────

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
                if state.debug do
                  peers = extract_peers(records, service, src_ip)

                  Logger.info(
                    "[mDNS:diag] collect response from #{fmt(src_ip)} → peers=#{inspect(peers)}"
                  )
                end

                update_cache(state.cache, records, own_name, service, src_ip)

              :query ->
                if state.debug do
                  Logger.info("[mDNS:diag] collect query from #{fmt(src_ip)} → re-announcing")
                end

                jitter = @jitter_min_ms + :rand.uniform(@jitter_max_ms - @jitter_min_ms)

                spawn(fn ->
                  Process.sleep(jitter)
                  do_announce(state)
                end)

                state.cache

              :unknown ->
                if state.debug, do: Logger.info("[mDNS:diag] collect unknown from #{fmt(src_ip)}")
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

  defp collect_buffered(%{socket: socket, own_name: own_name, service: service} = state) do
    case :gen_udp.recv(socket, 0, 0) do
      {:ok, {src_ip, _port, raw}} ->
        if state.debug do
          Logger.info("[mDNS:diag] collect_buffered recv #{byte_size(raw)}B from #{fmt(src_ip)}")
        end

        cache =
          case classify_and_decode(raw, service) do
            {:response, records} ->
              if state.debug do
                peers = extract_peers(records, service, src_ip)
                Logger.info("[mDNS:diag] collect_buffered response → peers=#{inspect(peers)}")
              end

              update_cache(state.cache, records, own_name, service, src_ip)

            :query ->
              if state.debug do
                Logger.info(
                  "[mDNS:diag] collect_buffered query from #{fmt(src_ip)} → re-announcing"
                )
              end

              jitter = @jitter_min_ms + :rand.uniform(@jitter_max_ms - @jitter_min_ms)

              spawn(fn ->
                Process.sleep(jitter)
                do_announce(state)
              end)

              state.cache

            :unknown ->
              if state.debug do
                Logger.info("[mDNS:diag] collect_buffered unknown packet from #{fmt(src_ip)}")
              end

              state.cache
          end

        collect_buffered(%{state | cache: cache})

      {:error, :timeout} ->
        state.cache

      {:error, _} ->
        state.cache
    end
  end

  defp classify_and_decode(raw, _service) do
    case raw do
      <<_id::16, 0::1, _::7, _::8, qdcount::16, _ancount::16, _::binary>>
      when qdcount > 0 ->
        :query

      <<_id::16, 1::1, _::15, _rest::binary>> ->
        case Dojo.Cluster.MDNS.Packet.decode(raw) do
          {:ok, records} -> {:response, records}
          _ -> :unknown
        end

      _ ->
        :unknown
    end
  end

  defp do_announce(%{socket: sock, own_name: name, own_port: port, service: svc}) do
    name_str = Atom.to_string(name)
    addrs = routable_ipv4_addrs()
    # Logger.debug("[mDNS] announcing #{name_str}:#{port} on #{inspect(addrs)}")

    Enum.each(addrs, fn ip ->
      :inet.setopts(sock, [{:multicast_if, ip}])
      pkt = Dojo.Cluster.MDNS.Packet.announcement(svc, name_str, ip, 120, port)
      :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
    end)
  end

  defp send_query(%{socket: sock, service: svc, cache: cache} = state) do
    known_answers = build_known_answers(cache, svc)
    pkt = Dojo.Cluster.MDNS.Packet.query(svc, known_answers)
    addrs = routable_ipv4_addrs()

    if Map.get(state, :debug) do
      ka_names = Enum.map(known_answers, &elem(&1, 0))

      Logger.info(
        "[mDNS:diag] send_query known_answers=#{inspect(ka_names)} on #{inspect(Enum.map(addrs, &fmt/1))}"
      )
    end

    Enum.each(addrs, fn ip ->
      :inet.setopts(sock, [{:multicast_if, ip}])
      :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
    end)
  end

  # ── Known-answer suppression ────────────────────────────────────────────

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

  # ── Packet parsing ───────────────────────────────────────────────────────

  defp extract_peers(records, service, src_ip) do
    txt_idx =
      records
      |> Enum.filter(&match?(%{type: @dns_type_txt, data: {:txt, _}}, &1))
      |> Map.new(fn %{name: n, data: {:txt, kv}} -> {n, kv} end)

    ptr_records = Enum.filter(records, &match?(%{type: @dns_type_ptr, name: ^service}, &1))

    Enum.flat_map(ptr_records, fn %{data: {:ptr, instance_fqdn}} ->
      with kv <- Map.get(txt_idx, instance_fqdn),
           true <- not is_nil(kv),
           node_str <- kv_get(kv, "erlang_node"),
           true <- is_binary(node_str) and node_str != "",
           port_str <- kv_get(kv, "port"),
           {port, ""} <- if(is_binary(port_str), do: Integer.parse(port_str), else: :error) do
        [{String.to_atom(node_str), src_ip, port}]
      else
        _ ->
          Logger.debug(
            "[mDNS] skipping instance #{instance_fqdn} — " <>
              "missing/bad TXT records in #{inspect(txt_idx[instance_fqdn])}" <>
              " | txt_names=#{inspect(Map.keys(txt_idx))}" <>
              " | record_types=#{inspect(Enum.map(records, & &1.type))}" <>
              " | src=#{fmt(src_ip)}"
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

  # ── Cache management ─────────────────────────────────────────────────────

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

  # ── Probing (RFC 6762 §8.1) ────────────────────────────────────────────

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

  # ── Ephemeral announcement helpers ─────────────────────────────────────

  defp send_announcements(ips, ttl, count, interval) do
    {name, port} =
      try do
        {n, p} = GenServer.call(__MODULE__, :identity)
        {Atom.to_string(n), p}
      catch
        :exit, _ ->
          # GenServer down (e.g. during prep_stop) — ask the adapter directly
          adapter =
            Application.get_env(:dojo, :cluster_adapter, Dojo.Cluster.MDNS.PartisanAdapter)

          {n, p} = adapter.identity()
          {Atom.to_string(n), p}
      end

    case open_ephemeral_socket() do
      {:ok, sock} ->
        try do
          Enum.each(1..count, fn i ->
            Enum.each(ips, fn ip ->
              :inet.setopts(sock, [{:multicast_if, ip}])
              pkt = Dojo.Cluster.MDNS.Packet.announcement(@service_fqdn, name, ip, ttl, port)
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
    :gen_udp.open(0, [:binary, :inet, multicast_loop: true, multicast_ttl: 255])
  end

  # ── Diagnostics ────────────────────────────────────────────────────────

  @doc false
  def interface_report do
    case :inet.getifaddrs() do
      {:ok, ifaddrs} ->
        Enum.map(ifaddrs, fn {iface_name, opts} ->
          name = to_string(iface_name)
          flags = Keyword.get(opts, :flags, [])

          addrs =
            opts
            |> Keyword.get_values(:addr)
            |> Enum.filter(fn
              {a, _, _, _} when is_integer(a) -> true
              _ -> false
            end)

          is_virtual = virtual_interface?(name)
          up_and_running = :up in flags and :running in flags

          routable =
            Enum.filter(addrs, fn
              {127, _, _, _} -> false
              {169, 254, _, _} -> false
              _ -> true
            end)

          %{
            name: name,
            flags: flags,
            addrs: addrs,
            routable_addrs: routable,
            virtual: is_virtual,
            up: up_and_running,
            selected: up_and_running and not is_virtual and routable != []
          }
        end)

      _ ->
        []
    end
  end

  defp log_interface_report do
    report = interface_report()

    Logger.info("[mDNS:diag] interface report:")

    Enum.each(report, fn iface ->
      marker = if iface.selected, do: ">>", else: "  "

      Logger.info(
        "[mDNS:diag] #{marker} #{iface.name} flags=#{inspect(iface.flags)} " <>
          "addrs=#{inspect(iface.addrs)} virtual=#{iface.virtual} selected=#{iface.selected}"
      )
    end)

    selected = Enum.filter(report, & &1.selected)

    if selected == [] do
      Logger.warning("[mDNS:diag] NO interfaces selected — discovery will be blind!")
    end
  end

  # ── Helpers ──────────────────────────────────────────────────────────────

  # Filter virtual/container interfaces by name patterns.
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
      String.contains?(downcased, "loopback pseudo") or
      String.contains?(downcased, "tap-win") or
      String.contains?(downcased, "npcap") or
      String.contains?(downcased, "wireguard") or
      String.contains?(downcased, "zerotier") or
      String.contains?(downcased, "hamachi") or
      String.contains?(downcased, "vpn")
  end

  defp schedule_poll(state) do
    Process.send_after(self(), :poll, state.poll_interval)
  end

  defp deadline(ms), do: System.monotonic_time(:millisecond) + ms
  defp fmt(nil), do: ""
  defp fmt(ip), do: ip |> :inet.ntoa() |> to_string()
end
