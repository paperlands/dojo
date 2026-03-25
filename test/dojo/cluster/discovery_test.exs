defmodule Dojo.Cluster.MDNS.DiscoveryTest do
  @moduledoc """
  Integrated tests for the mDNS discovery lifecycle.

  Validates the primitives that underpin peer management:
  - Wire format correctness (announcement, goodbye, query packets)
  - Cache eviction under time pressure (the only defense against crashed peers)
  - Actual packet delivery on loopback multicast

  Inspired by Phoenix.PubSub.DistributedTest — where they spy on PubSub
  subscriptions across real Erlang nodes, we spy on mDNS multicast traffic
  via a listener socket on the loopback interface.
  """
  use ExUnit.Case, async: false

  alias Dojo.Cluster.MDNS
  alias Dojo.Cluster.MDNS.Packet

  @mdns_addr {224, 0, 0, 251}
  @mdns_port 5454
  @service "_erlang._tcp.local"
  @loopback {127, 0, 0, 1}

  # The cache TTL — must match Discovery's @peer_ttl.
  # If this breaks, someone changed the TTL and needs to update these tests.
  @peer_ttl 30

  # ── Wire Format ───────────────────────────────────────────────────────────
  # Verify the binary codec without any network I/O.
  # These are the primitives that goodbye/reannounce/announce build on.
  # A malformed packet here means silent peer discovery failure on the wire.

  describe "announcement wire format" do
    setup do
      pkt = Packet.announcement(@service, "admin@550e-8400", @loopback, 120, 9090)
      {:ok, records} = Packet.decode(pkt)
      %{pkt: pkt, records: records}
    end

    test "emits exactly 4 resource records", %{records: records} do
      types = MapSet.new(records, & &1.type)
      # PTR(12) + SRV(33) + TXT(16) + A(1)
      assert MapSet.equal?(types, MapSet.new([1, 12, 16, 33]))
      assert length(records) == 4
    end

    test "PTR record: service FQDN → instance FQDN", %{records: records} do
      ptr = Enum.find(records, &(&1.type == 12))
      assert ptr.name == @service
      {:ptr, instance} = ptr.data
      assert String.ends_with?(instance, ".#{@service}")
      # Instance label is derived from node name with @ and - normalized
      assert String.starts_with?(instance, "admin-550e-8400")
    end

    test "TXT record carries erlang_node and port", %{records: records} do
      txt = Enum.find(records, &(&1.type == 16))
      {:txt, kv} = txt.data
      assert List.keyfind(kv, "erlang_node", 0) == {"erlang_node", "admin@550e-8400"}
      assert List.keyfind(kv, "port", 0) == {"port", "9090"}
    end

    test "SRV record carries correct port and target", %{records: records} do
      srv = Enum.find(records, &(&1.type == 33))
      {:srv, %{port: port, target: target}} = srv.data
      assert port == 9090
      assert String.ends_with?(target, ".local")
    end

    test "A record carries the announced IP", %{records: records} do
      a = Enum.find(records, &(&1.type == 1))
      assert a.data == {:a, @loopback}
    end

    test "all records have TTL=120", %{records: records} do
      Enum.each(records, fn rr ->
        assert rr.ttl == 120
      end)
    end

    test "decoder strips cache-flush bit — all records show class=IN", %{records: records} do
      # PTR uses CLASS_IN (0x0001), SRV/TXT/A use CLASS_FLUSH (0x8001).
      # The decoder ANDs with 0x7FFF, so all come through as 1.
      Enum.each(records, fn rr ->
        assert rr.class == 1
      end)
    end

    test "cache-flush bit is present in raw wire format for unique records" do
      pkt = Packet.announcement(@service, "admin@node1", @loopback, 120, 9090)

      # Parse raw to find class fields before the decoder strips them.
      # Header is 12 bytes, then we have 4 RRs in the answer section.
      <<_header::binary-size(12), rest::binary>> = pkt

      classes = extract_raw_classes(pkt, rest, 4)

      # PTR should have class=0x0001 (no flush), others should have 0x8001 (flush)
      [ptr_class | unique_classes] = classes
      assert ptr_class == 0x0001, "PTR should NOT have cache-flush bit"

      Enum.each(unique_classes, fn class ->
        assert class == 0x8001,
               "Unique record should have cache-flush bit, got 0x#{Integer.to_string(class, 16)}"
      end)
    end
  end

  describe "goodbye wire format" do
    test "all records have TTL=0" do
      pkt = Packet.announcement(@service, "admin@goodbye-test", @loopback, 0, 9090)
      {:ok, records} = Packet.decode(pkt)

      Enum.each(records, fn rr ->
        assert rr.ttl == 0, "goodbye record type=#{rr.type} has TTL=#{rr.ttl}"
      end)
    end

    test "goodbye and announcement differ ONLY in TTL" do
      normal = Packet.announcement(@service, "admin@diff-test", @loopback, 120, 9090)
      bye = Packet.announcement(@service, "admin@diff-test", @loopback, 0, 9090)

      {:ok, normal_rrs} = Packet.decode(normal)
      {:ok, bye_rrs} = Packet.decode(bye)

      assert length(normal_rrs) == length(bye_rrs)

      Enum.zip(normal_rrs, bye_rrs)
      |> Enum.each(fn {n, b} ->
        assert n.name == b.name
        assert n.type == b.type
        assert n.class == b.class
        assert n.data == b.data
        assert n.ttl == 120
        assert b.ttl == 0
      end)
    end
  end

  describe "query wire format" do
    test "has QR=0 and QDCOUNT=1" do
      pkt = Packet.query(@service)

      <<_id::16, qr::1, _opcode::4, _aa::1, _tc::1, _rd::1, _ra::1, _z::3, _rcode::4, qdcount::16,
        ancount::16, _nscount::16, _arcount::16, _rest::binary>> = pkt

      assert qr == 0, "query must have QR=0"
      assert qdcount == 1
      assert ancount == 0
    end

    test "encodes the service FQDN as the question name" do
      pkt = Packet.query(@service)
      # After the 12-byte header, the question section starts.
      # The name is length-prefixed labels terminated by 0.
      <<_header::binary-size(12), rest::binary>> = pkt
      {name, _rest} = Packet.read_name(pkt, rest)
      assert name == @service
    end
  end

  # ── Cache Lifecycle ───────────────────────────────────────────────────────
  # The cache is the local node's view of the cluster. When a peer crashes
  # without sending goodbye packets, TTL-based eviction is the ONLY mechanism
  # that prevents stale peers from lingering in the active/passive views.

  describe "cache eviction" do
    test "fresh entry survives sweep" do
      cache = peer_cache(:alive, now())
      swept = MDNS.sweep_cache(cache)
      assert Map.has_key?(swept, :alive)
    end

    test "entry at TTL-1 (29s old) survives" do
      cache = peer_cache(:borderline, now() - (@peer_ttl - 1))
      assert Map.has_key?(MDNS.sweep_cache(cache), :borderline)
    end

    test "entry at TTL (30s old) is evicted" do
      cache = peer_cache(:expired, now() - @peer_ttl)
      assert MDNS.sweep_cache(cache) == %{}
    end

    test "entry well beyond TTL (120s old) is evicted" do
      cache = peer_cache(:ancient, now() - 120)
      assert MDNS.sweep_cache(cache) == %{}
    end

    test "empty cache sweeps to empty" do
      assert MDNS.sweep_cache(%{}) == %{}
    end

    test "mixed cache: only stale entries removed" do
      cache =
        peer_cache(:fresh, now())
        |> Map.merge(peer_cache(:recent, now() - 15))
        |> Map.merge(peer_cache(:stale, now() - 31))
        |> Map.merge(peer_cache(:ancient, now() - 120))

      swept = MDNS.sweep_cache(cache)
      assert Map.has_key?(swept, :fresh)
      assert Map.has_key?(swept, :recent)
      refute Map.has_key?(swept, :stale)
      refute Map.has_key?(swept, :ancient)
      assert map_size(swept) == 2
    end
  end

  describe "crash recovery via cache expiration" do
    test "crashed peer (no goodbye) is evicted after TTL" do
      # Peer B crashes — SIGKILL, OOM, battery death — no goodbye sent.
      # Peer A's cache retains B's entry until @peer_ttl elapses without refresh.
      cache = peer_cache(:"crashed@192.168.1.50", now() - @peer_ttl, {192, 168, 1, 50})
      assert MDNS.sweep_cache(cache) == %{}
    end

    test "peer refreshed just before TTL boundary survives" do
      # Same peer, but it managed to announce 1 second before eviction.
      cache = peer_cache(:"crashed@192.168.1.50", now() - (@peer_ttl - 1), {192, 168, 1, 50})
      assert map_size(MDNS.sweep_cache(cache)) == 1
    end

    test "sudden network partition: all peers on a subnet go silent" do
      # WiFi AP dies — 3 peers on 192.168.1.x stop announcing simultaneously.
      # One peer on 10.0.0.x (hotspot) is still alive.
      partition_time = now() - @peer_ttl

      cache =
        peer_cache(:"node1@192.168.1.10", partition_time, {192, 168, 1, 10})
        |> Map.merge(peer_cache(:"node2@192.168.1.11", partition_time, {192, 168, 1, 11}))
        |> Map.merge(peer_cache(:"node3@192.168.1.12", partition_time, {192, 168, 1, 12}))
        |> Map.merge(peer_cache(:"node4@10.0.0.5", now() - 2, {10, 0, 0, 5}))

      swept = MDNS.sweep_cache(cache)
      assert map_size(swept) == 1
      assert Map.has_key?(swept, :"node4@10.0.0.5")
    end

    test "graceful departure and crash have same cache outcome" do
      # Whether a peer sends goodbye (TTL=0) or crashes without sending it,
      # the cache result is the same: the peer disappears.
      # Goodbye just makes it faster (immediate on receipt vs. waiting TTL).
      stale = peer_cache(:departed, now() - @peer_ttl)
      assert MDNS.sweep_cache(stale) == %{}
    end

    test "cache correctly handles sequential peer departures" do
      # Peers leave one by one over time. Each sweep should only remove
      # peers that have individually exceeded the TTL.
      cache =
        peer_cache(:first_to_leave, now() - 60)
        |> Map.merge(peer_cache(:second_to_leave, now() - 35))
        |> Map.merge(peer_cache(:just_left, now() - 31))
        |> Map.merge(peer_cache(:still_here, now() - 10))
        |> Map.merge(peer_cache(:just_arrived, now()))

      swept = MDNS.sweep_cache(cache)
      assert map_size(swept) == 2
      assert Map.has_key?(swept, :still_here)
      assert Map.has_key?(swept, :just_arrived)
    end
  end

  # ── Goodbye Reception (update_cache) ────────────────────────────────────
  # Verify that receiving a TTL=0 goodbye packet evicts the peer from cache,
  # while a normal TTL=120 announcement adds or refreshes it.
  # This is the receiver-side complement to the sender-side goodbye tests above.

  describe "goodbye reception via update_cache" do
    @own_name :my_own_node@localhost
    @peer_name "admin@peer-b"
    @peer_atom :"admin@peer-b"
    @peer_ip {192, 168, 1, 50}

    test "goodbye (TTL=0) evicts peer from cache" do
      bye_pkt = Packet.announcement(@service, @peer_name, @peer_ip, 0, 9090)
      {:ok, records} = Packet.decode(bye_pkt)

      # Peer is already in cache
      cache = peer_cache(@peer_atom, now(), @peer_ip)
      assert Map.has_key?(cache, @peer_atom)

      updated = MDNS.update_cache(cache, records, @own_name, @service, @peer_ip)
      refute Map.has_key?(updated, @peer_atom), "goodbye should evict peer from cache"
    end

    test "normal announcement (TTL=120) adds peer to cache" do
      ann_pkt = Packet.announcement(@service, @peer_name, @peer_ip, 120, 9090)
      {:ok, records} = Packet.decode(ann_pkt)

      updated = MDNS.update_cache(%{}, records, @own_name, @service, @peer_ip)
      assert Map.has_key?(updated, @peer_atom)
      assert updated[@peer_atom].ip == @peer_ip
      assert updated[@peer_atom].port == 9090
    end

    test "normal announcement refreshes existing peer's seen_at" do
      ann_pkt = Packet.announcement(@service, @peer_name, @peer_ip, 120, 9090)
      {:ok, records} = Packet.decode(ann_pkt)

      old_cache = peer_cache(@peer_atom, now() - 20, @peer_ip)
      updated = MDNS.update_cache(old_cache, records, @own_name, @service, @peer_ip)

      assert updated[@peer_atom].seen_at > old_cache[@peer_atom].seen_at
    end

    test "own node's announcements are ignored" do
      ann_pkt = Packet.announcement(@service, Atom.to_string(@own_name), @loopback, 120, 9090)
      {:ok, records} = Packet.decode(ann_pkt)

      updated = MDNS.update_cache(%{}, records, @own_name, @service, @loopback)
      assert updated == %{}
    end

    test "goodbye for absent peer is a no-op" do
      bye_pkt = Packet.announcement(@service, @peer_name, @peer_ip, 0, 9090)
      {:ok, records} = Packet.decode(bye_pkt)

      updated = MDNS.update_cache(%{}, records, @own_name, @service, @peer_ip)
      assert updated == %{}
    end

    test "goodbye evicts only the departing peer, not others" do
      bye_pkt = Packet.announcement(@service, @peer_name, @peer_ip, 0, 9090)
      {:ok, records} = Packet.decode(bye_pkt)

      cache =
        peer_cache(@peer_atom, now(), @peer_ip)
        |> Map.merge(peer_cache(:"admin@peer-c", now(), {192, 168, 1, 51}))

      updated = MDNS.update_cache(cache, records, @own_name, @service, @peer_ip)
      refute Map.has_key?(updated, @peer_atom)
      assert Map.has_key?(updated, :"admin@peer-c")
    end
  end

  # ── Step 2: Cache-flush bit preservation ────────────────────────────────
  # RFC 6762 §10.2 — decoded records now carry a `cache_flush` boolean
  # so receivers can distinguish unique vs shared records.

  describe "cache_flush flag in decoded records" do
    setup do
      pkt = Packet.announcement(@service, "admin@flush-test", @loopback, 120, 9090)
      {:ok, records} = Packet.decode(pkt)
      %{records: records}
    end

    test "PTR record has cache_flush: false (shared record)", %{records: records} do
      ptr = Enum.find(records, &(&1.type == 12))
      refute ptr.cache_flush, "PTR is a shared record — cache_flush must be false"
    end

    test "SRV, TXT, A records have cache_flush: true (unique records)", %{records: records} do
      unique = Enum.filter(records, &(&1.type in [1, 16, 33]))
      assert length(unique) == 3

      Enum.each(unique, fn rr ->
        assert rr.cache_flush,
               "type=#{rr.type} should have cache_flush: true, got false"
      end)
    end

    test "cache_flush flag coexists with stripped class value", %{records: records} do
      Enum.each(records, fn rr ->
        assert rr.class == 1, "class should be 1 (IN) after stripping flush bit"
        # cache_flush is derived from the raw class, independent of the stripped value
        assert is_boolean(rr.cache_flush)
      end)
    end
  end

  # ── Step 2: Known-answer suppression ────────────────────────────────────
  # RFC 6762 §7.1 — queries include cached PTR records so that responders
  # can suppress redundant replies.

  describe "known-answer suppression" do
    test "query with no known answers has ANCOUNT=0" do
      pkt = Packet.query(@service)

      <<_id::16, _flags::16, _qdcount::16, ancount::16, _rest::binary>> = pkt

      assert ancount == 0
    end

    test "query with known answers has correct ANCOUNT" do
      answers = [
        {"admin-peer-a._erlang._tcp.local", 100},
        {"admin-peer-b._erlang._tcp.local", 90}
      ]

      pkt = Packet.query(@service, answers)

      <<_id::16, _flags::16, qdcount::16, ancount::16, _rest::binary>> = pkt

      assert qdcount == 1
      assert ancount == 2
    end

    test "known-answer records are decodable PTR records" do
      answers = [{"admin-peer-x._erlang._tcp.local", 80}]
      pkt = Packet.query(@service, answers)
      {:ok, records} = Packet.decode(pkt)

      ptrs = Enum.filter(records, &(&1.type == 12))
      assert length(ptrs) == 1

      [ptr] = ptrs
      assert ptr.name == @service
      assert ptr.ttl == 80
      {:ptr, instance} = ptr.data
      assert instance == "admin-peer-x._erlang._tcp.local"
    end

    test "known-answer records preserve remaining TTL" do
      answers = [
        {"instance-a._erlang._tcp.local", 115},
        {"instance-b._erlang._tcp.local", 70}
      ]

      pkt = Packet.query(@service, answers)
      {:ok, records} = Packet.decode(pkt)

      ptrs = Enum.filter(records, &(&1.type == 12))
      ttls = Enum.map(ptrs, & &1.ttl) |> Enum.sort()
      assert ttls == [70, 115]
    end

    test "query still has QR=0 with known answers" do
      answers = [{"x._erlang._tcp.local", 60}]
      pkt = Packet.query(@service, answers)

      <<_id::16, qr::1, _rest::bitstring>> = pkt
      assert qr == 0
    end
  end

  describe "build_known_answers" do
    test "fresh cache entry (< half TTL age) is included" do
      cache = peer_cache(:"admin@fresh-peer", now() - 10)
      answers = MDNS.build_known_answers(cache, @service)
      assert length(answers) == 1

      [{instance_fqdn, remaining_ttl}] = answers
      assert String.contains?(instance_fqdn, "admin-fresh-peer")
      assert String.ends_with?(instance_fqdn, ".#{@service}")
      assert remaining_ttl > 60
    end

    test "stale cache entry (> half TTL age) is excluded" do
      # seen 70s ago → remaining = 120 - 70 = 50, which is ≤ 60 (half of 120)
      cache = peer_cache(:"admin@stale-peer", now() - 70)
      answers = MDNS.build_known_answers(cache, @service)
      assert answers == []
    end

    test "entry at exactly half TTL boundary is excluded" do
      # seen 60s ago → remaining = 60, which is NOT > 60
      cache = peer_cache(:admin@boundary, now() - 60)
      answers = MDNS.build_known_answers(cache, @service)
      assert answers == []
    end

    test "entry just inside half TTL boundary is included" do
      # seen 59s ago → remaining = 61, which IS > 60
      cache = peer_cache(:"admin@just-inside", now() - 59)
      answers = MDNS.build_known_answers(cache, @service)
      assert length(answers) == 1
    end

    test "empty cache produces no known answers" do
      assert MDNS.build_known_answers(%{}, @service) == []
    end

    test "mixed cache: only entries with remaining TTL > half are included" do
      cache =
        peer_cache(:admin@fresh, now() - 5)
        # 50s old → remaining=70 > 60 → included
        |> Map.merge(peer_cache(:admin@medium, now() - 50))
        # 100s old → remaining=20 ≤ 60 → excluded
        |> Map.merge(peer_cache(:admin@stale, now() - 100))

      answers = MDNS.build_known_answers(cache, @service)
      assert length(answers) == 2

      fqdns = Enum.map(answers, fn {fqdn, _} -> fqdn end)
      assert Enum.any?(fqdns, &String.contains?(&1, "admin-fresh"))
      assert Enum.any?(fqdns, &String.contains?(&1, "admin-medium"))
      refute Enum.any?(fqdns, &String.contains?(&1, "admin-stale"))
    end

    test "instance FQDN correctly normalizes @ and - in node name" do
      cache = peer_cache(:"admin@550e-8400-dead-beef", now())
      [{fqdn, _}] = MDNS.build_known_answers(cache, @service)
      # @ and - both become -
      assert String.starts_with?(fqdn, "admin-550e-8400-dead-beef")
      assert String.ends_with?(fqdn, ".#{@service}")
    end
  end

  # ── Step 3: POOF (Passive Observation Of Failure) ─────────────────────
  # RFC 6762 §10.5 — peers that don't respond to queries get evicted
  # faster than the hard TTL, based on consecutive missed query cycles.

  describe "POOF (apply_poof)" do
    test "peer not refreshed has missed_queries incremented" do
      seen = now() - 5

      cache = %{
        :peer_a => %{name: :peer_a, ip: @loopback, port: 9090, seen_at: seen, missed_queries: 0}
      }

      pre_seen = %{peer_a: seen}

      result = MDNS.apply_poof(cache, pre_seen)
      assert result[:peer_a].missed_queries == 1
    end

    test "peer refreshed during cycle has missed_queries reset to 0" do
      cache = %{
        :peer_a => %{name: :peer_a, ip: @loopback, port: 9090, seen_at: now(), missed_queries: 3}
      }

      # pre_seen has older value — peer was refreshed since snapshot
      pre_seen = %{peer_a: now() - 10}

      result = MDNS.apply_poof(cache, pre_seen)
      assert result[:peer_a].missed_queries == 0
    end

    test "peer with missed_queries reaching threshold is evicted" do
      seen = now() - 10
      # missed_queries is 1, will be incremented to 2 (= @poof_min_missed)
      cache = %{
        :peer_a => %{name: :peer_a, ip: @loopback, port: 9090, seen_at: seen, missed_queries: 1}
      }

      pre_seen = %{peer_a: seen}

      result = MDNS.apply_poof(cache, pre_seen)
      refute Map.has_key?(result, :peer_a), "peer should be evicted at missed_queries >= 2"
    end

    test "peer with missed_queries below threshold survives" do
      seen = now() - 5
      # missed_queries is 0, will be incremented to 1 (< 2)
      cache = %{
        :peer_a => %{name: :peer_a, ip: @loopback, port: 9090, seen_at: seen, missed_queries: 0}
      }

      pre_seen = %{peer_a: seen}

      result = MDNS.apply_poof(cache, pre_seen)
      assert Map.has_key?(result, :peer_a)
      assert result[:peer_a].missed_queries == 1
    end

    test "newly discovered peer (not in pre_seen) has missed_queries = 0" do
      cache = %{
        :new_peer => %{
          name: :new_peer,
          ip: @loopback,
          port: 9090,
          seen_at: now(),
          missed_queries: 0
        }
      }

      pre_seen = %{}

      result = MDNS.apply_poof(cache, pre_seen)
      assert result[:new_peer].missed_queries == 0
    end

    test "mixed: evicts unresponsive, keeps responsive and new peers" do
      seen_old = now() - 15

      cache = %{
        :dead => %{name: :dead, ip: @loopback, port: 9090, seen_at: seen_old, missed_queries: 1},
        :alive => %{name: :alive, ip: @loopback, port: 9090, seen_at: now(), missed_queries: 2},
        :fresh => %{name: :fresh, ip: @loopback, port: 9090, seen_at: now(), missed_queries: 0}
      }

      # :dead was not refreshed, :alive was refreshed (seen_at changed), :fresh is new
      pre_seen = %{dead: seen_old, alive: now() - 5}

      result = MDNS.apply_poof(cache, pre_seen)
      refute Map.has_key?(result, :dead), "dead peer (missed=2) should be evicted"
      assert result[:alive].missed_queries == 0, "alive peer should have missed reset"
      assert Map.has_key?(result, :fresh), "fresh peer should survive"
    end

    test "POOF evicts faster than hard TTL" do
      # A peer at 10s old would survive sweep_cache (needs 30s to expire).
      # But with 2 missed queries, POOF evicts it immediately.
      seen = now() - 10

      cache = %{
        :slow_death => %{
          name: :slow_death,
          ip: @loopback,
          port: 9090,
          seen_at: seen,
          missed_queries: 1
        }
      }

      pre_seen = %{slow_death: seen}

      # Would survive sweep_cache
      assert Map.has_key?(MDNS.sweep_cache(cache), :slow_death)
      # But POOF evicts it
      refute Map.has_key?(MDNS.apply_poof(cache, pre_seen), :slow_death)
    end

    test "cache entries without missed_queries field default to 0" do
      seen = now() - 5
      # Legacy entry without missed_queries
      cache = %{:legacy => %{name: :legacy, ip: @loopback, port: 9090, seen_at: seen}}
      pre_seen = %{legacy: seen}

      result = MDNS.apply_poof(cache, pre_seen)
      assert result[:legacy].missed_queries == 1
    end
  end

  # ── Step 3: Probe wire format ─────────────────────────────────────────
  # RFC 6762 §8.1 — probes check for name conflicts before announcing.

  describe "probe wire format" do
    test "probe has QR=0 (query)" do
      pkt = Packet.probe("admin-test._erlang._tcp.local")
      <<_id::16, qr::1, _rest::bitstring>> = pkt
      assert qr == 0
    end

    test "probe has QTYPE=ANY (255)" do
      pkt = Packet.probe("admin-test._erlang._tcp.local")
      <<_header::binary-size(12), rest::binary>> = pkt
      {_name, after_name} = Packet.read_name(pkt, rest)
      <<qtype::16, _qclass::16>> = after_name
      assert qtype == 255
    end

    test "probe has QU bit set in QCLASS (0x8001)" do
      pkt = Packet.probe("admin-test._erlang._tcp.local")
      <<_header::binary-size(12), rest::binary>> = pkt
      {_name, after_name} = Packet.read_name(pkt, rest)
      <<_qtype::16, qclass::16>> = after_name
      assert qclass == 0x8001
    end

    test "probe encodes the instance FQDN as the question name" do
      instance = "admin-550e-8400._erlang._tcp.local"
      pkt = Packet.probe(instance)
      <<_header::binary-size(12), rest::binary>> = pkt
      {name, _} = Packet.read_name(pkt, rest)
      assert name == instance
    end

    test "probe has QDCOUNT=1 and zero answer/authority/additional" do
      pkt = Packet.probe("test._erlang._tcp.local")
      <<_id::16, _flags::16, qdcount::16, ancount::16, nscount::16, arcount::16, _::binary>> = pkt
      assert qdcount == 1
      assert ancount == 0
      assert nscount == 0
      assert arcount == 0
    end
  end

  # ── Step 3: Exponential backoff schedule ──────────────────────────────
  # RFC 6762 §11 — proactive announcements space out exponentially.

  describe "exponential backoff schedule (advance_announce_schedule)" do
    test "doubles the interval" do
      state = %{announce_interval: 1, next_announce_at: 0}
      result = MDNS.advance_announce_schedule(state, 100)
      assert result.announce_interval == 2
    end

    test "successive doublings: 1 → 2 → 4 → 8 → 16 → 32 → 60 (capped)" do
      state = %{announce_interval: 1, next_announce_at: 0}

      {intervals, _} =
        Enum.map_reduce(1..7, state, fn _, s ->
          new_s = MDNS.advance_announce_schedule(s, 0)
          {new_s.announce_interval, new_s}
        end)

      assert intervals == [2, 4, 8, 16, 32, 60, 60]
    end

    test "next_announce_at is set to now + new_interval" do
      state = %{announce_interval: 4, next_announce_at: 0}
      result = MDNS.advance_announce_schedule(state, 1000)
      assert result.next_announce_at == 1000 + 8
      assert result.announce_interval == 8
    end

    test "cap at 60 seconds" do
      state = %{announce_interval: 32, next_announce_at: 0}
      result = MDNS.advance_announce_schedule(state, 0)
      assert result.announce_interval == 60

      # Already at cap — stays at 60
      result2 = MDNS.advance_announce_schedule(result, 100)
      assert result2.announce_interval == 60
    end
  end

  # ── Multicast Integration ─────────────────────────────────────────────────
  # These tests verify actual UDP packet delivery on the loopback interface.
  # Like Phoenix.PubSub's spy_on_pubsub/4 pattern — we set up a listener,
  # trigger an action, and assert what the listener received.
  #
  # Gracefully skipped when the mDNS port is already bound by the system
  # (avahi-daemon, systemd-resolved) without reuseport support.

  describe "goodbye packet delivery" do
    test "sends @goodbye_count TTL=0 packets on loopback" do
      with_multicast_listener(fn sock ->
        MDNS.goodbye([@loopback])
        packets = collect_packets(sock, 800)

        {own_name_atom, _port} = adapter().identity()
        own_name = Atom.to_string(own_name_atom)

        # Filter to our goodbye packets (TTL=0, matching our node name)
        goodbyes =
          packets
          |> decode_all()
          |> Enum.filter(fn records ->
            Enum.all?(records, &(&1.ttl == 0)) and has_node_name?(records, own_name)
          end)

        assert length(goodbyes) >= 2,
               "Expected >= 2 goodbye packets from #{own_name}, got #{length(goodbyes)}"

        # Each goodbye has all 4 record types
        Enum.each(goodbyes, fn records ->
          types = MapSet.new(records, & &1.type)
          assert MapSet.equal?(types, MapSet.new([1, 12, 16, 33]))
        end)
      end)
    end

    test "goodbye packets are correctly spaced" do
      with_multicast_listener(fn sock ->
        t0 = System.monotonic_time(:millisecond)
        MDNS.goodbye([@loopback])
        elapsed = System.monotonic_time(:millisecond) - t0

        # goodbye sends @goodbye_count packets with @goodbye_interval ms between.
        # For 2 packets with 250ms gap, elapsed should be >= 250ms.
        assert elapsed >= 200,
               "goodbye should block for at least one interval (~250ms), took #{elapsed}ms"

        packets = collect_packets(sock, 100)
        assert length(packets) >= 2
      end)
    end
  end

  describe "reannounce packet delivery" do
    test "sends a single TTL=120 announcement on loopback" do
      with_multicast_listener(fn sock ->
        MDNS.reannounce([@loopback])
        packets = collect_packets(sock, 400)

        {own_name_atom, _port} = adapter().identity()
        own_name = Atom.to_string(own_name_atom)

        announcements =
          packets
          |> decode_all()
          |> Enum.filter(fn records ->
            Enum.all?(records, &(&1.ttl == 120)) and has_node_name?(records, own_name)
          end)

        assert length(announcements) >= 1

        [records | _] = announcements
        types = MapSet.new(records, & &1.type)
        assert MapSet.equal?(types, MapSet.new([1, 12, 16, 33]))
      end)
    end
  end

  describe "goodbye vs reannounce: same structure, different TTL" do
    test "both produce identical record structure" do
      with_multicast_listener(fn sock ->
        MDNS.reannounce([@loopback])
        announce_packets = collect_packets(sock, 300)

        MDNS.goodbye([@loopback])
        goodbye_packets = collect_packets(sock, 600)

        {own_name_atom, _port} = adapter().identity()
        own_name = Atom.to_string(own_name_atom)

        [ann | _] =
          announce_packets
          |> decode_all()
          |> Enum.filter(&has_node_name?(&1, own_name))

        [bye | _] =
          goodbye_packets
          |> decode_all()
          |> Enum.filter(fn rrs ->
            Enum.all?(rrs, &(&1.ttl == 0)) and has_node_name?(rrs, own_name)
          end)

        # Same records, different TTLs
        assert length(ann) == length(bye)

        Enum.zip(ann, bye)
        |> Enum.each(fn {a, b} ->
          assert a.name == b.name
          assert a.type == b.type
          assert a.data == b.data
          assert a.ttl == 120
          assert b.ttl == 0
        end)
      end)
    end
  end

  # ── Helpers ─────────────────────────────────────────────────────────────

  defp adapter do
    Application.get_env(:dojo, :cluster_adapter, Dojo.Cluster.MDNS.PartisanAdapter)
  end

  defp now, do: System.monotonic_time(:second)

  defp peer_cache(name, seen_at, ip \\ @loopback) do
    %{name => %{name: name, ip: ip, port: 9090, seen_at: seen_at}}
  end

  # Open a multicast listener on the mDNS port. Returns {:ok, socket} or :skip.
  defp open_multicast_listener do
    base_opts = [
      :binary,
      active: false,
      reuseaddr: true,
      multicast_loop: true,
      ip: {0, 0, 0, 0}
    ]

    # Probe for reuseport support (same technique as Discovery)
    opts =
      case :gen_udp.open(0, reuseport: true) do
        {:ok, s} ->
          :gen_udp.close(s)
          [{:reuseport, true} | base_opts]

        _ ->
          base_opts
      end

    with {:ok, sock} <- :gen_udp.open(@mdns_port, opts),
         :ok <- :inet.setopts(sock, [{:add_membership, {@mdns_addr, @loopback}}]) do
      {:ok, sock}
    else
      {:error, _reason} -> :skip
    end
  end

  # Run a test body with a multicast listener socket.
  # Skips gracefully if the mDNS port is unavailable.
  defp with_multicast_listener(fun) do
    case open_multicast_listener() do
      {:ok, sock} ->
        try do
          # Drain any stale packets from before our test
          _drained = collect_packets(sock, 50)
          fun.(sock)
        after
          :gen_udp.close(sock)
        end

      :skip ->
        IO.puts("    [skip] mDNS port #{@mdns_port} unavailable on this host")
    end
  end

  defp collect_packets(sock, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_collect(sock, deadline, [])
  end

  defp do_collect(sock, deadline, acc) do
    remaining = deadline - System.monotonic_time(:millisecond)

    if remaining <= 0 do
      Enum.reverse(acc)
    else
      case :gen_udp.recv(sock, 0, remaining) do
        {:ok, {_ip, _port, raw}} -> do_collect(sock, deadline, [raw | acc])
        {:error, :timeout} -> Enum.reverse(acc)
        {:error, _} -> Enum.reverse(acc)
      end
    end
  end

  # Decode a list of raw packets, dropping any that fail to parse.
  defp decode_all(raw_packets) do
    raw_packets
    |> Enum.map(&Packet.decode/1)
    |> Enum.filter(&match?({:ok, _}, &1))
    |> Enum.map(fn {:ok, records} -> records end)
  end

  # Check if a set of records contains a TXT record matching the given node name.
  defp has_node_name?(records, name) do
    Enum.any?(records, fn
      %{type: 16, data: {:txt, kv}} ->
        case List.keyfind(kv, "erlang_node", 0) do
          {"erlang_node", ^name} -> true
          _ -> false
        end

      _ ->
        false
    end)
  end

  # Extract raw class values from wire format (before decoder strips flush bit).
  # Walks resource records in the answer section, pulling the 2-byte class field.
  defp extract_raw_classes(_pkt, _rest, 0), do: []

  defp extract_raw_classes(pkt, data, count) do
    {_name, after_name} = Packet.read_name(pkt, data)

    <<_type::16, class::16, _ttl::32, rdlen::16, _rdata::binary-size(rdlen), rest::binary>> =
      after_name

    [class | extract_raw_classes(pkt, rest, count - 1)]
  end
end
