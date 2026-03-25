defmodule Dojo.Cluster.MultinodeTest do
  @moduledoc """
  Multi-node mDNS discovery tests using ERTS distribution.

  Spawns real BEAM peer nodes (OTP 25+ :peer module), each running
  only the mDNS GenServer with DistAdapter. No Partisan, no Phoenix —
  pure ERTS distribution + multicast UDP discovery.

  Organized by cluster lifecycle phase:

    formation   → peer discovery via mDNS
    steady      → cache maintenance across poll cycles
    sync        → cross-node communication (RPC, messages)
    failover    → peer crash without goodbye (POOF eviction)
    departure   → goodbye cache eviction (ephemeral socket)
    recovery    → re-entry after crash
    identity    → adapter announcements
    consistency → cache structure invariants
    termination → graceful supervisor shutdown (terminate/2 goodbye)

  Run with: mix test --only clustered
  """
  use Dojo.Test.ClusterCase, async: false

  alias Dojo.Test.Cluster

  @sup_name Dojo.Test.MDNSSupervisor

  setup_all do
    peers = Cluster.spawn_peers([:peer1, :peer2, :peer3], poll_interval: 1_000)

    [{n1, p1}, {n2, p2}, {n3, p3}] = peers

    # Wait for full mesh before any tests run
    assert_eventually(fn ->
      l1 = remote_node_list(p1)
      l2 = remote_node_list(p2)
      l3 = remote_node_list(p3)

      n2 in l1 and n3 in l1 and
        n1 in l2 and n3 in l2 and
        n1 in l3 and n2 in l3
    end)

    on_exit(fn -> Cluster.stop(peers) end)

    %{
      peers: peers,
      p1: p1,
      p2: p2,
      p3: p3,
      n1: n1,
      n2: n2,
      n3: n3
    }
  end

  # Ensure peer3's mDNS is running before each test (tests may kill/stop it).
  setup %{p1: p1, p3: p3, n3: n3} do
    ensure_mdns_running(p3)
    assert_discovered(p1, n3)
    :ok
  end

  # ── Formation: peer discovery via mDNS ──────────────────────────────────

  describe "formation: peer discovery via mDNS" do
    test "two peers discover each other", %{p1: p1, p2: p2, n2: n2, n1: n1} do
      assert n2 in remote_node_list(p1)
      assert n1 in remote_node_list(p2)
    end

    test "three peers form a full mesh", %{p1: p1, p2: p2, p3: p3, n1: n1, n2: n2, n3: n3} do
      l1 = remote_node_list(p1)
      l2 = remote_node_list(p2)
      l3 = remote_node_list(p3)

      assert n2 in l1 and n3 in l1
      assert n1 in l2 and n3 in l2
      assert n1 in l3 and n2 in l3
    end
  end

  # ── Steady state: cache maintenance ────────────────────────────────────

  describe "steady state: cache maintenance" do
    test "repeated poll cycles do not duplicate cache entries", %{p1: p1} do
      count1 = length(remote_cached_peers(p1))

      # Wait 3 poll cycles (poll_interval=1s)
      Process.sleep(3_500)

      count2 = length(remote_cached_peers(p1))
      assert count2 == count1
    end

    test "cache entries refresh seen_at each cycle", %{p1: p1, n2: n2} do
      cache1 = get_remote_cache(p1)
      entry1 = Map.get(cache1, n2)
      assert entry1 != nil

      Process.sleep(2_000)

      cache2 = get_remote_cache(p1)
      entry2 = Map.get(cache2, n2)
      assert entry2 != nil
      assert entry2.seen_at >= entry1.seen_at
    end
  end

  # ── Sync: cross-node communication ─────────────────────────────────────

  describe "sync: cross-node communication" do
    test "rpc between discovered peers works", %{p1: p1, n2: n2} do
      assert n2 in remote_node_list(p1)

      result =
        :peer.call(p1, :rpc, :block_call, [n2, :erlang, :node, []])

      assert result == n2
    end

    test "message passing between discovered peers", %{p1: p1, p2: p2, n1: n1, n2: n2} do
      assert n2 in remote_node_list(p1) and n1 in remote_node_list(p2)

      receiver =
        :peer.call(p2, :erlang, :spawn, [:timer, :sleep, [600_000]])

      :peer.call(p1, :erlang, :send, [receiver, {:hello, :from_peer1}])

      Process.sleep(200)

      {:messages, msgs} = :peer.call(p2, Process, :info, [receiver, :messages])
      assert Enum.any?(msgs, &match?({:hello, :from_peer1}, &1))
    end
  end

  # ── Failover: peer crash without goodbye ───────────────────────────────

  describe "failover: peer crash without goodbye" do
    test "killed peer is evicted via POOF within poll cycles", %{p1: p1, p3: p3, n3: n3} do
      assert_discovered(p1, n3)

      Cluster.kill_mdns(p3)

      # POOF evicts after @poof_min_missed (2) unanswered query cycles
      assert_evicted(p1, n3)
    end

    test "surviving peers maintain mesh after peer crash", %{
      p1: p1,
      p2: p2,
      p3: p3,
      n1: n1,
      n2: n2
    } do
      Cluster.kill_mdns(p3)
      Process.sleep(500)

      assert n2 in remote_node_list(p1)
      assert n1 in remote_node_list(p2)
    end

    test "nodedown triggers immediate cache eviction", %{p1: p1, p3: p3, n3: n3} do
      assert_discovered(p1, n3)

      # Disconnect ERTS connection — triggers Node.monitor's {:nodedown, n3}
      # on p1, which should evict n3 from cache immediately (no POOF wait)
      :peer.call(p1, Node, :disconnect, [n3])

      # Also stop mDNS so p3 doesn't re-announce and re-enter cache
      Cluster.kill_mdns(p3)

      # Should be near-immediate (nodedown handler), not POOF-delayed
      assert_evicted(p1, n3, 5_000)
    end
  end

  # ── Departure: goodbye cache eviction (ephemeral socket) ───────────────

  describe "departure: goodbye cache eviction" do
    test "goodbye from peer3 evicts it from peer1's cache", %{p1: p1, p3: p3, n3: n3} do
      assert_discovered(p1, n3)

      # Get peer3's routable IPs before killing
      ips = :peer.call(p3, Dojo.Cluster.MDNS, :routable_ipv4_addrs, [])

      # Kill mDNS + supervisor (no goodbye, no restart)
      Cluster.kill_mdns(p3)

      # Send ephemeral goodbye (the prep_stop / goodbye path)
      :peer.call(p3, Dojo.Cluster.MDNS, :goodbye, [ips])

      assert_evicted(p1, n3)
    end

    test "departed peer is disconnected from Node.list", %{p1: p1, p3: p3, n3: n3} do
      assert_discovered(p1, n3)

      ips = :peer.call(p3, Dojo.Cluster.MDNS, :routable_ipv4_addrs, [])
      Cluster.kill_mdns(p3)
      :peer.call(p3, Dojo.Cluster.MDNS, :goodbye, [ips])

      # After goodbye → on_peer_departed → Node.disconnect
      assert_eventually(fn ->
        n3 not in remote_node_list(p1)
      end)
    end
  end

  # ── Recovery: re-entry after crash ─────────────────────────────────────

  describe "recovery: re-entry after crash" do
    test "crashed and restarted peer re-enters all caches", %{
      p1: p1,
      p2: p2,
      p3: p3,
      n3: n3
    } do
      Cluster.kill_mdns(p3)
      assert_evicted(p1, n3)

      Cluster.restart_mdns(p3, poll_interval: 1_000)

      assert_discovered(p1, n3)
      assert_discovered(p2, n3)
    end

    test "re-entered peer has bidirectional connectivity", %{p1: p1, p3: p3, n1: n1, n3: n3} do
      Cluster.kill_mdns(p3)
      assert_evicted(p1, n3)

      Cluster.restart_mdns(p3, poll_interval: 1_000)
      assert_discovered(p1, n3)

      assert_eventually(fn ->
        n3 in remote_node_list(p1) and n1 in remote_node_list(p3)
      end)

      result1 = :peer.call(p1, :rpc, :block_call, [n3, :erlang, :node, []])
      assert result1 == n3

      result2 = :peer.call(p3, :rpc, :block_call, [n1, :erlang, :node, []])
      assert result2 == n1
    end
  end

  # ── Identity: adapter announcements ────────────────────────────────────

  describe "identity: adapter announcements" do
    test "each peer announces its own node() name", %{p1: p1, n2: n2, n3: n3} do
      names = remote_cached_peers(p1) |> Enum.map(fn {name, _, _} -> name end)
      assert n2 in names or n3 in names
    end
  end

  # ── Consistency: cache state ───────────────────────────────────────────

  describe "consistency: cache state" do
    test "each node's cache contains the other peers", %{p1: p1, n2: n2, n3: n3} do
      assert_eventually(fn ->
        length(remote_cached_peers(p1)) >= 2
      end)

      names = remote_cached_peers(p1) |> Enum.map(fn {name, _, _} -> name end)
      assert n2 in names
      assert n3 in names
    end

    test "cached peer entries have correct structure", %{p2: p2} do
      assert_eventually(fn ->
        length(remote_cached_peers(p2)) >= 1
      end)

      peers = remote_cached_peers(p2)

      Enum.each(peers, fn {name, ip, port} ->
        assert is_atom(name)
        assert tuple_size(ip) == 4
        assert is_integer(port)
      end)
    end
  end

  # ── Termination: graceful supervisor shutdown ──────────────────────────

  describe "termination: graceful shutdown" do
    test "supervisor stop sends goodbye via terminate/2", %{p1: p1, p3: p3, n3: n3} do
      assert_discovered(p1, n3)

      # Stop the supervisor — this terminates children (calling terminate/2),
      # which sends TTL=0 goodbye on the owned socket, then closes it.
      sup_name = @sup_name
      :peer.call(p3, Supervisor, :stop, [sup_name])

      assert_evicted(p1, n3)
    end

    test "stopped peer is removed from all peer caches", %{p1: p1, p2: p2, p3: p3, n3: n3} do
      assert_discovered(p1, n3)
      assert_discovered(p2, n3)

      sup_name = @sup_name
      :peer.call(p3, Supervisor, :stop, [sup_name])

      assert_evicted(p1, n3)
      assert_evicted(p2, n3)
    end
  end

  # ── Helpers ────────────────────────────────────────────────────────────

  defp get_remote_cache(peer) do
    :peer.call(peer, :sys, :get_state, [Dojo.Cluster.MDNS]).cache
  end

  defp ensure_mdns_running(peer) do
    case :peer.call(peer, Process, :whereis, [Dojo.Cluster.MDNS]) do
      pid when is_pid(pid) -> :ok
      nil -> Cluster.restart_mdns(peer, poll_interval: 1_000)
    end
  end
end
