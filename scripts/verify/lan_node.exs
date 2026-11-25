# One node of the virtual LAN. Runs inside its own network namespace, where
# `routable_ipv4_addrs/0` sees exactly one address — this node's.
#
# Launched by lan.sh; not useful on its own. It boots the real app (Partisan,
# mDNS, NetworkMonitor) and writes what it can see to a status file every
# second, so the orchestrator can read the cluster's opinion of itself without
# needing distribution between namespaces.

defmodule LanNode do
  @interval 1_000
  @topic "lan:beat"
  # A beat older than this means the path went away, not that we were unlucky.
  @stale_ms 6_000

  # `Logger.error/1` is a macro: without this the diagnostic itself raises and
  # takes the node down with it (Elixir 1.20).
  require Logger

  alias Dojo.Cluster.MDNS
  alias Dojo.Keep.{Auth, Log}
  alias Dojo.Keep.Sync.Partisan

  # How often the inbox for test-issued commands is checked.
  @cmd_slice_ms 100

  def run([idx, out_dir]) do
    # Diagnostic: name the process that tears the node down. A bare `mix run'
    # script dies on the first linked `:shutdown`, which hides the culprit; with
    # exits trapped the node survives and the log names who left.
    Process.flag(:trap_exit, true)

    path = Path.join(out_dir, "node#{idx}.term")
    File.mkdir_p!(out_dir)
    open_keep(idx, out_dir)
    Phoenix.PubSub.subscribe(Dojo.PubSub, @topic)
    loop(path, idx, out_dir, %{})
  end

  # ── keep: one durable log per node, replicated through Partisan ────────────
  # The writer identity lives in the database, so a node that reboots under a new
  # partisan name resumes its own sequence instead of forking (D067.1).
  defp open_keep(idx, out_dir) do
    # The log modules are parked off this branch (stash parked/keep-knowledge), so
    # a node still boots for the reconnect rig: keep commands fail at the call site.
    if Code.ensure_loaded?(Dojo.Keep.Sync.Partisan) do
      # Ecto already owns keepN.db in this rig. An assertion log is a different store.
      {:ok, conn} = Log.open(Path.join(out_dir, "assertions#{idx}.db"))
      _ = Log.ensure_writer(conn)
      Partisan.attach(conn)
    else
      :ok
    end
  end

  def keep_trust(signers) do
    conn = Partisan.conn()
    for {id, pub} <- signers, do: :ok = Log.register_signer(conn, id, pub)
    Log.set_require_auth(conn, true)
  end

  def keep_commit(id, value, signer, private_key) do
    conn = Partisan.conn()

    Log.commit(conn, %{
      type: :keep_fact,
      key: %{id: id},
      value: value,
      signer: signer,
      sign: fn bytes -> Auth.sign_assertion(private_key, bytes) end
    })
  end

  def keep_range(origin), do: Log.range(Partisan.conn(), origin, 0)

  def keep_exchange(peer), do: Partisan.exchange(peer)

  def keep_exchange_all, do: Partisan.exchange_all()
  def keep_acks, do: Log.peer_acks(Partisan.conn())
  def keep_observed_by(origin, seq), do: Log.observed_by(Partisan.conn(), origin, seq)

  def keep_commit_many(count, prefix, signer, private_key) do
    for n <- 1..count do
      {:ok, op} = keep_commit("#{prefix}-#{n}", "#{prefix} value #{n}", signer, private_key)
      op
    end
  end

  def keep_exchange_traced(peer) do
    caller = self()
    tracer = spawn(fn -> keep_trace(caller, []) end)
    {:module, :partisan_rpc} = :code.ensure_loaded(:partisan_rpc)
    1 = :erlang.trace_pattern({:partisan_rpc, :call, 5}, true, [:local])
    :erlang.trace(caller, true, [:call, {:tracer, tracer}])

    try do
      result = keep_exchange(peer)
      ref = :erlang.trace_delivered(caller)
      receive do: ({:trace_delivered, ^caller, ^ref} -> :ok)
      send(tracer, {:flush, ref})
      calls = receive do: ({:keep_calls, ^ref, calls} -> calls)
      %{result: result, calls: calls}
    after
      :erlang.trace(caller, false, [:call])
      :erlang.trace_pattern({:partisan_rpc, :call, 5}, false, [:local])
      send(tracer, :stop)
    end
  end

  defp keep_trace(caller, calls) do
    receive do
      {:trace, ^caller, :call, {:partisan_rpc, :call, [peer, Partisan, method, args, opts]}} ->
        call = %{peer: peer, method: method, args: args, opts: opts}
        keep_trace(caller, [call | calls])

      {:flush, ref} ->
        send(caller, {:keep_calls, ref, Enum.reverse(calls)})
        keep_trace(caller, [])

      :stop ->
        :ok

      _ ->
        keep_trace(caller, calls)
    end
  end

  @doc "Every materialised unit on this node — the projection as data."
  def keep_units, do: Log.units(Partisan.conn())

  @doc "The local applied frontier, completeness, and admission mode."
  def keep_status do
    conn = Partisan.conn()
    Map.put(Log.status(conn), :require_auth, Log.require_auth?(conn))
  end

  # These are invoked through the file command bridge. They prove the shipped
  # PubSub path, not just Partisan's membership view.
  def subscribe(topic), do: Phoenix.PubSub.subscribe(Dojo.PubSub, topic)

  def broadcast(topic, token) do
    Phoenix.PubSub.broadcast(Dojo.PubSub, topic, {:lan_probe, topic, token, :partisan.node()})
  end

  def await_broadcast(topic, token, timeout \\ 5_000) do
    receive do
      {:lan_probe, ^topic, ^token, sender} -> {:ok, sender}
    after
      timeout -> :timeout
    end
  end

  defp loop(path, idx, dir, seen) do
    Phoenix.PubSub.broadcast(Dojo.PubSub, @topic, {:beat, :partisan.node()})
    seen = collect(seen, dir, idx, System.monotonic_time(:millisecond) + @interval)
    File.write!(path, :erlang.term_to_binary(status(idx, seen)))
    loop(path, idx, dir, seen)
  end

  # Collecting beats, pacing the writes, and serving commands are one wait.
  # Sliced so a test's call is answered in ~100ms rather than at the next beat.
  defp collect(seen, dir, idx, deadline) do
    now = System.monotonic_time(:millisecond)
    remaining = deadline - now

    if remaining <= 0 do
      seen
    else
      serve_commands(dir, idx)

      seen =
        receive do
          {:EXIT, pid, reason} ->
            Logger.error(
              "[LanNode] linked process exited: from=#{inspect(pid)} " <>
                "reason=#{inspect(reason)} info=#{inspect(Process.info(pid))}"
            )

            seen

          {:beat, name} ->
            Map.put(seen, name, now)
        after
          min(remaining, @cmd_slice_ms) -> seen
        end

      collect(seen, dir, idx, deadline)
    end
  end

  # Commands arrive as {ref, module, fun, args} — an MFA, never a closure: a
  # fun carries a reference to code this node may have compiled differently.
  defp serve_commands(dir, idx) do
    inbox = Path.join(dir, "node#{idx}.cmd")

    with true <- File.exists?(inbox),
         {:ok, bin} <- File.read(inbox),
         {ref, m, f, a} <- safe_binary_to_term(bin) do
      File.rm(inbox)
      result = command(m, f, a)
      File.write!(Path.join(dir, "node#{idx}.reply.#{ref}"), :erlang.term_to_binary(result))
    else
      _ -> :ok
    end
  end

  defp command(m, f, a) do
    {:ok, apply(m, f, a)}
  catch
    kind, reason -> {:error, {:call_failed, Exception.format(kind, reason, __STACKTRACE__)}}
  end

  defp safe_binary_to_term(bin) do
    :erlang.binary_to_term(bin)
  rescue
    _ -> nil
  end

  defp status(idx, seen) do
    now = System.monotonic_time(:millisecond)
    me = :partisan.node()

    reachable =
      for {name, t} <- seen, name != me, now - t < @stale_ms, do: name

    Map.merge(base(idx), %{
      # The only claim that survives a partition: a message went there and
      # came back. Membership is a CRDT and does not shrink when a peer
      # vanishes, so it cannot answer "is this node reachable right now".
      reachable: reachable,
      connected: safe(fn -> :partisan.nodes() end, [])
    })
  end

  defp base(idx) do
    %{
      idx: idx,
      os_pid: System.pid(),
      at: System.system_time(:second),
      name: :partisan.node(),
      ips: safe(fn -> MDNS.routable_ipv4_addrs() end, []),
      listen_addrs: safe(fn -> Enum.map(:partisan_config.get(:listen_addrs), & &1.ip) end, []),
      members: members(),
      mdns_peers: safe(fn -> Enum.map(MDNS.cached_peers(), &elem(&1, 0)) end, []),
      # If these are not the same pid every tick, discovery took the app with it.
      anchors: %{
        app: Process.whereis(Dojo.Supervisor),
        endpoint: Process.whereis(DojoWeb.Endpoint),
        cluster: Process.whereis(Dojo.Cluster.Supervisor)
      },
      apps: Application.started_applications() |> Enum.map(&elem(&1, 0))
    }
  end

  defp members do
    safe(
      fn ->
        case :partisan_peer_service.members() do
          {:ok, ms} -> ms
          ms when is_list(ms) -> ms
          _ -> []
        end
      end,
      []
    )
  end

  # A node that cannot answer must still report; a crash here would blind the
  # orchestrator to the very failure it is watching for.
  defp safe(fun, default) do
    fun.()
  rescue
    _ -> default
  catch
    _, _ -> default
  end
end

LanNode.run(System.argv())
