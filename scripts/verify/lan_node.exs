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

  # How often the inbox for test-issued commands is checked.
  @cmd_slice_ms 100

  def run([idx, out_dir]) do
    path = Path.join(out_dir, "node#{idx}.term")
    File.mkdir_p!(out_dir)
    Phoenix.PubSub.subscribe(Dojo.PubSub, @topic)
    loop(path, idx, out_dir, %{})
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
          {:beat, name} -> Map.put(seen, name, now)
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
      result = safe(fn -> {:ok, apply(m, f, a)} end, {:error, :call_failed})
      File.write!(Path.join(dir, "node#{idx}.reply.#{ref}"), :erlang.term_to_binary(result))
    else
      _ -> :ok
    end
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
      ips: safe(fn -> Dojo.Cluster.MDNS.routable_ipv4_addrs() end, []),
      listen_addrs: safe(fn -> Enum.map(:partisan_config.get(:listen_addrs), & &1.ip) end, []),
      members: members(),
      mdns_peers: safe(fn -> Enum.map(Dojo.Cluster.MDNS.cached_peers(), &elem(&1, 0)) end, []),
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
