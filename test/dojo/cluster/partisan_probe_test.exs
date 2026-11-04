defmodule Phoenix.PubSub.Partisan.ProbeTest do
  @moduledoc """
  The broadcast health probe must be total.

  It runs inside `Phoenix.Tracker.Shard.handle_info/2`, where one exception kills
  presence for that shard on every heartbeat. When a dep version drifts underneath
  it — `:partisan_plumtree_broadcast.group_name/1` absent, as happens with a mixed
  5.x/6.x `_build` — the probe reports `:unknown` and the send is still attempted.

  The fetch is injected so absence is testable without a broken build; production
  passes the static call, which the compiler checks.
  """
  use ExUnit.Case, async: true

  alias Phoenix.PubSub.Partisan

  @group :probe_test_group

  describe "group_queue_len/1" do
    test "an absent function is :unknown, not a raise" do
      missing = fn ->
        raise UndefinedFunctionError,
          module: :partisan_plumtree_broadcast,
          function: :group_name,
          arity: 1
      end

      assert Partisan.group_queue_len(missing) == :unknown
    end

    test "a group that is not registered is :missing" do
      assert Partisan.group_queue_len(fn -> @group end) == :missing
    end

    test "a live group reports its mailbox depth" do
      Process.register(self(), @group)

      assert Partisan.group_queue_len(fn -> @group end) == 0
    end
  end
end
