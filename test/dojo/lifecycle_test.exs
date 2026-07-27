defmodule Dojo.LifecycleTest.DyingTable do
  @moduledoc """
  Stub that masquerades as a Table singleton (registered under
  Dojo.TableRegistry by reg_key) but self-stops :normal the instant it is
  called — reproducing the teardown race: a Table that Registry still hands
  back, yet dies mid-call. Used to prove Class.join recovers instead of
  crashing with {:normal, {GenServer, :call, ...}}.
  """
  use GenServer

  def start_link(reg_key) do
    GenServer.start_link(__MODULE__, :ok, name: {:via, Registry, {Dojo.TableRegistry, reg_key}})
  end

  @impl true
  def init(:ok), do: {:ok, %{}}

  # Reply to nothing; stop normally. The caller's monitor then fires with
  # :normal — the exact exit shape the narrow {:noproc, _} catch missed.
  @impl true
  def handle_call(_msg, _from, state), do: {:stop, :normal, state}
end

defmodule Dojo.LifecycleTest do
  @moduledoc """
  Chaos monkey tests for process lifecycle and fault tolerance.

  These tests verify that the system self-heals when processes crash:
  - Tables die and are recreated on demand
  - Presence is cleaned up when Tables crash
  - PubSub subscriptions survive Gate restarts
  - DynamicSupervisor doesn't cascade from Table stops
  """
  use ExUnit.Case, async: false

  alias Dojo.{Table, Class, Gate, Cache, PubSub, Disciple}

  @topic "class:shell:ChaosLab"
  @clan "shell:ChaosLab"

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

  defp table_alive?(table), do: Process.alive?(table)

  defp presence_exists?(name) do
    Gate.list_users(@topic)
    |> Enum.any?(fn meta -> meta.name == name end)
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

  # ── Table lifecycle ─────────────────────────────────────────────────────

  describe "Table: normal lifecycle" do
    test "Table dies when all watchers leave" do
      {watcher, table} = join_as("mortal")
      assert table_alive?(table)

      Process.exit(watcher, :kill)
      assert_eventually(fn -> not table_alive?(table) end)
    end

    test "Table survives when one watcher dies but another remains" do
      {w1, table} = join_as("resilient")
      w2 = spawn_watcher()
      Table.add_watcher(table, w2)

      Process.exit(w1, :kill)
      Process.sleep(100)
      assert table_alive?(table)

      Process.exit(w2, :kill)
      assert_eventually(fn -> not table_alive?(table) end)
    end

    test "multiple tabs share one Table (singleton per user+clan)" do
      {_w1, table1} = join_as("singleton")
      w2 = spawn_watcher()
      {:ok, table2} = Class.join(w2, @clan, make_disciple("singleton"))

      assert table1 == table2

      Process.exit(w2, :kill)
    end
  end

  # ── Chaos: kill Table, verify recovery ──────────────────────────────────

  describe "Table: crash recovery" do
    test "Table does NOT restart after normal stop (restart: :temporary)" do
      {watcher, table} = join_as("ephemeral")
      rk = reg_key("ephemeral")

      Process.exit(watcher, :kill)
      assert_eventually(fn -> not table_alive?(table) end)

      # Table should NOT be restarted — registry should be empty
      Process.sleep(100)
      assert Registry.lookup(Dojo.TableRegistry, rk) == []
    end

    test "Table does NOT restart after brutal kill (restart: :temporary)" do
      {_watcher, table} = join_as("killable")
      rk = reg_key("killable")

      Process.exit(table, :kill)
      assert_eventually(fn -> not table_alive?(table) end)

      Process.sleep(100)
      assert Registry.lookup(Dojo.TableRegistry, rk) == []
    end

    test "DynamicSupervisor survives Table crash (no cascade)" do
      {_w1, table1} = join_as("crash1")
      {w2, table2} = join_as("crash2")

      Process.exit(table1, :kill)
      assert_eventually(fn -> not table_alive?(table1) end)

      # Other Table should be unaffected
      assert table_alive?(table2)

      # Can still create new Tables
      {_w3, table3} = join_as("crash3")
      assert table_alive?(table3)

      Process.exit(w2, :kill)
    end

    test "new Table can be created after old one dies" do
      {watcher, table_old} = join_as("phoenix")

      Process.exit(table_old, :kill)
      assert_eventually(fn -> not table_alive?(table_old) end)

      # New join creates a fresh Table with a new PID
      {_w2, table_new} = join_as("phoenix")
      assert table_alive?(table_new)
      assert table_new != table_old

      Process.exit(watcher, :kill)
    end
  end

  # ── Presence lifecycle ──────────────────────────────────────────────────

  describe "Presence: Gate tracks Table PID" do
    test "presence appears on join" do
      {_w, _table} = join_as("visible")
      assert_eventually(fn -> presence_exists?("visible") end)
    end

    test "presence disappears when Table stops (all watchers gone)" do
      {watcher, _table} = join_as("departing")
      assert_eventually(fn -> presence_exists?("departing") end)

      Process.exit(watcher, :kill)
      assert_eventually(fn -> not presence_exists?("departing") end)
    end

    test "presence disappears when Table is killed" do
      {_watcher, table} = join_as("murdered")
      assert_eventually(fn -> presence_exists?("murdered") end)

      Process.exit(table, :kill)
      assert_eventually(fn -> not presence_exists?("murdered") end)
    end

    test "presence is restored after re-join" do
      {_watcher, table} = join_as("reborn")
      assert_eventually(fn -> presence_exists?("reborn") end)

      Process.exit(table, :kill)
      assert_eventually(fn -> not presence_exists?("reborn") end)

      {_w2, _table2} = join_as("reborn")
      assert_eventually(fn -> presence_exists?("reborn") end)
    end
  end

  # ── PubSub: message delivery through crashes ────────────────────────────

  describe "PubSub: subscription survives Table crash" do
    test "subscriber receives join/leave on Table lifecycle" do
      PubSub.subscribe(@topic)

      {watcher, _table} = join_as("pubsub_test")
      assert_receive {:join, @topic, %{name: "pubsub_test"}}, 2_000

      Process.exit(watcher, :kill)
      assert_receive {:leave, @topic, %{name: "pubsub_test"}}, 2_000
    end

    test "subscriber receives messages after Table crash and re-join" do
      PubSub.subscribe(@topic)

      {_w, table} = join_as("crash_pubsub")
      assert_receive {:join, @topic, %{name: "crash_pubsub"}}, 2_000

      Process.exit(table, :kill)
      assert_receive {:leave, @topic, %{name: "crash_pubsub"}}, 2_000

      # Re-join — subscription should still be active
      {_w2, _table2} = join_as("crash_pubsub")
      assert_receive {:join, @topic, %{name: "crash_pubsub"}}, 2_000
    end
  end

  # ── Cache: data persistence through crashes ─────────────────────────────

  describe "Cache: behavior across Table lifecycle" do
    test "published state is cached" do
      {_w, table} = join_as("cached")
      rk = reg_key("cached")

      turtle = %Dojo.Turtle{state: :hatch, path: "/test", commands: [:fd], time: 1}
      Table.publish(table, {Dojo.Turtle, nil, turtle}, :hatch)

      assert_eventually(fn ->
        Cache.get({Table, :last, rk, :hatch}) != nil
      end)
    end

    test "cache is cleared on normal Table termination" do
      {watcher, table} = join_as("cache_clean")
      rk = reg_key("cache_clean")

      turtle = %Dojo.Turtle{state: :hatch, path: "/test", commands: [:fd], time: 1}
      Table.publish(table, {Dojo.Turtle, nil, turtle}, :hatch)
      assert_eventually(fn -> Cache.get({Table, :last, rk, :hatch}) != nil end)

      # Kill watcher → Table terminates normally → terminate/2 clears cache
      Process.exit(watcher, :kill)
      assert_eventually(fn -> not table_alive?(table) end)
      assert_eventually(fn -> Cache.get({Table, :last, rk, :hatch}) == nil end)
    end

    test "cache survives Table crash (terminate/2 may not run)" do
      {_w, table} = join_as("cache_survive")
      rk = reg_key("cache_survive")

      turtle = %Dojo.Turtle{state: :hatch, path: "/test", commands: [:fd], time: 1}
      Table.publish(table, {Dojo.Turtle, nil, turtle}, :hatch)
      assert_eventually(fn -> Cache.get({Table, :last, rk, :hatch}) != nil end)

      # Brutal kill — terminate/2 does NOT run
      Process.exit(table, :kill)
      assert_eventually(fn -> not table_alive?(table) end)

      # Cache should still have the entry (stale but available for recovery)
      assert Cache.get({Table, :last, rk, :hatch}) != nil

      Cache.delete({Table, :last, rk, :hatch})
    end
  end

  # ── Watcher monitoring: simulating LiveView ↔ Table ─────────────────────

  describe "Watcher monitoring: LiveView detects Table death" do
    test "watcher receives :DOWN when Table crashes" do
      {_w, table} = join_as("monitored")
      ref = Process.monitor(table)

      Process.exit(table, :kill)
      assert_receive {:DOWN, ^ref, :process, ^table, :killed}, 2_000
    end

    test "watcher can re-join after receiving :DOWN" do
      {_w, table_old} = join_as("rejoin")
      Process.monitor(table_old)

      Process.exit(table_old, :kill)
      assert_receive {:DOWN, _ref, :process, ^table_old, :killed}, 2_000

      # Simulate ShellLive recovery: re-join
      {_w2, table_new} = join_as("rejoin")
      assert table_alive?(table_new)
      assert table_new != table_old
    end

    test "GenServer.cast to dead Table is silently ignored" do
      {_w, table} = join_as("silent")
      Process.exit(table, :kill)
      assert_eventually(fn -> not table_alive?(table) end)

      assert :ok == GenServer.cast(table, {:publish, {nil, nil, %{}}, :hatch})
    end

    test "GenServer.cast to nil is silently ignored" do
      assert :ok == GenServer.cast(nil, {:publish, {nil, nil, %{}}, :hatch})
    end
  end

  # ── Rapid chaos: stress the lifecycle ───────────────────────────────────

  describe "Rapid chaos: stress test" do
    test "rapid join-kill cycles don't crash the DynamicSupervisor" do
      for i <- 1..10 do
        {_w, table} = join_as("rapid_#{i}")
        Process.exit(table, :kill)
      end

      Process.sleep(200)

      # Verify we can still create Tables
      {w, table} = join_as("post_chaos")
      assert table_alive?(table)
      Process.exit(w, :kill)
    end

    test "concurrent joins for the same user converge to one Table" do
      name = "contended"

      tasks =
        for _ <- 1..5 do
          Task.async(fn ->
            watcher = spawn_watcher()
            {:ok, table} = Class.join(watcher, @clan, make_disciple(name))
            {watcher, table}
          end)
        end

      results = Task.await_many(tasks, 5_000)
      tables = Enum.map(results, fn {_w, t} -> t end) |> Enum.uniq()

      # All should converge to the same Table
      assert length(tables) == 1

      Enum.each(results, fn {w, _t} -> Process.exit(w, :kill) end)
    end
  end

  # ── Teardown race: join while the singleton is dying ─────────────────────

  describe "Teardown race: join recovers from a table dying mid-call" do
    alias Dojo.LifecycleTest.DyingTable

    test "join recovers when the looked-up Table dies :normal during add_watcher" do
      name = "teardown_race"
      rk = reg_key(name)

      # Plant a stub under the singleton's reg_key that Registry will return,
      # but which self-stops :normal the instant Class.join calls it.
      {:ok, dying} = DyingTable.start_link(rk)
      assert [{^dying, _}] = Registry.lookup(Dojo.TableRegistry, rk)

      watcher = spawn_watcher()

      # Pre-fix this exited {:normal, {GenServer, :call, ...}} and crashed the
      # caller. Now it must recover to a real, live Table.
      assert {:ok, table} = Class.join(watcher, @clan, make_disciple(name))

      assert table_alive?(table)
      assert table != dying
      refute Process.alive?(dying)

      # The recovered Table is a real one — it answers calls and tracks presence.
      assert :ok = Table.add_watcher(table, spawn_watcher())
      assert_eventually(fn -> presence_exists?(name) end)

      Process.exit(watcher, :kill)
    end
  end

  # ── Gate restart: subscription isolation ─────────────────────────────────

  describe "PubSub supervisor: rest_for_one isolation" do
    test "Gate restart does not destroy PubSub subscriptions" do
      Process.flag(:trap_exit, true)
      topic = "class:shell:GateTest"
      PubSub.subscribe(topic)

      # Gate is a Phoenix.Tracker (supervisor). Kill a shard to trigger
      # the supervision restart without obliterating the entire tree.
      shard = Process.whereis(Dojo.Gate_shard0)
      assert shard != nil

      Process.exit(shard, :kill)

      # Wait for the shard to be restarted by Gate's internal supervisor
      assert_eventually(fn ->
        new_shard = Process.whereis(Dojo.Gate_shard0)
        new_shard != nil and new_shard != shard
      end)

      # Subscription should still work — PubSub was never touched
      Phoenix.PubSub.broadcast(Dojo.PubSub, topic, {:test_msg, "survived"})
      assert_receive {:test_msg, "survived"}, 2_000
    end
  end
end
