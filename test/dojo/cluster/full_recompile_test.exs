defmodule Dojo.Cluster.FullRecompileTest do
  @moduledoc """
  The crash that actually costs the dev loop.

  Editing one file is survivable — the reload_sim tests show the tree shrugs
  it off. What kills the node is `Compiling 75 files`: every project beam
  leaves ebin at once, and `Dojo.Cluster.MDNS.PartisanAdapter` goes with them.

  That module is the callback for `:partisan_peer_discovery_agent`, a
  *permanent* worker inside **partisan's** supervision tree, not Dojo's:

      partisan_peer_service_sup.erl:73  {rest_for_one, 10, 10}
      partisan_peer_discovery_agent.erl:164  Mod:init(CBConfig)   % uncaught

  `Mod:init/1` raises undef, the supervisor restarts it instantly with no
  backoff, and 10 restarts in 10s is spent in milliseconds. Then the chain
  runs: peer_service_sup gives up → partisan exits → dojo exits.

  Dojo.Cluster.Supervisor's own restart budget cannot help here. It does not
  own the dying process.

  Destructive by construction — it takes the node's applications down when it
  fails. Run it alone:

      bash scripts/verify/reload_test.sh
  """
  use ExUnit.Case, async: false

  alias Dojo.Test.ReloadSim

  @moduletag :full_recompile
  # The agent's crash loop has no backoff, so the budget is spent almost
  # instantly; 3s is generous.
  @hold_ms 3_000

  setup do
    on_exit(fn ->
      "#{:code.lib_dir(:dojo)}/ebin/*.beam.reloadsim"
      |> Path.wildcard()
      |> Enum.each(&File.rename!(&1, Path.rootname(&1)))
    end)

    :ok
  end

  @tag timeout: 120_000
  test "a full recompile does not take partisan — and dojo — down with it" do
    running = fn -> Application.started_applications() |> Enum.map(&elem(&1, 0)) end

    assert :partisan in running.(), "partisan must be up for this test to mean anything"
    app_sup = Process.whereis(Dojo.Supervisor)
    agent_before = Process.whereis(:partisan_peer_discovery_agent)
    mdns = Process.whereis(Dojo.Cluster.MDNS)
    polls_before = :sys.get_state(Dojo.Cluster.MDNS).poll_cycles

    %{count: count} = ReloadSim.remove_project(@hold_ms)
    assert count > 20, "expected a whole-ebin wipe, only removed #{count} modules"

    # Give the supervisors time to finish giving up.
    Process.sleep(3_000)

    after_apps = running.()

    assert :partisan in after_apps,
           "partisan shut down — peer_discovery_agent burned {rest_for_one, 10, 10} " <>
             "restarting against an absent PartisanAdapter"

    assert :dojo in after_apps, "the dojo application went down with partisan"

    assert Process.whereis(Dojo.Supervisor) == app_sup,
           "Dojo.Supervisor was restarted"

    assert is_pid(Process.whereis(:partisan_peer_discovery_agent)),
           "peer_discovery_agent is gone (was #{inspect(agent_before)})"

    # The absent-module boot burst may die during the synthetic gap. Drive one
    # ordinary poll after restoration: this proves the engine can resume its
    # packet path, rather than only remaining registered.
    assert Process.whereis(Dojo.Cluster.MDNS) == mdns
    send(mdns, :poll)

    assert_eventually(
      fn -> :sys.get_state(Dojo.Cluster.MDNS).poll_cycles > polls_before end,
      5_000
    )

    assert :ok == Dojo.Cluster.MDNS.reannounce()
  end

  defp assert_eventually(predicate, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    wait_until(predicate, deadline)
  end

  defp wait_until(predicate, deadline) do
    if predicate.() do
      :ok
    else
      assert System.monotonic_time(:millisecond) < deadline,
             "mDNS did not complete a poll after its beams returned"

      Process.sleep(100)
      wait_until(predicate, deadline)
    end
  end
end
