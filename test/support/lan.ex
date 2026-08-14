defmodule Dojo.Test.Lan do
  @moduledoc """
  A virtual LAN of real Partisan nodes, driven from ExUnit.

  Each node runs the actual app in its own network namespace, so
  `routable_ipv4_addrs/0` sees exactly one address — that node's. The
  namespaces hang off a bridge, which carries mDNS multicast between them. A
  roam is a genuine `ip addr` change on a node's veth.

  Requires the namespace wrapper; tests are skipped without it:

      scripts/verify/lan_test.sh

  The bridge deliberately holds no IPv4 address. The test runner lives in the
  parent namespace, so an address there would make ExUnit itself a fourth node
  on the LAN and it would show up in everyone's membership.
  """

  @subnet "10.99.0"

  # ── availability ─────────────────────────────────────────────────────────

  @doc "True when running inside the namespace wrapper."
  def available?, do: System.get_env("DOJO_LAN_NS") == "1"

  def out_dir, do: System.fetch_env!("DOJO_LAN_DIR")
  defp run, do: System.fetch_env!("DOJO_LAN_RUN")
  defp namespace(i), do: "#{run()}-n#{i}"
  defp bridge, do: "#{run()}-br"

  # ── topology ─────────────────────────────────────────────────────────────

  @doc """
  Build the bridge and `n` namespaces, then start a node in each.

  Nodes are started one at a time on purpose: two `mix run`s racing on _build
  is how the rig inflicts on itself the absent-module fault it exists to study.
  """
  def start(n, opts \\ []) do
    File.rm_rf!(out_dir())
    File.mkdir_p!(out_dir())

    ip(["link", "add", bridge(), "type", "bridge"])
    ip(["link", "set", bridge(), "up"])

    for i <- 1..n, do: add_namespace(i)
    for i <- 1..n, do: start_node(i, opts)

    :ok
  end

  @doc "Kill every node and tear the namespaces down."
  def stop do
    for %{os_pid: pid} <- statuses(), do: System.cmd("kill", [pid], stderr_to_stdout: true)
    :ok
  end

  defp add_namespace(i) do
    ns = namespace(i)
    ip(["netns", "add", ns])
    ip(["link", "add", "v#{i}", "type", "veth", "peer", "name", "p#{i}"])
    ip(["link", "set", "p#{i}", "master", bridge()])
    ip(["link", "set", "p#{i}", "up"])
    ip(["link", "set", "v#{i}", "netns", ns])
    ip(["-n", ns, "addr", "add", "#{@subnet}.#{i}/24", "dev", "v#{i}"])
    ip(["-n", ns, "link", "set", "v#{i}", "up"])
    ip(["-n", ns, "link", "set", "lo", "up"])
  end

  @doc "Launch node `i` and block until it reports. Also used to bring a crashed node back."
  def start_node(i, opts \\ []) do
    boot_timeout = Keyword.get(opts, :boot_timeout, 90_000)

    cmd =
      "ip netns exec #{namespace(i)} env MIX_ENV=lan DOJO_LAN_NODE=#{i} PORT=4000 " <>
        "mix run --no-compile --no-deps-check --no-halt " <>
        "scripts/verify/lan_node.exs #{i} #{out_dir()} > #{out_dir()}/node#{i}.log 2>&1"

    Port.open({:spawn_executable, System.find_executable("sh")}, [
      :binary,
      args: ["-c", cmd]
    ])

    unless await(fn -> status(i) != nil end, boot_timeout) do
      raise "node#{i} failed to boot:\n#{File.read!("#{out_dir()}/node#{i}.log")}"
    end

    :ok
  end

  # ── the network, as a test can move it ───────────────────────────────────

  @doc "Give node `i` a new address — a DHCP renewal or a WiFi hop."
  def roam(i, cidr) do
    ip(["-n", namespace(i), "addr", "flush", "dev", "v#{i}"])
    ip(["-n", namespace(i), "addr", "add", cidr, "dev", "v#{i}"])
    :ok
  end

  @doc "Cut node `i` off the bridge. Its own interface stays up, as in a real dead link."
  def partition(i), do: ip(["link", "set", "p#{i}", "down"])

  @doc "Put node `i` back on the bridge."
  def heal(i), do: ip(["link", "set", "p#{i}", "up"])

  # ── departure, crash, recovery ───────────────────────────────────────────

  @doc """
  Kill node `i`'s BEAM outright — no goodbye, no shutdown.

  Truer than stopping the mDNS process: a real crashed device sends nothing,
  and peers must notice by absence alone (POOF). The status file is removed so
  the node stops counting toward a mesh it can no longer join.
  """
  def crash_node(i) do
    case status(i) do
      %{os_pid: pid} -> System.cmd("kill", ["-9", pid], stderr_to_stdout: true)
      nil -> :ok
    end

    File.rm(Path.join(out_dir(), "node#{i}.term"))
    :ok
  end

  @doc """
  Stop node `i`'s mDNS through its supervisor — a graceful departure.

  `Supervisor.terminate_child/2` runs `terminate/2`, which is where the TTL=0
  goodbye is sent. That is the difference this exercises: a goodbye evicts
  peers at once, where a crash makes them wait out POOF.
  """
  def stop_mdns(i) do
    call(i, Supervisor, :terminate_child, [Dojo.Cluster.Supervisor, Dojo.Cluster.MDNS])
  end

  @doc "Bring node `i`'s mDNS back under its supervisor."
  def start_mdns(i) do
    call(i, Supervisor, :restart_child, [Dojo.Cluster.Supervisor, Dojo.Cluster.MDNS])
  end

  @doc "Names in node `i`'s mDNS cache."
  def mdns_peers(i) do
    case call(i, Dojo.Cluster.MDNS, :cached_peers, []) do
      {:ok, peers} -> Enum.map(peers, &elem(&1, 0))
      _ -> []
    end
  end

  @doc "Wait until `observer` no longer caches `name`."
  def await_evicted(observer, name, timeout \\ 45_000) do
    await(fn -> name not in mdns_peers(observer) end, timeout, 1_000)
  end

  @doc "Wait until `observer` caches `name`."
  def await_discovered(observer, name, timeout \\ 45_000) do
    await(fn -> name in mdns_peers(observer) end, timeout, 1_000)
  end

  @doc "True while node `i`'s BEAM is up."
  def alive?(i) do
    case status(i) do
      %{os_pid: pid} -> match?({_, 0}, System.cmd("kill", ["-0", pid], stderr_to_stdout: true))
      nil -> false
    end
  end

  @doc """
  Return every node to its canonical address and reconnect it, then wait for
  the mesh.

  The LAN is shared mutable state and ExUnit randomises order, so without this
  a test that moves the subnet strands the next test's roam on the far side of
  it — a partition that looks like a discovery bug. Nodes already at baseline
  are left alone: a needless flush would churn NetworkMonitor for nothing.
  """
  def baseline!(n, opts \\ []) do
    for i <- 1..n, do: heal(i)

    # A test that crashed a node or stopped its mDNS must not hand the next one
    # a smaller cluster than it asked for.
    for i <- 1..n, not alive?(i), do: start_node(i, opts)
    for i <- 1..n, do: start_mdns(i)

    for s <- statuses(), i = String.to_integer(to_string(s.idx)), s.ips != [canonical(i)] do
      roam(i, "#{@subnet}.#{i}/24")
    end

    await_mesh(n, opts)
  end

  defp canonical(i) do
    [a, b, c] = String.split(@subnet, ".") |> Enum.map(&String.to_integer/1)
    {a, b, c, i}
  end

  # ── what the nodes report ────────────────────────────────────────────────

  def status(i) do
    path = Path.join(out_dir(), "node#{i}.term")

    with true <- File.exists?(path),
         {:ok, bin} <- File.read(path) do
      # A half-written file is a normal race against the writer, not a fault.
      decode(bin)
    else
      _ -> nil
    end
  end

  def statuses do
    out_dir()
    |> Path.join("node*.term")
    |> Path.wildcard()
    |> Enum.map(&(&1 |> File.read!() |> decode()))
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(& &1.idx)
  end

  @doc """
  Run `{m, f, a}` on node `i` and return its result.

  An MFA, never a closure — a fun would carry a reference to code this node
  may have compiled differently.
  """
  def call(i, m, f, a, timeout \\ 10_000) do
    ref = System.unique_integer([:positive])
    reply = Path.join(out_dir(), "node#{i}.reply.#{ref}")
    File.write!(Path.join(out_dir(), "node#{i}.cmd"), :erlang.term_to_binary({ref, m, f, a}))

    if await(fn -> File.exists?(reply) end, timeout) do
      result = reply |> File.read!() |> decode()
      File.rm(reply)
      result
    else
      {:error, :timeout}
    end
  end

  # ── the assertion that matters ───────────────────────────────────────────

  @doc """
  Wait until every node hears a live beat from every other node.

  Judged on PubSub beats, not on `:partisan_peer_service.members/0`. Membership
  is a CRDT: it keeps naming a peer that has been unplugged, so a names-only
  check calls a fully partitioned cluster converged.

  Statuses older than `settle_ms` after the call are ignored. Beats live for a
  few seconds in each node's window, so a status written immediately after a
  roam still reports peers heard from *before* it — judging on one turns a
  roam test into a no-op that always passes.
  """
  def await_mesh(n, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 90_000)
    settle = Keyword.get(opts, :settle_ms, 7_000)
    cutoff = System.system_time(:second) + div(settle, 1000)

    await(fn -> meshed?(n, cutoff) end, timeout)
  end

  @doc "The inverse — used by the negative control, where a mesh must NOT form."
  def refute_mesh(n, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 45_000)
    not await_mesh(n, Keyword.put(opts, :timeout, timeout))
  end

  defp meshed?(n, cutoff) do
    nodes = Enum.filter(statuses(), &(&1.at > cutoff))
    names = MapSet.new(nodes, & &1.name)

    length(nodes) == n and
      Enum.all?(nodes, fn node ->
        healthy?(node) and
          MapSet.subset?(MapSet.delete(names, node.name), MapSet.new(node.reachable))
      end)
  end

  # Advertising an address with no listener behind it is the quiet failure:
  # membership still names the peer, but every dial lands on an IP nobody holds.
  defp healthy?(n) do
    :partisan in n.apps and :dojo in n.apps and
      is_pid(n.anchors.app) and is_pid(n.anchors.endpoint) and
      (n.ips == [] or MapSet.subset?(MapSet.new(n.listen_addrs), MapSet.new(n.ips)))
  end

  @doc "A readable dump of every node, for a failure message."
  def describe do
    Enum.map_join(statuses(), "\n", fn n ->
      "  node#{n.idx} #{short(n.name)} holds=#{fmt(n.ips)} adv=#{fmt(n.listen_addrs)} " <>
        "reachable=#{inspect(Enum.map(n.reachable, &short/1))} " <>
        "members=#{length(n.members)} apps=#{inspect(n.apps -- [:kernel, :stdlib])}"
    end)
  end

  # ── plumbing ─────────────────────────────────────────────────────────────

  defp await(fun, timeout, interval \\ 500) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_await(fun, deadline, interval)
  end

  defp do_await(fun, deadline, interval) do
    if fun.() do
      true
    else
      if System.monotonic_time(:millisecond) >= deadline do
        false
      else
        Process.sleep(interval)
        do_await(fun, deadline, interval)
      end
    end
  end

  defp ip(args) do
    case System.cmd("ip", args, stderr_to_stdout: true) do
      {_, 0} -> :ok
      {out, code} -> raise "ip #{Enum.join(args, " ")} failed (#{code}): #{String.trim(out)}"
    end
  end

  defp decode(bin) do
    :erlang.binary_to_term(bin)
  rescue
    _ -> nil
  end

  defp short(name),
    do: name |> to_string() |> String.split("@") |> List.last() |> String.slice(0, 8)

  defp fmt([]), do: "none"
  defp fmt(ips), do: Enum.map_join(ips, ",", &(&1 |> :inet.ntoa() |> to_string()))
end
