defmodule Dojo.Cluster.LanTest do
  @moduledoc """
  Multi-node Partisan discovery across real IP address changes.

  Real nodes, real mDNS multicast, real `ip addr` changes — no mocks. Needs the
  namespace wrapper, which is also the only way to get root without sudo:

      scripts/verify/lan_test.sh

  Without it every test here skips rather than lying about having run.
  """
  use ExUnit.Case, async: false

  alias Dojo.Test.Lan

  @moduletag :lan
  # Booting three nodes and letting a mesh settle outlives ExUnit's 60s default
  # several times over.
  @moduletag timeout: 600_000
  # Three nodes: two can hide a broken fan-out that three will expose.
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

  # The LAN is shared mutable state and these tests move it. Each one starts
  # from the same addresses and an intact bridge, whatever the previous test
  # left behind and whatever order ExUnit chose.
  setup do
    assert Lan.baseline!(@nodes), "LAN did not return to baseline:\n#{Lan.describe()}"
    :ok
  end

  describe "formation" do
    test "every node reaches every other node" do
      assert Lan.await_mesh(@nodes), Lan.describe()
    end

    test "each node advertises only addresses it actually holds" do
      for n <- Lan.statuses() do
        assert MapSet.subset?(MapSet.new(n.listen_addrs), MapSet.new(n.ips)),
               "node#{n.idx} advertises #{inspect(n.listen_addrs)} but holds #{inspect(n.ips)}"
      end
    end

    test "a node can be called into and answers about itself" do
      assert {:ok, ips} = Lan.call(1, Dojo.Cluster.MDNS, :routable_ipv4_addrs, [])
      assert ips == Lan.status(1).ips
    end
  end

  describe "application traffic" do
    test "PubSub carries a message between two live nodes" do
      topic = "lan:probe:#{System.unique_integer([:positive])}"
      token = make_ref()

      assert {:ok, :ok} = Lan.call(2, LanNode, :subscribe, [topic])
      assert {:ok, :ok} = Lan.call(1, LanNode, :broadcast, [topic, token])
      assert {:ok, {:ok, sender}} = Lan.call(2, LanNode, :await_broadcast, [topic, token])
      assert sender == Lan.status(1).name
    end
  end

  describe "roaming" do
    test "one node changes address and the mesh reforms" do
      Lan.roam(2, "10.99.0.102/24")

      assert Lan.await_mesh(@nodes),
             "mesh did not reform after node2 roamed:\n#{Lan.describe()}"

      assert {10, 99, 0, 102} in Lan.status(2).ips
    end

    test "the whole subnet hops and identity survives it" do
      before = Enum.map(Lan.statuses(), & &1.name) |> Enum.sort()

      for i <- 1..@nodes, do: Lan.roam(i, "10.77.0.#{i}/24")

      assert Lan.await_mesh(@nodes, timeout: 120_000),
             "mesh did not survive a full subnet hop:\n#{Lan.describe()}"

      # Partisan identity is a UUID chosen at boot, precisely so it outlives
      # the address. If a name changed, roaming re-minted a node.
      assert Enum.sort(Enum.map(Lan.statuses(), & &1.name)) == before
    end
  end

  # Ported from multinode_test.exs, which runs these against DistAdapter — a
  # path only test config selects. Here they run against PartisanAdapter, the
  # one dev and prod actually use, on nodes that hold their own addresses.
  #
  # One test from that suite does NOT port: "nodedown triggers immediate cache
  # eviction". It rides `Node.monitor/2`, gated on `supports_node_monitor?`,
  # which DistAdapter answers true and PartisanAdapter answers false. It is
  # covering a capability the shipping adapter declines to have.

  describe "failover: crash without goodbye" do
    test "a crashed node is POOF-evicted from its peers' caches" do
      gone = Lan.status(3).name
      Lan.crash_node(3)

      # No goodbye was sent, so eviction can only come from absence:
      # @poof_min_missed (4) missed polls at 5s, inside @peer_ttl of 30s.
      assert Lan.await_evicted(1, gone, 60_000),
             "node1 still caches a crashed peer: #{inspect(Lan.mdns_peers(1))}"

      assert Lan.await_evicted(2, gone, 60_000),
             "node2 still caches a crashed peer: #{inspect(Lan.mdns_peers(2))}"
    end

    test "surviving nodes keep their mesh after a peer crashes" do
      Lan.crash_node(3)

      assert Lan.await_mesh(2),
             "the survivors lost each other when a third node died:\n#{Lan.describe()}"
    end
  end

  describe "departure: goodbye" do
    test "an explicit goodbye evicts peers promptly, ahead of POOF" do
      leaving = Lan.status(3).name

      # The shipping departure path. Dojo.Application.prep_stop/1 calls exactly
      # this before the tree comes down; goodbye/1 opens its own ephemeral
      # socket, so it works with the GenServer already stopped.
      assert {:ok, :ok} = Lan.stop_mdns(3)
      assert {:ok, _} = Lan.call(3, Dojo.Cluster.MDNS, :goodbye, [])

      # Well inside POOF (4 missed polls at 5s) — that gap is the whole point
      # of sending a goodbye at all.
      assert Lan.await_evicted(1, leaving, 20_000),
             "a goodbye did not evict promptly: #{inspect(Lan.mdns_peers(1))}"

      assert Lan.await_evicted(2, leaving, 20_000),
             "a goodbye did not evict promptly: #{inspect(Lan.mdns_peers(2))}"
    end

    test "stopping mDNS through its supervisor evicts only by POOF" do
      leaving = Lan.status(3).name
      assert {:ok, :ok} = Lan.stop_mdns(3)

      # Pins a real gap rather than hiding it. Dojo.Cluster.MDNS.terminate/2
      # sends a TTL=0 goodbye, but the process does not trap exits, so a
      # supervisor shutdown kills it outright and terminate/2 never runs.
      # Peers therefore wait out POOF. Prod only sends goodbyes because
      # prep_stop/1 calls goodbye/1 explicitly.
      #
      # If someone makes terminate/2 reachable, this test should start failing
      # at the shorter window — that is the signal to promote it.
      refute Lan.await_evicted(1, leaving, 10_000),
             "terminate/2 now appears to send a goodbye — tighten this test"

      assert Lan.await_evicted(1, leaving, 60_000),
             "peer was never evicted at all: #{inspect(Lan.mdns_peers(1))}"
    end
  end

  describe "recovery: re-entry" do
    test "an mDNS restart puts the node back in its peers' caches" do
      name = Lan.status(3).name
      assert {:ok, :ok} = Lan.stop_mdns(3)
      assert {:ok, _} = Lan.call(3, Dojo.Cluster.MDNS, :goodbye, [])
      assert Lan.await_evicted(1, name, 20_000)

      assert {:ok, {:ok, _pid}} = Lan.start_mdns(3)

      # Identity is unchanged: the BEAM never died, only the announcer stopped.
      assert Lan.await_discovered(1, name), "node1 never re-learned #{name}"
      assert Lan.await_discovered(2, name), "node2 never re-learned #{name}"
    end

    test "a crashed node rejoins the mesh, under a new identity" do
      before = Lan.status(3).name
      Lan.crash_node(3)
      assert Lan.await_evicted(1, before, 60_000)

      Lan.start_node(3)
      assert Lan.await_mesh(@nodes), "the cluster did not reform:\n#{Lan.describe()}"

      # In dev the name is `admin@<uuid>`, minted per boot (config/runtime.exs).
      # Roaming preserves identity because the process lives; a restart cannot.
      # The old ERTS-named suite could assume otherwise — here it is not true.
      refute Lan.status(3).name == before,
             "a restarted node kept its old identity — check PARTISAN_NAME"
    end
  end

  describe "partition" do
    # The negative control. If this fails, every assertion above is vacuous —
    # membership alone would call a severed cluster converged.
    test "a severed node is not reported as reachable" do
      Lan.partition(3)

      assert Lan.refute_mesh(@nodes),
             "a partitioned node still read as meshed — the liveness check is vacuous:\n" <>
               Lan.describe()

      Lan.heal(3)
      assert Lan.await_mesh(@nodes), "mesh did not recover after healing:\n#{Lan.describe()}"
    end
  end
end
