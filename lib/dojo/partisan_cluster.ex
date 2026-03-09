defmodule Dojo.Partisan.Cluster do
  @moduledoc """
  Multicast/broadcast UDP gossip strategy wired directly to
  `partisan_peer_service.join/1` for overlay membership.

  Designed for zero-restart self-healing across the full node lifecycle on
  constrained and mobile networks (Android hotspot, intermittent WiFi, flaky L2).

  ## Lifecycle guarantees

  **Initial connection**
  Each node gossips its full partisan node spec (name + listen_addrs + channels)
  via UDP multicast/broadcast. On receipt, `join/1` is called after a layered gate:
  overlay membership check → per-node backoff → per-node cooldown.

  **Node death / partisan TCP drop without death**
  Partisan's own failure detector handles hard node death. The reconciler
  cross-references `last_seen_tab` against the live partisan overlay every
  `reconcile_ms`. Nodes still gossiping but absent from the overlay are
  async-rejoined immediately.

  **Node restart (spec change)**
  Restarted nodes emit a fresh spec. Direct spec equality (not phash2) detects
  the change. On detection: BOTH the cooldown AND the join backoff are cleared,
  so `join/1` fires on the very next gossip tick regardless of prior failure history.

  **WiFi hop / interface change (own node)**
  `myself/0` is called on every heartbeat tick. On spec change: all peer
  cooldowns AND backoffs are flushed. Prior failure records are stale — they
  were recorded against our old source address. The new spec is immediately
  gossiped so peers can rejoin us at our new listen_addrs.

  **WiFi hop / interface change (peer node)**
  Arriving heartbeat with a changed spec clears that peer's cooldown AND backoff
  before `join/1` is attempted. Stale failure records from the old address are
  discarded.

  **Socket death (Android radio teardown)**
  Two independent detectors: `{:udp_error, …}` (kernel-sent) and a periodic
  `:socket_health` probe via `:inet.getopts`. A `rebuild_in_progress` flag
  prevents the double-rebuild race where both detectors fire before either is
  processed — only one rebuild sequence ever runs at a time. Rebuild uses
  exponential backoff (1 s → 30 s cap). On success: own spec is re-fetched,
  all join state flushed, multicast group membership restored.

  **`partisan_peer_service` supervisor restart**
  Monitored via `Process.monitor/1`. On `:DOWN`: all join state cleared, new
  monitor attempted immediately. If partisan hasn't restarted yet,
  `:retry_monitor` is scheduled with exponential backoff until it succeeds —
  the monitor is NEVER permanently lost. A deferred reconcile drives rejoining
  all live-gossiping peers once partisan is back.

  **Join storms**
  Three-layer gate: overlay membership → per-node exponential backoff (1 s →
  5 min) → per-node cooldown (default 30 s). All `join/1` calls are async
  (unlinked spawned process writing results back to ETS public tables) so the
  GenServer hot path is NEVER blocked by a slow or dead join target.

  **Member list query cost**
  `members/0` is fetched by a spawned process and cached with a short TTL.
  The GenServer is never blocked waiting on partisan. Stale cache is served
  while the refresh is in flight.

  **Atom table safety**
  All received UDP payloads decoded with `binary_to_term(bin, [:safe])` inside
  try/catch. Unknown atoms arrive as binaries rather than being interned.

  **Memory safety**
  `last_seen_tab` is bounded by `max_tracked_peers` (default 128). Stale
  entries are purged every reconcile cycle.

  ## Config

      config :libcluster,
        topologies: [
          partisan_gossip: [
            strategy: #{__MODULE__},
            config: [
              port: 45892,
              if_addr: "0.0.0.0",
              multicast_if: "192.168.1.1",
              multicast_addr: "233.252.1.32",
              multicast_ttl: 1,
              secret: "somepassword",
              join_cooldown_ms: 30_000,
              reconcile_ms: 20_000,
              socket_health_ms: 8_000,
              max_tracked_peers: 128,
              max_rejoin_per_cycle: 8]]]

  Broadcast-only (no multicast, Android hotspot default):

      config :libcluster,
        topologies: [
          partisan_gossip: [
            strategy: #{__MODULE__},
            config: [
              port: 45892,
              if_addr: "0.0.0.0",
              multicast_addr: "255.255.255.255",
              broadcast_only: true]]]
  """

  use GenServer
  use Cluster.Strategy
  import Cluster.Logger

  alias Cluster.Strategy.State

  @default_port 45892
  @default_addr {0, 0, 0, 0}
  @default_multicast_addr {233, 252, 1, 32}
  @default_join_cooldown_ms 30_000
  @default_reconcile_ms 20_000
  @default_socket_health_ms 8_000
  @default_max_tracked_peers 128
  @default_max_rejoin_per_cycle 8
  @members_cache_ttl_ms 2_000
  @min_socket_backoff_ms 1_000
  @max_socket_backoff_ms 30_000
  @min_join_backoff_ms 1_000
  @max_join_backoff_ms 300_000
  @monitor_retry_base_ms 500
  @monitor_retry_max_ms 10_000
  # A node silent for reconcile_ms * @liveness_multiplier is purged.
  @liveness_multiplier 3

  @sol_socket 0xFFFF
  @so_reuseport 0x0200

  # Process-dictionary keys for non-blocking member list cache.
  # Using the process dictionary avoids threading cache state through every
  # function that needs to call already_member?/1 from the hot receive path.
  @pd_members_cache :pgossip_members_cache
  @pd_members_ref   :pgossip_members_ref

  # ---------------------------------------------------------------------------
  # meta map schema
  #
  #   multicast_addr        :: tuple()           UDP destination
  #   port                  :: integer()
  #   ip                    :: tuple()           bind address
  #   socket                :: port() | nil      nil while rebuilding
  #   secret                :: binary() | nil
  #   partisan_spec         :: map() | nil       own spec, nil if partisan not up
  #   join_cooldown_ms      :: integer()
  #   reconcile_ms          :: integer()
  #   socket_health_ms      :: integer()
  #   max_tracked_peers     :: integer()
  #   max_rejoin_per_cycle  :: integer()
  #   rebuild_in_progress   :: boolean()         single-sequence rebuild guard
  #   rebuild_attempts      :: integer()
  #   monitor_ref           :: reference() | nil partisan_peer_service monitor
  #   monitor_retry_attempt :: integer()         for nil-monitor retry backoff
  #   broadcast_only        :: boolean()
  #   multicast_if          :: tuple() | nil
  #   multicast_ttl         :: integer()
  #   cooldown_tab          :: :ets.tid()        {peer_name, last_attempt_mono_ms}
  #   last_seen_tab         :: :ets.tid()        {peer_name, mono_ms, norm_spec}
  #   backoff_tab           :: :ets.tid()        {peer_name, next_attempt_mono_ms, fail_count}
  # ---------------------------------------------------------------------------

  def start_link(args), do: GenServer.start_link(__MODULE__, args)

  # ---------------------------------------------------------------------------
  # init/1
  # ---------------------------------------------------------------------------

  @impl true
  def init([%State{config: config} = state]) do
    topo = state.topology

    port             = Keyword.get(config, :port, @default_port)
    ip               = config |> Keyword.get(:if_addr, @default_addr) |> sanitize_ip()
    broadcast_only?  = Keyword.get(config, :broadcast_only, false)
    ttl              = Keyword.get(config, :multicast_ttl, 1)
    multicast_if     = config |> Keyword.get(:multicast_if) |> then(&(&1 && sanitize_ip(&1)))
    multicast_addr   = config |> Keyword.get(:multicast_addr, @default_multicast_addr) |> sanitize_ip()
    secret           = Keyword.get(config, :secret, nil)
    join_cooldown_ms     = Keyword.get(config, :join_cooldown_ms, @default_join_cooldown_ms)
    reconcile_ms         = Keyword.get(config, :reconcile_ms, @default_reconcile_ms)
    socket_health_ms     = Keyword.get(config, :socket_health_ms, @default_socket_health_ms)
    max_tracked_peers    = Keyword.get(config, :max_tracked_peers, @default_max_tracked_peers)
    max_rejoin_per_cycle = Keyword.get(config, :max_rejoin_per_cycle, @default_max_rejoin_per_cycle)

    # Intentionally crash init on socket failure — the supervisor will retry.
    # Masking this would leave us permanently unable to send/receive heartbeats.
    {:ok, socket} = open_socket(port, ip, broadcast_only?, ttl, multicast_if, multicast_addr)

    # safe_myself catches :exit so we are robust to partisan not being up yet
    # during application boot ordering.
    partisan_spec = safe_myself(topo, nil)

    {monitor_ref, retry_attempt} = try_monitor_partisan(topo, 0)

    if monitor_ref == nil do
      schedule_monitor_retry(0)
    end

    # ETS tables: :public so async join-spawns can write results without
    # messaging the GenServer. write_concurrency because spawned joins write
    # concurrently. Tables are owned by this process and auto-deleted on death.
    cooldown_tab  = :ets.new(:"pgossip_cd_#{topo}", [:set, :public, {:write_concurrency, true}])
    last_seen_tab = :ets.new(:"pgossip_ls_#{topo}", [:set, :public, {:write_concurrency, true}])
    backoff_tab   = :ets.new(:"pgossip_bo_#{topo}", [:set, :public, {:write_concurrency, true}])

    meta = %{
      multicast_addr:        multicast_addr,
      port:                  port,
      ip:                    ip,
      socket:                socket,
      secret:                secret,
      partisan_spec:         partisan_spec,
      join_cooldown_ms:      join_cooldown_ms,
      reconcile_ms:          reconcile_ms,
      socket_health_ms:      socket_health_ms,
      max_tracked_peers:     max_tracked_peers,
      max_rejoin_per_cycle:  max_rejoin_per_cycle,
      rebuild_in_progress:   false,
      rebuild_attempts:      0,
      monitor_ref:           monitor_ref,
      monitor_retry_attempt: retry_attempt,
      broadcast_only:        broadcast_only?,
      multicast_if:          multicast_if,
      multicast_ttl:         ttl,
      cooldown_tab:          cooldown_tab,
      last_seen_tab:         last_seen_tab,
      backoff_tab:           backoff_tab,
    }

    schedule_reconcile(reconcile_ms)
    schedule_socket_health(socket_health_ms)

    state = %State{state | meta: meta}

    if :erlang.system_info(:otp_release) >= ~c"21" do
      {:ok, state, {:continue, :first_heartbeat}}
    else
      {:ok, state, 0}
    end
  end

  # ---------------------------------------------------------------------------
  # Bootstrap
  # ---------------------------------------------------------------------------

  if :erlang.system_info(:otp_release) >= ~c"21" do
    @impl true
    def handle_continue(:first_heartbeat, state), do: handle_info(:heartbeat, state)
  else
    @impl true
    def handle_info(:timeout, state), do: handle_info(:heartbeat, state)
  end

  # ---------------------------------------------------------------------------
  # Heartbeat send
  #
  # Socket nil → socket is rebuilding (WiFi gap). Skip send; the stutter timer
  # keeps firing so recovery is automatic the moment the socket comes back up.
  # ---------------------------------------------------------------------------

  @impl true
  def handle_info(:heartbeat, %State{meta: %{socket: nil}} = state) do
    debug(state.topology, "partisan gossip: heartbeat skipped — socket rebuilding")
    schedule_heartbeat()
    {:noreply, state}
  end

  def handle_info(:heartbeat, %State{meta: meta} = state) do
    # FIX-BUG-4 / FIX-BUG-9: safe_myself catches :exit, never blocks.
    # On own spec change, flush ALL join state (cooldowns + backoffs) because
    # failure records from our old source address are completely stale.
    meta = refresh_own_spec(meta, state.topology)

    case meta.partisan_spec do
      nil ->
        debug(state.topology, "partisan gossip: heartbeat skipped — partisan not ready")

      spec ->
        payload = build_heartbeat(node(), spec, meta.secret)

        case :gen_udp.send(meta.socket, meta.multicast_addr, meta.port, payload) do
          :ok ->
            :ok

          {:error, reason} ->
            warn(state.topology, "partisan gossip: send failed (#{inspect(reason)}) — probing socket")
            send(self(), :socket_health)
        end
    end

    schedule_heartbeat()
    {:noreply, %State{state | meta: meta}}
  end

  # ---------------------------------------------------------------------------
  # UDP receive — unencrypted hot path
  # ---------------------------------------------------------------------------

  def handle_info(
        {:udp, _socket, _ip, _port, <<"heartbeat::", _::binary>> = packet},
        %State{meta: %{secret: nil}} = state
      ) do
    handle_heartbeat(state, packet)
    {:noreply, state}
  end

  # ---------------------------------------------------------------------------
  # UDP receive — AES-256-CBC encrypted
  # ---------------------------------------------------------------------------

  def handle_info(
        {:udp, _socket, _ip, _port, <<iv::binary-size(16), ciphertext::binary>>},
        %State{meta: %{secret: secret}} = state
      )
      when is_binary(secret) do
    case decrypt(state, ciphertext, secret, iv) do
      {:ok, plaintext} -> handle_heartbeat(state, plaintext)
      _                -> :ok   # wrong key = different cluster shard — silent drop
    end

    {:noreply, state}
  end

  # ---------------------------------------------------------------------------
  # UDP socket error — kernel signals the socket is dead.
  #
  # Guard: only act on OUR current socket. Stale errors from previously-closed
  # sockets are silently discarded. begin_socket_rebuild is idempotent via the
  # rebuild_in_progress flag (FIX-BUG-1).
  # ---------------------------------------------------------------------------

  def handle_info({:udp_error, socket, reason}, %State{meta: %{socket: socket} = meta} = state)
      when not is_nil(socket) do
    warn(state.topology, "partisan gossip: UDP socket error #{inspect(reason)} — rebuilding")
    meta = begin_socket_rebuild(meta, state.topology)
    {:noreply, %State{state | meta: meta}}
  end

  def handle_info({:udp_error, _stale, _reason}, state), do: {:noreply, state}

  # Kernel exhausted active-mode deliveries — re-arm immediately.
  def handle_info({:udp_passive, socket}, %State{meta: %{socket: socket}} = state)
      when not is_nil(socket) do
    :inet.setopts(socket, active: true)
    {:noreply, state}
  end

  # Drop all unrecognised UDP frames without logging — avoids storms on
  # shared multicast segments with third-party participants.
  def handle_info({:udp, _socket, _ip, _port, _payload}, state), do: {:noreply, state}

  # ---------------------------------------------------------------------------
  # Socket health probe — catches silently-dead sockets.
  #
  # Android (and some Linux kernels) can invalidate a socket when the radio
  # interface goes down without sending {:udp_error, …}. :inet.getopts/2
  # detects this before the next heartbeat send fails invisibly.
  #
  # FIX-BUG-1: rebuild_in_progress prevents :socket_health and :udp_error
  # from both scheduling independent rebuild sequences.
  # ---------------------------------------------------------------------------

  def handle_info(:socket_health, %State{meta: %{rebuild_in_progress: true} = meta} = state) do
    schedule_socket_health(meta.socket_health_ms)
    {:noreply, state}
  end

  def handle_info(:socket_health, %State{meta: %{socket: nil} = meta} = state) do
    # Defensive: if we somehow lost socket without setting rebuild_in_progress,
    # begin a rebuild now rather than continuing blind.
    warn(state.topology, "partisan gossip: socket is nil without rebuild_in_progress — starting rebuild")
    meta = begin_socket_rebuild(meta, state.topology)
    schedule_socket_health(meta.socket_health_ms)
    {:noreply, %State{state | meta: meta}}
  end

  def handle_info(:socket_health, %State{meta: meta} = state) do
    meta =
      case :inet.getopts(meta.socket, [:active]) do
        {:ok, _} ->
          meta

        {:error, reason} ->
          warn(state.topology, "partisan gossip: socket health probe failed (#{inspect(reason)}) — rebuilding")
          begin_socket_rebuild(meta, state.topology)
      end

    schedule_socket_health(meta.socket_health_ms)
    {:noreply, %State{state | meta: meta}}
  end

  # ---------------------------------------------------------------------------
  # Socket rebuild — exponential backoff, guarded single sequence.
  #
  # FIX-BUG-1: If this fires but socket is already open (a duplicate message
  # was queued before the first rebuild completed), close the just-opened
  # duplicate socket immediately rather than leaking it and clobbering state.
  # ---------------------------------------------------------------------------

  def handle_info({:rebuild_socket, attempt}, %State{meta: meta} = state) do
    case open_socket(meta.port, meta.ip, meta.broadcast_only, meta.multicast_ttl, meta.multicast_if, meta.multicast_addr) do
      {:ok, new_socket} ->
        meta =
          if meta.socket != nil do
            # Duplicate rebuild message — first one already succeeded.
            # Close the extra socket to prevent EMFILE leak.
            warn(state.topology, "partisan gossip: duplicate :rebuild_socket — closing extra socket")
            safe_close(new_socket)
            %{meta | rebuild_in_progress: false, rebuild_attempts: 0}
          else
            debug(state.topology, "partisan gossip: socket rebuilt after #{attempt + 1} attempt(s)")

            new_spec     = safe_myself(state.topology, meta.partisan_spec)
            spec_changed = specs_differ?(meta.partisan_spec, new_spec)

            meta =
              %{meta |
                socket:              new_socket,
                partisan_spec:       new_spec,
                rebuild_in_progress: false,
                rebuild_attempts:    0,
              }

            # Flush join state after interface gap — FIX-BUG-9:
            # flush both cooldowns and backoffs because prior failures may
            # have been due to our old source address being unreachable.
            if spec_changed do
              debug(state.topology, "partisan gossip: own spec changed post-rebuild — flushing all join state")
              flush_all_join_state(meta)
            else
              :ets.delete_all_objects(meta.cooldown_tab)
            end

            meta
          end

        send(self(), :heartbeat)
        {:noreply, %State{state | meta: meta}}

      {:error, reason} ->
        backoff = capped_backoff(@min_socket_backoff_ms, attempt, @max_socket_backoff_ms)
        warn(state.topology, "partisan gossip: rebuild attempt #{attempt + 1} failed (#{inspect(reason)}), retry in #{backoff} ms")
        Process.send_after(self(), {:rebuild_socket, attempt + 1}, backoff)
        {:noreply, %State{state | meta: %{meta | rebuild_attempts: attempt + 1}}}
    end
  end

  # ---------------------------------------------------------------------------
  # Async member cache result — sent back by the spawned fetch process.
  #
  # FIX-BUG-5: members/0 is NEVER called in the GenServer process. A spawned
  # process calls it and sends the result back. The GenServer is never blocked.
  # ---------------------------------------------------------------------------

  def handle_info({:members_result, ref, raw_result}, state) do
    if Process.get(@pd_members_ref) == ref do
      Process.delete(@pd_members_ref)
      names = extract_member_names(raw_result)
      Process.put(@pd_members_cache, {names, System.monotonic_time(:millisecond)})
    end

    # Stale refs from prior spawns are safely ignored.
    {:noreply, state}
  end

  # ---------------------------------------------------------------------------
  # Periodic membership reconciliation — the core self-healing loop.
  # ---------------------------------------------------------------------------

  def handle_info(:reconcile, %State{meta: meta} = state) do
    debug(state.topology, "partisan gossip: reconciling")

    # FIX-BUG-2 partial: opportunistically retry monitor if it was lost.
    meta = maybe_retry_monitor(meta, state.topology)

    now            = System.monotonic_time(:millisecond)
    stale_ms       = meta.reconcile_ms * @liveness_multiplier
    self_node      = node()
    member_names   = current_member_names()

    :ets.tab2list(meta.last_seen_tab)
    |> Enum.reject(fn {name, _, _} -> name == self_node end)
    |> Enum.reduce(0, fn {peer_name, last_ms, peer_spec}, rejoin_count ->
      age = now - last_ms

      cond do
        age >= stale_ms ->
          # Silent for liveness_window — genuinely gone. Purge all state.
          debug(state.topology, "partisan gossip: purging stale entry for #{peer_name}")
          :ets.delete(meta.last_seen_tab, peer_name)
          :ets.delete(meta.cooldown_tab, peer_name)
          :ets.delete(meta.backoff_tab, peer_name)
          rejoin_count

        peer_name in member_names ->
          # Healthy — clear any stale failure backoff from transient issues.
          :ets.delete(meta.backoff_tab, peer_name)
          rejoin_count

        rejoin_count >= meta.max_rejoin_per_cycle ->
          # FIX-BUG-11: cap concurrent async spawns per cycle. Prevents
          # saturating the radio on large networks after a partition heals.
          rejoin_count

        :else ->
          debug(state.topology, "partisan gossip: reconcile queuing async rejoin for #{peer_name}")
          clear_join_state(meta, peer_name)
          spawn_join(state.topology, meta.cooldown_tab, meta.backoff_tab, peer_name, peer_spec)
          rejoin_count + 1
      end
    end)

    schedule_reconcile(meta.reconcile_ms)
    {:noreply, %State{state | meta: meta}}
  end

  # ---------------------------------------------------------------------------
  # partisan_peer_service :DOWN
  #
  # FIX-BUG-2: flush all join state, then immediately try to re-establish the
  # monitor. If partisan hasn't restarted yet, schedule :retry_monitor with
  # exponential backoff. The monitor is NEVER permanently lost.
  # ---------------------------------------------------------------------------

  def handle_info(
        {:DOWN, ref, :process, _pid, reason},
        %State{meta: %{monitor_ref: ref} = meta} = state
      ) do
    warn(state.topology, "partisan gossip: partisan_peer_service DOWN (#{inspect(reason)}) — clearing join state")
    flush_all_join_state(meta)

    {new_ref, retry_attempt} = try_monitor_partisan(state.topology, 0)
    meta = %{meta | monitor_ref: new_ref, monitor_retry_attempt: retry_attempt}

    if new_ref == nil do
      schedule_monitor_retry(0)
    end

    # Brief delay before reconcile — partisan needs a moment to restart
    # under its supervisor before it can accept join/1 calls.
    Process.send_after(self(), :reconcile, 2_000)
    {:noreply, %State{state | meta: meta}}
  end

  # Stale DOWN from an already-superseded monitor — ignore safely.
  def handle_info({:DOWN, _ref, :process, _pid, _reason}, state), do: {:noreply, state}

  # ---------------------------------------------------------------------------
  # FIX-BUG-2: Monitor retry with exponential backoff.
  # Keeps retrying until partisan_peer_service is running and we hold a monitor.
  # ---------------------------------------------------------------------------

  def handle_info({:retry_monitor, attempt}, %State{meta: meta} = state) do
    {new_ref, _} = try_monitor_partisan(state.topology, attempt)

    meta =
      if new_ref != nil do
        debug(state.topology, "partisan gossip: monitor established (attempt #{attempt + 1})")
        %{meta | monitor_ref: new_ref, monitor_retry_attempt: 0}
      else
        backoff = capped_backoff(@monitor_retry_base_ms, attempt, @monitor_retry_max_ms)
        debug(state.topology, "partisan gossip: partisan still not up, retry monitor in #{backoff} ms")
        schedule_monitor_retry(attempt + 1, backoff)
        %{meta | monitor_retry_attempt: attempt + 1}
      end

    {:noreply, %State{state | meta: meta}}
  end

  # ---------------------------------------------------------------------------
  # terminate/2
  # ---------------------------------------------------------------------------

  @impl true
  def terminate(_reason, %State{meta: %{socket: socket}}) do
    safe_close(socket)
    :ok
  end

  # ============================================================================
  # HEARTBEAT PROCESSING
  # ============================================================================

  @spec handle_heartbeat(State.t(), binary()) :: :ok
  defp handle_heartbeat(%State{meta: meta} = state, <<"heartbeat::", rest::binary>>) do
    self_node = node()
    now_ms    = System.monotonic_time(:millisecond)

    # :safe prevents atom table exhaustion — unknown atoms arrive as binaries.
    decoded =
      try do
        {:ok, :erlang.binary_to_term(rest, [:safe])}
      catch
        :error, _ -> :error
      end

    case decoded do
      {:ok, %{node: ^self_node}} ->
        # Own multicast echo — discard.
        :ok

      {:ok, %{node: peer_name, spec: peer_spec}} when is_atom(peer_name) ->
        debug(state.topology, "partisan gossip: heartbeat from #{peer_name}")

        # FIX-BUG-3: direct normalized equality, not phash2, for change detection.
        # FIX-BUG-8: on spec change, clear BOTH cooldown AND backoff — prior
        # failures were against the old address and are completely stale.
        spec_changed? = record_last_seen(meta, peer_name, now_ms, peer_spec)

        if spec_changed? do
          debug(state.topology, "partisan gossip: #{peer_name} spec changed — clearing all join state")
          clear_join_state(meta, peer_name)
        end

        maybe_join_partisan(state, peer_name, peer_spec)

      {:ok, %{node: peer_name}} when is_atom(peer_name) ->
        # No partisan spec — legacy build. Log and discard; do NOT fall back
        # to Node.connect which is meaningless in partisan-only deployments.
        warn(state.topology, "partisan gossip: #{peer_name} sent legacy heartbeat (no spec) — ignoring")

      {:ok, _} ->
        :ok

      :error ->
        :ok
    end
  end

  defp handle_heartbeat(_state, _packet), do: :ok

  # ============================================================================
  # PARTISAN JOIN — layered gate
  # ============================================================================

  # Gate order (cheapest to most expensive):
  #   1. per-node cooldown  — sub-µs ETS lookup
  #   2. per-node backoff   — sub-µs ETS lookup
  #   3. overlay membership — cached list membership check (in-memory)
  #   4. spawn async join
  #
  # FIX-BUG-6 / FIX-BUG-7: join/1 is NEVER called synchronously in the
  # GenServer process. Every join attempt is an unlinked spawn that writes
  # results back to ETS. The hot receive path always returns immediately.
  defp maybe_join_partisan(%State{meta: meta, topology: topo}, peer_name, peer_spec) do
    cond do
      within_cooldown?(meta.cooldown_tab, peer_name, meta.join_cooldown_ms) ->
        :ok

      within_backoff?(meta.backoff_tab, peer_name) ->
        :ok

      already_member?(peer_name) ->
        :ok

      :else ->
        spawn_join(topo, meta.cooldown_tab, meta.backoff_tab, peer_name, peer_spec)
    end
  end

  defp within_cooldown?(tab, peer_name, cooldown_ms) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(tab, peer_name) do
      [{^peer_name, last}] -> (now - last) < cooldown_ms
      []                   -> false
    end
  end

  defp within_backoff?(backoff_tab, peer_name) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(backoff_tab, peer_name) do
      [{^peer_name, next_ms, _count}] -> now < next_ms
      []                              -> false
    end
  end

  # FIX-BUG-5: non-blocking member check via process-dictionary cache.
  defp already_member?(peer_name), do: peer_name in current_member_names()

  # ---------------------------------------------------------------------------
  # spawn_join — async, non-blocking, writes results to ETS.
  #
  # Cooldown is recorded SYNCHRONOUSLY before spawning so concurrent gossip
  # ticks arriving while the spawn is running cannot bypass the gate.
  # ---------------------------------------------------------------------------

  defp spawn_join(topo, cooldown_tab, backoff_tab, peer_name, peer_spec) do
    :ets.insert(cooldown_tab, {peer_name, System.monotonic_time(:millisecond)})

    :erlang.spawn(fn ->
      result =
        try do
          :partisan_peer_service.join(peer_spec)
        rescue
          e -> {:error, {:exception, Exception.message(e)}}
        catch
          kind, reason -> {:error, {kind, reason}}
        end

      case result do
        :ok ->
          :ets.delete(backoff_tab, peer_name)

        {:error, :already_member} ->
          # Benign race — gossip tick and reconciler both tried concurrently.
          :ets.delete(backoff_tab, peer_name)

        {:error, reason} ->
          fail_count =
            case :ets.lookup(backoff_tab, peer_name) do
              [{^peer_name, _, count}] -> count
              []                       -> 0
            end

          next_backoff_ms = capped_backoff(@min_join_backoff_ms, fail_count, @max_join_backoff_ms)
          next_ms         = System.monotonic_time(:millisecond) + next_backoff_ms
          :ets.insert(backoff_tab, {peer_name, next_ms, fail_count + 1})

          # Logger.warn is safe from spawned processes.
          require Logger
          Logger.warn("[#{topo}] partisan gossip: join failed for #{peer_name}: #{inspect(reason)}")
      end
    end)

    :ok
  end

  # ============================================================================
  # MEMBER LIST CACHE — non-blocking, async refresh
  # ============================================================================

  # Returns cached member names, triggering a background refresh if stale.
  # The GenServer is NEVER blocked; stale data is served during the refresh.
  defp current_member_names() do
    now = System.monotonic_time(:millisecond)

    case Process.get(@pd_members_cache) do
      {names, fetched_at} when (now - fetched_at) < @members_cache_ttl_ms ->
        names

      stale ->
        # Trigger async refresh only if no fetch is already pending.
        unless Process.get(@pd_members_ref) do
          ref    = make_ref()
          parent = self()
          Process.put(@pd_members_ref, ref)

          :erlang.spawn(fn ->
            raw =
              try do
                :partisan_peer_service.members()
              catch
                _, _ -> {:error, :crashed}
              end

            send(parent, {:members_result, ref, raw})
          end)
        end

        # Return stale cache or [] while refresh is in flight.
        case stale do
          {names, _} -> names
          nil        -> []
        end
    end
  end

  defp extract_member_names({:ok, members}) do
    Enum.flat_map(members, fn
      %{name: n}        -> [n]
      {n, _}            -> [n]
      n when is_atom(n) -> [n]
      _                 -> []
    end)
  end

  defp extract_member_names(_), do: []

  # ============================================================================
  # OWN SPEC MANAGEMENT
  # ============================================================================

  # Refresh own spec on every heartbeat. On change:
  # FIX-BUG-4: safe_myself catches :exit (partisan mid-restart) and returns
  #   the cached spec. The GenServer is NEVER blocked.
  # FIX-BUG-9: flush BOTH cooldown_tab AND backoff_tab on own spec change.
  #   Prior join failures were against our old source address — all stale.
  defp refresh_own_spec(%{partisan_spec: old_spec} = meta, topo) do
    new_spec = safe_myself(topo, old_spec)

    if specs_differ?(old_spec, new_spec) do
      debug(topo, "partisan gossip: own spec changed — flushing all join state")
      flush_all_join_state(meta)
      %{meta | partisan_spec: new_spec}
    else
      meta
    end
  end

  # safe_myself wraps myself() with exit protection.
  # FIX-BUG-4: catches :exit from GenServer timeout / noproc. Returns
  # cached_spec on any failure so heartbeats keep working during restarts.
  defp safe_myself(topo, cached_spec) do
    :partisan.node_spec()
  catch
    :exit, {:noproc, _} ->
      debug(topo, "partisan gossip: myself() — partisan not running, using cached spec")
      cached_spec

    :exit, {:timeout, _} ->
      warn(topo, "partisan gossip: myself() timed out — using cached spec")
      cached_spec

    kind, reason ->
      warn(topo, "partisan gossip: myself() failed #{kind}/#{inspect(reason)} — using cached spec")
      cached_spec
  end

  # FIX-BUG-3: normalize before comparing so list-ordering differences in
  # logically-equivalent specs do not trigger false spec-change events.
  defp specs_differ?(a, b), do: normalize_spec(a) != normalize_spec(b)

  defp normalize_spec(nil), do: nil

  defp normalize_spec(%{} = spec) do
    spec
    |> Map.update(:listen_addrs, [], &Enum.sort/1)
    |> Map.update(:channels, [], &Enum.sort/1)
  end

  defp normalize_spec(other), do: other

  # ============================================================================
  # LIVENESS TRACKING
  # ============================================================================

  # Record liveness and return true if spec changed.
  # FIX-BUG-3: uses normalize_spec + == not phash2.
  # FIX-BUG-10: enforces max_tracked_peers cap to bound memory.
  defp record_last_seen(%{last_seen_tab: tab, max_tracked_peers: cap}, peer_name, now_ms, peer_spec) do
    norm = normalize_spec(peer_spec)

    spec_changed? =
      case :ets.lookup(tab, peer_name) do
        [{^peer_name, _t, old_norm}] -> old_norm != norm
        []                           -> false
      end

    if :ets.info(tab, :size) < cap or :ets.member(tab, peer_name) do
      :ets.insert(tab, {peer_name, now_ms, norm})
    end

    spec_changed?
  end

  # ============================================================================
  # JOIN STATE HELPERS
  # ============================================================================

  # FIX-BUG-8: clears BOTH cooldown and backoff for a single peer.
  defp clear_join_state(%{cooldown_tab: ct, backoff_tab: bt}, peer_name) do
    :ets.delete(ct, peer_name)
    :ets.delete(bt, peer_name)
  end

  # FIX-BUG-9: flush ALL join state — own spec change or partisan DOWN.
  defp flush_all_join_state(%{cooldown_tab: ct, backoff_tab: bt}) do
    :ets.delete_all_objects(ct)
    :ets.delete_all_objects(bt)
  end

  # ============================================================================
  # SOCKET LIFECYCLE
  # ============================================================================

  # Idempotent rebuild initiator — FIX-BUG-1 via rebuild_in_progress flag.
  # Sets socket: nil and rebuild_in_progress: true so subsequent calls from
  # :socket_health or stale :udp_error messages skip without double-scheduling.
  defp begin_socket_rebuild(%{rebuild_in_progress: true} = meta, topo) do
    debug(topo, "partisan gossip: rebuild already in progress — ignoring duplicate trigger")
    meta
  end

  defp begin_socket_rebuild(meta, _topo) do
    safe_close(meta.socket)
    Process.send_after(self(), {:rebuild_socket, 0}, @min_socket_backoff_ms)
    %{meta | socket: nil, rebuild_in_progress: true, rebuild_attempts: 0}
  end

  defp open_socket(port, ip, broadcast_only?, ttl, multicast_if, multicast_addr) do
    multicast_opts =
      cond do
        broadcast_only? ->
          []

        multicast_if != nil ->
          [
            multicast_if:   multicast_if,
            multicast_ttl:  ttl,
            multicast_loop: true,
            add_membership: {multicast_addr, multicast_if}
          ]

        :else ->
          [
            multicast_ttl:  ttl,
            multicast_loop: true,
            add_membership: {multicast_addr, {0, 0, 0, 0}}
          ]
      end

    opts =
      [:binary, active: true, ip: ip, reuseaddr: true, broadcast: true]
      |> Kernel.++(multicast_opts)
      |> Kernel.++(reuse_port())

    :gen_udp.open(port, opts)
  end

  defp safe_close(nil), do: :ok

  defp safe_close(socket) do
    try do
      :gen_udp.close(socket)
    catch
      _, _ -> :ok
    end
  end

  # ============================================================================
  # PARTISAN MONITOR
  # ============================================================================

  defp try_monitor_partisan(topo, attempt) do
    case Process.whereis(:partisan_peer_service) do
      nil ->
        debug(topo, "partisan gossip: partisan_peer_service not found (attempt #{attempt})")
        {nil, attempt}

      pid ->
        {Process.monitor(pid), 0}
    end
  end

  # Called from reconciler — opportunistic re-monitor if we lost it.
  defp maybe_retry_monitor(%{monitor_ref: nil, monitor_retry_attempt: attempt} = meta, topo) do
    case try_monitor_partisan(topo, attempt) do
      {nil, _}     -> meta
      {new_ref, 0} -> %{meta | monitor_ref: new_ref, monitor_retry_attempt: 0}
    end
  end

  defp maybe_retry_monitor(meta, _topo), do: meta

  # ============================================================================
  # SCHEDULING
  # ============================================================================

  # Stutter: [1 000, 5 000) ms — prevents lockstep storms on simultaneous boot.
  defp schedule_heartbeat(),
    do: Process.send_after(self(), :heartbeat, 1_000 + :rand.uniform(4_000))

  defp schedule_reconcile(ms),
    do: Process.send_after(self(), :reconcile, ms)

  defp schedule_socket_health(ms),
    do: Process.send_after(self(), :socket_health, ms)

  defp schedule_monitor_retry(attempt, backoff_ms \\ @monitor_retry_base_ms),
    do: Process.send_after(self(), {:retry_monitor, attempt}, backoff_ms)

  # ============================================================================
  # PACKET CONSTRUCTION
  # ============================================================================

  defp build_heartbeat(node_name, spec, nil) do
    ["heartbeat::", :erlang.term_to_binary(%{node: node_name, spec: spec})]
  end

  defp build_heartbeat(node_name, spec, secret) when is_binary(secret) do
    message = "heartbeat::" <> :erlang.term_to_binary(%{node: node_name, spec: spec})
    {:ok, iv, ciphertext} = encrypt_message(message, secret)
    [iv, ciphertext]
  end

  # ============================================================================
  # PLATFORM HELPERS
  # ============================================================================

  defp reuse_port() do
    case :os.type() do
      {:unix, os} when os in [:darwin, :freebsd, :openbsd, :linux, :netbsd] ->
        [{:raw, @sol_socket, @so_reuseport, <<1::native-32>>}]

      _ ->
        []
    end
  end

  defp sanitize_ip({_a, _b, _c, _d} = ip), do: ip

  defp sanitize_ip(ip) when is_binary(ip) do
    {:ok, addr} = :inet.parse_ipv4_address(~c"#{ip}")
    addr
  end

  defp capped_backoff(base_ms, attempt, cap_ms) do
    min(trunc(base_ms * :math.pow(2, attempt)), cap_ms)
  end

  # ============================================================================
  # CRYPTO — AES-256-CBC + PKCS7
  # ============================================================================

  defp encrypt_message(plaintext, password) do
    iv         = :crypto.strong_rand_bytes(16)
    key        = :crypto.hash(:sha256, password)
    ciphertext = :crypto.crypto_one_time(:aes_256_cbc, key, iv, pkcs7_pad(plaintext), true)
    {:ok, iv, ciphertext}
  end

  defp decrypt(state, ciphertext, password, iv) do
    key = :crypto.hash(:sha256, password)

    with {:unpadding, {:ok, padded}} <- {:unpadding, safe_decrypt(state, key, iv, ciphertext)},
         {:decrypt, {:ok, _} = res}  <- {:decrypt, pkcs7_unpad(padded)} do
      res
    else
      {:unpadding, :error} -> {:error, :decrypt}
      {:decrypt, :error}   -> {:error, :unpadding}
    end
  end

  defp safe_decrypt(state, key, iv, ciphertext) do
    {:ok, :crypto.crypto_one_time(:aes_256_cbc, key, iv, ciphertext, false)}
  catch
    :error, {tag, {file, line}, desc} ->
      warn(state.topology, "partisan gossip: decrypt failed #{inspect(tag)} (#{file}:#{line}): #{desc}")
      :error
  end

  defp pkcs7_pad(message) do
    bytes_remaining = rem(byte_size(message), 16)
    padding_size    = 16 - bytes_remaining
    message <> :binary.copy(<<padding_size>>, padding_size)
  end

  defp pkcs7_unpad(<<>>), do: :error

  defp pkcs7_unpad(message) do
    padding_size = :binary.last(message)

    if padding_size <= 16 do
      message_size = byte_size(message)

      if binary_part(message, message_size, -padding_size) ===
           :binary.copy(<<padding_size>>, padding_size) do
        {:ok, binary_part(message, 0, message_size - padding_size)}
      else
        :error
      end
    else
      :error
    end
  end
end
