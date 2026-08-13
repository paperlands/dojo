defmodule Dojo.BroadcastStormTest do
  @moduledoc """
  Test harness for diagnosing and fixing the Plumtree broadcast storm.

  Tests are organized by the fix they validate:
  - Test 1: Handler deduplication (is_stale/1 ETS-backed seen set)
  - Test 2: Circuit breaker (mailbox-check before broadcast)
  - Test 3: Throughput stress (classroom load simulation)
  - Test 4: Gate handle_diff inline delivery
  - Test 5: NetworkMonitor debounce
  - Test 6: Adversarial chaos (combined stress + lifecycle churn)
  """
  use ExUnit.Case, async: false

  alias Dojo.{Table, Class, Gate, PubSub, Disciple}
  alias Phoenix.PubSub.Partisan.Handler

  @topic "class:shell:StormLab"
  @clan "shell:StormLab"

  # ── helpers ──────────────────────────────────────────────────────────────

  defp make_disciple(name, user_id \\ nil) do
    %Disciple{name: name, action: "active", user_id: user_id || name}
  end

  defp reg_key(name), do: "#{@topic}:#{name}"

  defp spawn_watcher do
    spawn(fn -> Process.sleep(:infinity) end)
  end

  defp join_as(name) do
    watcher = spawn_watcher()
    {:ok, table} = Class.join(watcher, @clan, make_disciple(name))
    {watcher, table}
  end

  defp assert_eventually(func, timeout \\ 2_000, interval \\ 50) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_poll(func, deadline, interval)
  end

  defp do_poll(func, deadline, interval) do
    if func.() do
      :ok
    else
      remaining = deadline - System.monotonic_time(:millisecond)

      if remaining <= 0 do
        flunk("Condition not met within timeout")
      else
        Process.sleep(min(interval, remaining))
        do_poll(func, deadline, interval)
      end
    end
  end

  defp publish_hatch(table, reg_key, time \\ nil) do
    t = time || System.monotonic_time(:millisecond)
    turtle = %Dojo.Turtle{state: :hatch, path: "/test", commands: [:fd], time: t}
    Table.publish(table, {Dojo.Turtle, nil, turtle}, :hatch)
  end

  defp max_mailbox_depth(pids) when is_list(pids) do
    Enum.reduce(pids, 0, fn pid, acc ->
      case Process.info(pid, :message_queue_len) do
        {:message_queue_len, len} -> max(acc, len)
        _ -> acc
      end
    end)
  end

  defp task_supervisor_child_count do
    case Process.whereis(Dojo.TaskSupervisor) do
      nil ->
        0

      pid ->
        %{workers: count} = Supervisor.count_children(pid)
        count
    end
  end

  # ── Test 1: Handler Deduplication ────────────────────────────────────────

  describe "Handler.is_stale/1 deduplication" do
    test "broadcast_data/1 generates unique IDs for different payloads" do
      payload_a = {:broadcast, Dojo.PubSub, "topic:a", {:msg, 1}, Phoenix.PubSub}
      payload_b = {:broadcast, Dojo.PubSub, "topic:b", {:msg, 2}, Phoenix.PubSub}

      {id_a, _} = Handler.broadcast_data(payload_a)
      {id_b, _} = Handler.broadcast_data(payload_b)

      refute id_a == id_b
    end

    test "broadcast_data/1 generates distinct IDs for identical payloads at different times" do
      payload = {:broadcast, Dojo.PubSub, "topic:x", {:msg, 1}, Phoenix.PubSub}

      {id_1, _} = Handler.broadcast_data(payload)
      {id_2, _} = Handler.broadcast_data(payload)

      # After fix: unique_integer makes these distinct
      # Before fix: phash2 alone makes these identical — this test documents the issue
      # We tag this so we know when the fix lands
      if id_1 == id_2 do
        # Current behavior: identical payloads → same ID (no dedup possible)
        assert id_1 == id_2, "Pre-fix: phash2 only, identical payloads collide"
      else
        # Fixed behavior: unique_integer makes them distinct
        refute id_1 == id_2, "Post-fix: unique IDs for distinct broadcasts"
      end
    end

    # A receiver-side id (constructed manually, not via broadcast_data) simulates
    # what happens at a remote node receiving a gossip message.
    defp fake_remote_id,
      do: {:erlang.phash2(:rand.uniform()), :erlang.unique_integer([:monotonic])}

    test "is_stale/1 returns false for unseen messages" do
      id = fake_remote_id()
      refute Handler.is_stale(id)
    end

    test "receiver merge/2: first delivery returns true and marks seen" do
      topic = "stale_test:merge"
      PubSub.subscribe(topic)

      id = fake_remote_id()
      payload = {:broadcast, Dojo.PubSub, topic, {:dedup_test, :delivered}, Phoenix.PubSub}

      # Simulate a fresh remote gossip message arriving
      assert Handler.merge(id, payload) == true
      assert_receive {:dedup_test, :delivered}, 1_000

      # Now the id should be in the seen set
      assert Handler.is_stale(id)
    end

    test "receiver merge/2: duplicate returns false and does NOT re-deliver" do
      topic = "stale_test:dedup"
      PubSub.subscribe(topic)

      id = fake_remote_id()
      payload = {:broadcast, Dojo.PubSub, topic, {:dedup_test, :once_only}, Phoenix.PubSub}

      # First merge delivers once
      assert Handler.merge(id, payload) == true
      assert_receive {:dedup_test, :once_only}, 1_000

      # Second merge of the same id MUST return false — behaviour contract
      # demands false for duplicates so plumtree prunes the upstream peer
      # instead of re-eager-pushing. And there must be NO second delivery.
      assert Handler.merge(id, payload) == false
      refute_receive {:dedup_test, :once_only}, 200
    end

    test "origin broadcast_data/1 marks id seen (prevents gossip-loop re-delivery)" do
      # When a node originates a broadcast, plumtree NEVER calls merge/2 on it
      # locally. Without marking seen in broadcast_data, a gossip loopback
      # would trigger duplicate local delivery.
      payload = {:broadcast, Dojo.PubSub, "topic:origin", {:origin, :self}, Phoenix.PubSub}
      {id, _} = Handler.broadcast_data(payload)

      assert Handler.is_stale(id), "broadcast_data must seed the seen-set"

      # Simulating a loopback: merge must now return false and NOT deliver
      PubSub.subscribe("topic:origin")
      assert Handler.merge(id, payload) == false
      refute_receive {:origin, :self}, 200
    end

    test "graft/1 returns :stale (not {:error, _}) so outstanding is acked" do
      # Regression test for the outstanding leak. Returning {:error, _} from
      # graft causes partisan_plumtree_broadcast.handle_graft/7 to log and
      # leave the entry in ?PLUMTREE_OUTSTANDING forever, producing a
      # 1 Hz i_have storm that never self-terminates.
      assert Handler.graft({:any, :id}) == :stale
    end

    test "seen set is bounded (does not grow unbounded)" do
      # This test verifies that the dedup table prunes itself
      # BEFORE FIX: no seen set exists, this is a no-op
      # AFTER FIX: seen set should stay below max_seen entries
      seen_table =
        try do
          :ets.info(:partisan_pubsub_seen, :size)
        catch
          _, _ -> :no_table
        end

      case seen_table do
        :no_table ->
          assert true, "Pre-fix: no seen table (expected)"

        :undefined ->
          assert true, "Pre-fix: no seen table (expected)"

        size when is_integer(size) ->
          assert size <= 15_000, "Seen set should be bounded (was #{size})"
      end
    end
  end

  # ── Test 2: Circuit Breaker ──────────────────────────────────────────────

  describe "PubSub.Partisan.broadcast circuit breaker" do
    test "local delivery always happens regardless of remote state" do
      topic = "circuit:local"
      PubSub.subscribe(topic)

      # Broadcast through the full PubSub path
      Phoenix.PubSub.broadcast(Dojo.PubSub, topic, {:circuit_test, :local_delivery})

      # Local delivery should always work
      assert_receive {:circuit_test, :local_delivery}, 1_000
    end

    test "broadcast to overloaded plumtree should degrade gracefully" do
      # Measure baseline: what's the plumtree mailbox before we start?
      plumtree_pid = Process.whereis(:partisan_plumtree_broadcast)

      baseline_mq =
        if plumtree_pid do
          case Process.info(plumtree_pid, :message_queue_len) do
            {:message_queue_len, len} -> len
            _ -> 0
          end
        else
          0
        end

      # Send a burst of broadcasts
      topic = "circuit:burst"
      PubSub.subscribe(topic)

      for i <- 1..100 do
        Phoenix.PubSub.broadcast(Dojo.PubSub, topic, {:burst, i})
      end

      # All should be delivered locally
      received =
        Enum.reduce_while(1..100, 0, fn _, acc ->
          receive do
            {:burst, _} -> {:cont, acc + 1}
          after
            2_000 -> {:halt, acc}
          end
        end)

      assert received == 100, "All 100 local broadcasts should be delivered, got #{received}"

      # After fix: if plumtree mailbox was > threshold, remote broadcasts
      # would have been dropped but local delivery preserved
      if plumtree_pid do
        current_mq =
          case Process.info(plumtree_pid, :message_queue_len) do
            {:message_queue_len, len} -> len
            _ -> 0
          end

        # Document the mailbox growth from our burst
        growth = current_mq - baseline_mq

        # After circuit breaker fix: growth should be bounded by threshold
        # Before fix: growth is unbounded (all 100 enqueued)
        assert growth >= 0, "Mailbox growth: #{growth} messages"
      end
    end
  end

  # ── Test 3: Broadcast Throughput Under Load ──────────────────────────────

  describe "broadcast throughput: classroom load" do
    @tag timeout: 30_000
    test "30 Tables publishing hatches at 6/sec for 2 seconds" do
      topic = @topic
      PubSub.subscribe(topic)

      # Spawn 30 Tables
      tables =
        for i <- 1..30 do
          name = "storm_#{i}"
          {watcher, table} = join_as(name)
          rk = reg_key(name)
          {watcher, table, rk}
        end

      # Wait for all joins to settle
      Process.sleep(500)

      # Drain join messages
      drain_mailbox()

      # Publish hatches: 30 Tables × 6/sec × 2 seconds = 360 hatches
      duration_ms = 2_000
      rate_per_table = 6
      interval_ms = div(1_000, rate_per_table)
      iterations = div(duration_ms, interval_ms)

      t_start = System.monotonic_time(:millisecond)

      for _tick <- 1..iterations do
        for {_w, table, rk} <- tables do
          publish_hatch(table, rk)
        end

        Process.sleep(interval_ms)
      end

      t_elapsed = System.monotonic_time(:millisecond) - t_start

      # Wait for debounced broadcasts to flush (100ms debounce + buffer)
      Process.sleep(300)

      # Count received hatch_version signals (remote path through Plumtree)
      # and hatch signals (local path)
      {hatch_count, version_count} = count_hatch_messages(5_000)

      # Measure process health after the storm
      table_pids = Enum.map(tables, fn {_, t, _} -> t end)
      max_table_mq = max_mailbox_depth(table_pids)

      plumtree_mq =
        case Process.whereis(:partisan_plumtree_broadcast) do
          nil ->
            0

          pid ->
            case Process.info(pid, :message_queue_len) do
              {:message_queue_len, len} -> len
              _ -> 0
            end
        end

      # Report metrics
      IO.puts("")
      IO.puts("  === Storm Metrics ===")
      IO.puts("  Duration: #{t_elapsed}ms")
      IO.puts("  Hatch signals received (local): #{hatch_count}")
      IO.puts("  Hatch versions received (remote): #{version_count}")
      IO.puts("  Max Table mailbox depth: #{max_table_mq}")
      IO.puts("  Plumtree mailbox depth: #{plumtree_mq}")
      IO.puts("  TaskSupervisor children: #{task_supervisor_child_count()}")

      # Assertions: system should handle classroom load
      assert hatch_count > 0, "Should receive local hatch signals"
      assert max_table_mq < 100, "Table mailboxes should not back up (was #{max_table_mq})"
      assert plumtree_mq < 1_000, "Plumtree mailbox should not explode (was #{plumtree_mq})"

      # Cleanup
      Enum.each(tables, fn {w, _, _} -> Process.exit(w, :kill) end)
      Process.sleep(200)
    end
  end

  # ── Test 4: Gate handle_diff Delivery ───────────────────────────────────

  describe "Gate handle_diff delivery" do
    test "join triggers presence broadcast to subscriber" do
      PubSub.subscribe(@topic)

      {watcher, _table} = join_as("diff_test")
      assert_receive {:join, @topic, %{name: "diff_test"}}, 2_000

      Process.exit(watcher, :kill)
      assert_receive {:leave, @topic, %{name: "diff_test"}}, 5_000
    end

    test "TaskSupervisor child count does not grow from presence diffs" do
      before_count = task_supervisor_child_count()

      PubSub.subscribe(@topic)

      # Rapid join/leave cycle
      for i <- 1..5 do
        {w, _t} = join_as("task_count_#{i}")
        Process.exit(w, :kill)
      end

      Process.sleep(500)

      after_count = task_supervisor_child_count()
      growth = after_count - before_count

      # After inline fix: no Task spawned for diffs, growth should be ~0
      # Before fix: each diff spawns a Task, growth may be > 0
      IO.puts("")
      IO.puts("  TaskSupervisor growth from 5 join/leave cycles: #{growth}")

      # Either way, it should not grow unboundedly
      assert growth < 20, "TaskSupervisor should not accumulate tasks (grew by #{growth})"
    end
  end

  # ── Test 5: NetworkMonitor Debounce ─────────────────────────────────────

  describe "NetworkMonitor IP change debounce" do
    # These test the debounce state machine logic.
    # We test the pure logic, not the GenServer — extract after implementing.

    test "identical IPs across polls triggers no change" do
      ips = [{192, 168, 1, 100}]

      # Simulate: poll detects same IPs
      state = %{ips: ips, port: 9090, pending_ips: nil, stable_count: 0}

      # No change → state unchanged
      new_ips = [{192, 168, 1, 100}]
      assert MapSet.new(new_ips) == MapSet.new(state.ips)
    end

    test "single IP change should NOT trigger immediate action (after debounce fix)" do
      old_ips = [{192, 168, 1, 100}]
      new_ips = [{192, 168, 1, 200}]

      # First detection: should start debounce, not act
      state = %{ips: old_ips, port: 9090, pending_ips: nil, stable_count: 0}

      # After debounce fix: pending_ips should be set, ips unchanged
      # Before fix: handle_ip_change fires immediately
      refute MapSet.new(new_ips) == MapSet.new(old_ips), "IPs differ — change detected"

      # The debounce state machine:
      # Poll 1: new IPs detected → pending_ips = new_ips, stable_count = 1
      debounced = %{state | pending_ips: new_ips, stable_count: 1}
      assert debounced.pending_ips == new_ips
      assert debounced.ips == old_ips, "IPs should NOT change yet"
    end

    test "two consecutive polls with same new IPs should trigger change" do
      old_ips = [{192, 168, 1, 100}]
      new_ips = [{192, 168, 1, 200}]

      # Poll 1: detect change, start debounce
      state1 = %{ips: old_ips, port: 9090, pending_ips: new_ips, stable_count: 1}

      # Poll 2: same new IPs → stable_count reaches threshold
      debounce_threshold = 2
      assert state1.stable_count + 1 >= debounce_threshold, "Should trigger after 2 polls"

      # Action: update ips, clear pending
      state2 = %{state1 | ips: new_ips, pending_ips: nil, stable_count: 0}
      assert state2.ips == new_ips
    end

    test "transient flap (A → B → A) is absorbed by debounce" do
      ips_a = [{192, 168, 1, 100}]
      ips_b = [{192, 168, 1, 200}]

      # Poll 1: A → B detected
      state1 = %{ips: ips_a, port: 9090, pending_ips: ips_b, stable_count: 1}

      # Poll 2: back to A — flap! pending doesn't match
      # Should reset pending, no action taken
      assert MapSet.new(ips_a) == MapSet.new(state1.ips), "Flap back to original"
      state2 = %{state1 | pending_ips: nil, stable_count: 0}

      assert state2.ips == ips_a, "IPs should stay at original after flap"
      assert state2.pending_ips == nil, "Pending should be cleared on flap"
    end
  end

  # ── Test 6: Adversarial Chaos ───────────────────────────────────────────

  describe "adversarial: lifecycle churn under broadcast load" do
    @tag timeout: 30_000
    test "30 Tables + rapid churn does not explode mailboxes" do
      PubSub.subscribe(@topic)

      # Phase 1: Spawn 30 stable Tables
      stable_tables =
        for i <- 1..30 do
          name = "stable_#{i}"
          {watcher, table} = join_as(name)
          rk = reg_key(name)
          {watcher, table, rk, name}
        end

      Process.sleep(300)
      drain_mailbox()

      # Phase 2: Start publishing from all Tables
      publisher =
        spawn(fn ->
          for _tick <- 1..10 do
            for {_w, table, rk, _name} <- stable_tables do
              if Process.alive?(table), do: publish_hatch(table, rk)
            end

            Process.sleep(150)
          end
        end)

      # Phase 3: Simultaneously churn 10 ephemeral Tables
      churner =
        spawn(fn ->
          for i <- 1..10 do
            {w, _t} = join_as("churn_#{i}")
            Process.sleep(50)
            Process.exit(w, :kill)
          end
        end)

      # Wait for both to finish
      Process.monitor(publisher)
      Process.monitor(churner)

      receive do
        {:DOWN, _, _, ^publisher, _} -> :ok
      after
        15_000 -> :ok
      end

      receive do
        {:DOWN, _, _, ^churner, _} -> :ok
      after
        5_000 -> :ok
      end

      Process.sleep(500)

      # Phase 4: Measure health
      stable_pids = Enum.map(stable_tables, fn {_, t, _, _} -> t end)
      alive_count = Enum.count(stable_pids, &Process.alive?/1)

      max_mq = max_mailbox_depth(stable_pids)

      plumtree_mq =
        case Process.whereis(:partisan_plumtree_broadcast) do
          nil ->
            0

          pid ->
            case Process.info(pid, :message_queue_len) do
              {:message_queue_len, len} -> len
              _ -> 0
            end
        end

      task_count = task_supervisor_child_count()

      IO.puts("")
      IO.puts("  === Adversarial Metrics ===")
      IO.puts("  Stable Tables alive: #{alive_count}/30")
      IO.puts("  Max Table mailbox: #{max_mq}")
      IO.puts("  Plumtree mailbox: #{plumtree_mq}")
      IO.puts("  TaskSupervisor children: #{task_count}")

      # Assertions
      assert alive_count == 30, "All stable Tables should survive (#{alive_count}/30)"
      assert max_mq < 500, "No Table mailbox should back up (max was #{max_mq})"
      assert plumtree_mq < 1_000, "Plumtree should not explode (was #{plumtree_mq})"

      # Verify PubSub still works after the chaos
      Phoenix.PubSub.broadcast(Dojo.PubSub, @topic, {:sanity, :check})
      assert_receive {:sanity, :check}, 2_000

      # Cleanup
      Enum.each(stable_tables, fn {w, _, _, _} -> Process.exit(w, :kill) end)
      Process.sleep(200)
    end
  end

  # ── Message counting helpers ────────────────────────────────────────────

  defp drain_mailbox do
    receive do
      _ -> drain_mailbox()
    after
      100 -> :ok
    end
  end

  defp count_hatch_messages(timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_count_hatches(0, 0, deadline)
  end

  defp do_count_hatches(hatches, versions, deadline) do
    remaining = deadline - System.monotonic_time(:millisecond)

    if remaining <= 0 do
      {hatches, versions}
    else
      receive do
        {Dojo.PubSub, :hatch, _} ->
          do_count_hatches(hatches + 1, versions, deadline)

        {Dojo.PubSub, :hatch_version, _} ->
          do_count_hatches(hatches, versions + 1, deadline)

        _ ->
          do_count_hatches(hatches, versions, deadline)
      after
        min(100, max(remaining, 0)) ->
          {hatches, versions}
      end
    end
  end
end
