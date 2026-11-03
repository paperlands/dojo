defmodule Dojo.Cluster.TransportInvariantsTest do
  @moduledoc """
  The transport invariants the SQLite convergence plane will lean on, checked on
  real nodes over real interfaces.

  Three questions, each one an invariant rather than a symptom:

    1. after a node changes address, do its peers hold **one** spec for it, at the
       **new** address? (a cluster that reports healthy peers can still be dialling
       a dead one)
    2. when a node crashes, does the spec leave the view and the membership, rather
       than lingering as a member nobody can reach?
    3. is the effective configuration what this node intends — a control channel
       that cannot drop directed messages, a bounded connection queue, a declared
       broadcast group?

  Needs the namespace wrapper:

      scripts/verify/lan_test.sh test/dojo/cluster/transport_invariants_test.exs
  """

  use ExUnit.Case, async: false

  alias Dojo.Test.Lan

  @moduletag :lan
  @moduletag timeout: 600_000
  @nodes 3

  setup_all do
    unless Lan.available?() do
      raise "not inside the LAN namespace — run scripts/verify/lan_test.sh"
    end

    Lan.start(@nodes)
    on_exit(&Lan.stop/0)

    assert Lan.await_mesh(@nodes), "nodes never formed a mesh:\n#{Lan.describe()}"
    :ok
  end

  setup do
    assert Lan.baseline!(@nodes), "LAN did not return to baseline:\n#{Lan.describe()}"
    :ok
  end

  test "after a roam a peer holds exactly one spec for the node, at the new address" do
    old_ip = ip_of(3)
    new_ip = other_ip(3)

    :ok = Lan.roam(3, "#{fmt_ip(new_ip)}/24")

    assert await(fn ->
             for observer <- [1, 2] do
               held = specs_for(observer, name_of(3))
               length(held) == 1 and addrs_of(held) == [new_ip]
             end
             |> Enum.all?()
           end),
           "peers never settled on one spec at #{fmt_ip(new_ip)}\n#{describe_specs([1, 2], 3)}"

    # And the node itself agrees about where it is.
    assert [new_ip] = Lan.status(3).listen_addrs
    refute old_ip == new_ip
  end

  test "a crash removes the spec from views and from membership" do
    # Read the name before the crash: afterwards there is no status file.
    victim = name_of(3)
    assert [_] = specs_for(1, victim)

    Lan.crash_node(3)

    assert await(fn ->
             Enum.all?([1, 2], fn observer ->
               specs_for(observer, victim) == [] and not in_membership?(observer, victim)
             end)
           end),
           "the dead node lingered in a view or in membership\n#{describe_specs([1, 2], 3)}"
  end

  test "the plane survives losing a node and re-forming with it" do
    # The manager, the endpoint and the cluster supervisor must be the same pids
    # after churn: if they are not, something restarted the plane.
    before = anchors(1)
    victim = name_of(3)

    Lan.crash_node(3)
    assert await(fn -> specs_for(1, victim) == [] end)
    :ok = Lan.start_node(3)
    assert Lan.await_mesh(@nodes, timeout: 120_000), Lan.describe()

    assert anchors(1) == before,
           "node1's supervision anchors changed across churn: #{inspect(anchors(1))} vs #{inspect(before)}"
  end

  test "effective config keeps directed messages undroppable and queues bounded" do
    channels = 1 |> Lan.call(Application, :get_env, [:partisan, :channels]) |> unwrap()

    assert %{control: %{monotonic: false}} = channels,
           "control channel is monotonic: directed messages could be dropped silently"

    # The data channel carries best-effort pubsub and may drop; that is its job.
    assert %{data: %{monotonic: true}} = channels

    assert (1 |> Lan.call(:partisan_config, :get, [:connection_high_watermark]) |> unwrap()) ==
             5_000,
           "connection queue is unbounded: a fast sender can exhaust memory"

    # A broadcast handler with no group is a silent drop: `broadcast/2' casts into
    # an unstarted name and returns ok.
    group =
      1
      |> Lan.call(:partisan_plumtree_broadcast, :group_name, [Phoenix.PubSub.Partisan.Handler])
      |> unwrap()

    assert is_pid(1 |> Lan.call(Process, :whereis, [group]) |> unwrap()),
           "no broadcast group for the PubSub handler (#{inspect(group)})"

    assert (1 |> Lan.call(:partisan_config, :get, [:connect_timeout]) |> unwrap()) == 5_000,
           "connect_timeout is not the value this cluster advertises"
  end

  # ── observation helpers ──────────────────────────────────────────────────

  # The manager is a single process and the nodes are busy with mDNS and
  # discovery during these tests; the harness's default 10 s call budget is too
  # tight to distinguish "no spec" from "did not answer".
  defp specs(i) do
    i
    |> Lan.call(:partisan_peer_service, :members_for_orchestration, [], 30_000)
    |> unwrap()
    |> case do
      specs when is_list(specs) -> specs
      _ -> []
    end
  end

  defp unwrap({:ok, value}), do: value
  defp unwrap(value), do: value

  defp specs_for(i, name), do: Enum.filter(specs(i), &(&1.name == name))

  defp addrs_of(specs) do
    specs
    |> Enum.flat_map(& &1.listen_addrs)
    |> Enum.map(& &1.ip)
    |> Enum.uniq()
  end

  defp in_membership?(i, name) do
    case i |> Lan.call(:partisan_membership, :members, [], 30_000) |> unwrap() do
      specs when is_list(specs) -> Enum.any?(specs, &(&1.name == name))
      _ -> false
    end
  end

  defp name_of(i), do: Lan.status(i).name

  defp ip_of(i), do: hd(Lan.status(i).ips)

  defp fmt_ip({a, b, c, d}), do: "#{a}.#{b}.#{c}.#{d}"

  defp other_ip(i) do
    # A distinct address on the same /24: the node roams, the subnet does not.
    {a, b, c, _} = ip_of(i)
    {a, b, c, 100 + i}
  end

  defp anchors(i) do
    i |> Lan.status() |> Map.fetch!(:anchors) |> Map.take([:app, :endpoint, :cluster])
  end

  defp describe_specs(observers, node_index) do
    name = name_of(node_index)

    Enum.map_join(observers, "\n", fn i ->
      "  node#{i} holds #{inspect(Enum.map(specs_for(i, name), & &1.listen_addrs))} for #{inspect(name)}"
    end)
  end

  defp await(fun, timeout \\ 60_000, interval \\ 500) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_await(fun, deadline, interval)
  end

  defp do_await(fun, deadline, interval) do
    cond do
      fun.() -> true
      System.monotonic_time(:millisecond) >= deadline -> false
      true -> Process.sleep(interval) && do_await(fun, deadline, interval)
    end
  end
end
