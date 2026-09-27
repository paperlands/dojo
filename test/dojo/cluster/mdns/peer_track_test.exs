defmodule Dojo.Cluster.MDNS.PeerTrackTest do
  use ExUnit.Case, async: true

  alias Dojo.Cluster.MDNS.PeerTrack

  @config %{grace_s: 15, max_failures: 3, cooldown_s: 30}

  # ── observe/4: nil track (unknown peer) ──────────────────────────────

  describe "observe/4 — nil track (unknown peer)" do
    test "creates active track regardless of connected?" do
      t = PeerTrack.observe(nil, false, :new_peer, @config)
      assert %PeerTrack{name: :new_peer, status: :active, failures: 0} = t

      t2 = PeerTrack.observe(nil, true, :new_peer, @config)
      assert %PeerTrack{name: :new_peer, status: :active, failures: 0} = t2
    end
  end

  # ── observe/4: active + connected ────────────────────────────────────

  describe "observe/4 — active + connected" do
    test "clean track (0 failures) is unchanged" do
      t = PeerTrack.new(:peer_a)
      result = PeerTrack.observe(t, true, :peer_a, @config)
      assert result.status == :active
      assert result.failures == 0
      assert result.since == t.since
    end

    test "track with prior failures is reset to 0" do
      t = %PeerTrack{name: :peer_a, status: :active, since: now(), failures: 2}
      result = PeerTrack.observe(t, true, :peer_a, @config)
      assert result.status == :active
      assert result.failures == 0
    end
  end

  # ── observe/4: active + disconnected ─────────────────────────────────

  describe "observe/4 — active + disconnected" do
    test "in grace period: unchanged" do
      t = %PeerTrack{name: :peer_a, status: :active, since: now(), failures: 0}
      result = PeerTrack.observe(t, false, :peer_a, @config)
      assert result.status == :active
      assert result.failures == 0
    end

    test "past grace, below max: increments failures" do
      t = %PeerTrack{name: :peer_a, status: :active, since: now() - 20, failures: 1}
      result = PeerTrack.observe(t, false, :peer_a, @config)
      assert result.status == :active
      assert result.failures == 2
    end

    test "past grace, reaching max: evicts" do
      t = %PeerTrack{name: :peer_a, status: :active, since: now() - 20, failures: 2}
      result = PeerTrack.observe(t, false, :peer_a, @config)
      assert result.status == :evicted
      assert result.failures == 0
    end

    test "past grace, already beyond max: evicts" do
      t = %PeerTrack{name: :peer_a, status: :active, since: now() - 20, failures: 5}
      result = PeerTrack.observe(t, false, :peer_a, @config)
      assert result.status == :evicted
    end

    test "exactly at grace boundary (since == grace_s ago): fails" do
      t = %PeerTrack{name: :peer_a, status: :active, since: now() - 15, failures: 0}
      result = PeerTrack.observe(t, false, :peer_a, @config)
      assert result.failures == 1
    end
  end

  # ── observe/4: evicted ───────────────────────────────────────────────

  describe "observe/4 — evicted" do
    test "cooling down: unchanged, ignores connected?" do
      t = %PeerTrack{name: :peer_a, status: :evicted, since: now()}
      result_f = PeerTrack.observe(t, false, :peer_a, @config)
      result_t = PeerTrack.observe(t, true, :peer_a, @config)
      assert result_f.status == :evicted
      assert result_t.status == :evicted
      assert result_f == result_t
    end

    test "cooldown elapsed: returns nil (delete from tracking)" do
      t = %PeerTrack{name: :peer_a, status: :evicted, since: now() - 31}
      assert PeerTrack.observe(t, false, :peer_a, @config) == nil
      assert PeerTrack.observe(t, true, :peer_a, @config) == nil
    end

    test "exactly at cooldown boundary: returns nil" do
      t = %PeerTrack{name: :peer_a, status: :evicted, since: now() - 30}
      assert PeerTrack.observe(t, false, :peer_a, @config) == nil
    end
  end

  # ── observe/4: config sensitivity ────────────────────────────────────

  describe "observe/4 — config sensitivity" do
    test "respects custom grace_s" do
      long_grace = %{@config | grace_s: 60}
      t = %PeerTrack{name: :peer_a, status: :active, since: now() - 30, failures: 0}

      # With default config (15s grace), 30s would be past grace
      result_default = PeerTrack.observe(t, false, :peer_a, @config)
      assert result_default.failures == 1

      # With 60s grace, 30s is still in grace
      result_long = PeerTrack.observe(t, false, :peer_a, long_grace)
      assert result_long.failures == 0
    end

    test "respects custom max_failures" do
      strict = %{@config | max_failures: 1}
      t = %PeerTrack{name: :peer_a, status: :active, since: now() - 20, failures: 0}

      # With max_failures: 1, first failure evicts
      result = PeerTrack.observe(t, false, :peer_a, strict)
      assert result.status == :evicted
    end

    test "respects custom cooldown_s" do
      short_cooldown = %{@config | cooldown_s: 5}
      t = %PeerTrack{name: :peer_a, status: :evicted, since: now() - 10}

      # Default 30s cooldown: still cooling
      result_default = PeerTrack.observe(t, false, :peer_a, @config)
      assert result_default.status == :evicted

      # 5s cooldown: elapsed
      result_short = PeerTrack.observe(t, false, :peer_a, short_cooldown)
      assert result_short == nil
    end
  end

  defp now, do: System.monotonic_time(:second)
end
