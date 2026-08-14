defmodule Dojo.Cluster.ReloadResilienceTest do
  @moduledoc """
  Reproduces the dev-loop crash: a module is recompiled while a 3–5s poller
  is mid-flight, and something in the cluster tree dies.

  These tests purge real modules out of the running node, so they cannot be
  async and they are tagged `:reload_sim` — run them alone:

      mix test --only reload_sim

  The first test is a **probe**, not a judgement: it prints what died so the
  cause can be read off instead of guessed at.
  """
  use ExUnit.Case, async: false

  alias Dojo.Test.ReloadSim

  @moduletag :reload_sim
  # Longer than NetworkMonitor's 3s poll and MDNS's 5s poll, so a tick is
  # guaranteed to land inside the window rather than step over it.
  @hold_ms 6_000
  @sup Dojo.Cluster.Supervisor

  setup_all do
    unless Process.whereis(@sup) do
      raise "#{inspect(@sup)} is not running — set config :dojo, :discovery, :local"
    end

    :ok
  end

  setup do
    # A test that dies mid-window would leave a .beam stashed and the build
    # broken for everything after it. Put anything stranded back.
    on_exit(fn ->
      "#{:code.lib_dir(:dojo)}/ebin/*.beam.reloadsim"
      |> Path.wildcard()
      |> Enum.each(&File.rename!(&1, Path.rootname(&1)))
    end)

    :ok
  end

  describe "probe — what dies when a module is recompiled" do
    @tag timeout: 180_000
    test "each cluster module, purged in turn, reports its casualties" do
      modules = [
        Dojo.Cluster.MDNS,
        Dojo.Cluster.Routing,
        Dojo.Cluster.Routing.Local,
        Dojo.Cluster.NetworkMonitor,
        Dojo.Hotspot.Server
      ]

      findings =
        for module <- modules do
          {purge, report} =
            ReloadSim.watch(@sup, [settle: 1_000], fn ->
              ReloadSim.reload_cycle(module, @hold_ms)
            end)

          finding = %{
            module: module,
            lingering_killed?: purge.lingering_killed?,
            deaths: Enum.map(report.deaths, &{&1.id, crash_shape(&1.reason)}),
            replaced: Enum.map(report.replaced, & &1.id),
            missing: report.missing
          }

          IO.puts(format_finding(finding))
          finding
        end

      # The probe always passes. Its output is the evidence; the assertions
      # below are the ones that encode what we decided must hold.
      assert length(findings) == 5
    end
  end

  describe "the cluster tree survives a recompile" do
    test "purging MDNS does not take NetworkMonitor with it" do
      monitor_before = Process.whereis(Dojo.Cluster.NetworkMonitor)

      {_, report} =
        ReloadSim.watch(@sup, [settle: 1_000], fn ->
          ReloadSim.reload_cycle(Dojo.Cluster.MDNS, @hold_ms)
        end)

      monitor_after = Process.whereis(Dojo.Cluster.NetworkMonitor)

      assert monitor_after == monitor_before,
             "NetworkMonitor restarted during an MDNS recompile — " <>
               "deaths: #{inspect(report.deaths)}"
    end

    test "purging MDNS does not leave NetworkMonitor with a phantom baseline" do
      ReloadSim.reload_cycle(Dojo.Cluster.MDNS, @hold_ms)
      Process.sleep(4_000)

      state = :sys.get_state(Dojo.Cluster.NetworkMonitor)

      # A poll that lands in the window must skip the tick, never adopt `[]`
      # as the new IP set — that would fire a phantom roam and hot-swap
      # Partisan onto no addresses at all.
      assert state.ips == Dojo.Cluster.MDNS.routable_ipv4_addrs(),
             "NetworkMonitor's IP baseline drifted across a recompile: #{inspect(state.ips)}"

      assert state.pending_ips == nil
    end

    @tag timeout: 180_000
    test "a save-storm does not exhaust the cluster restart budget" do
      # Dojo.Cluster.Supervisor allows 10 restarts in 60s. Twelve reload
      # cycles inside that minute is what a rename sweep across mdns.ex
      # actually looks like.
      {_, report} =
        ReloadSim.watch(@sup, [settle: 2_000], fn ->
          ReloadSim.storm(Dojo.Cluster.MDNS, 12, 200, 100)
        end)

      assert Process.whereis(@sup),
             "Dojo.Cluster.Supervisor died in a save-storm — " <>
               "deaths: #{inspect(report.deaths)}"

      assert report.missing == [],
             "children gave up during a save-storm: #{inspect(report.missing)}"

      ids = @sup |> Supervisor.which_children() |> Enum.map(&elem(&1, 0)) |> MapSet.new()

      assert MapSet.equal?(
               ids,
               MapSet.new([Dojo.Cluster.MDNS, Dojo.Cluster.NetworkMonitor, Dojo.Hotspot.Server])
             )
    end

    test "the endpoint is never a casualty of a cluster recompile" do
      endpoint = Process.whereis(DojoWeb.Endpoint)
      app_sup = Process.whereis(Dojo.Supervisor)

      ReloadSim.storm(Dojo.Cluster.MDNS, 6, 200, 100)
      Process.sleep(1_000)

      # This is the whole point of giving discovery its own restart budget:
      # a flapping LAN child must never spend Dojo.Supervisor's.
      assert Process.whereis(Dojo.Supervisor) == app_sup
      assert Process.whereis(DojoWeb.Endpoint) == endpoint
    end
  end

  describe "functionality after the reload" do
    test "the addr cache still agrees with the interfaces" do
      ReloadSim.reload_cycle(Dojo.Cluster.MDNS, @hold_ms)
      ReloadSim.reload_cycle(Dojo.Cluster.Routing, 500)
      Process.sleep(4_000)

      cached = :persistent_term.get({Dojo.Gate, :addr}, nil)
      live = Dojo.Cluster.Routing.routable_addr()

      assert cached == live,
             "addr cache went stale across a recompile: cached=#{inspect(cached)} live=#{inspect(live)}"
    end

    test "partisan still advertises addresses it has a listener on" do
      ReloadSim.reload_cycle(Dojo.Cluster.MDNS, @hold_ms)
      Process.sleep(4_000)

      advertised = :partisan_config.get(:listen_addrs) |> Enum.map(& &1.ip)
      live = Dojo.Cluster.MDNS.routable_ipv4_addrs()

      # Loopback-only is the legitimate no-LAN case; otherwise every
      # advertised IP must be one we actually hold.
      unless advertised == [{127, 0, 0, 1}] do
        assert Enum.all?(advertised, &(&1 in live)),
               "partisan advertises #{inspect(advertised)} but the node holds #{inspect(live)}"
      end
    end
  end

  # Crash reasons carry full stacktraces; the shape is what distinguishes
  # "module was gone" from "process was killed mid-call".
  defp crash_shape({%UndefinedFunctionError{module: m, function: f, arity: a}, _st}),
    do: {:undefined_function, m, f, a}

  defp crash_shape({%{__struct__: s}, _st}), do: {:exception, s}
  defp crash_shape(:killed), do: :killed
  defp crash_shape(:normal), do: :normal
  defp crash_shape(:shutdown), do: :shutdown
  defp crash_shape({:shutdown, r}), do: {:shutdown, r}
  defp crash_shape(other), do: other

  defp format_finding(f) do
    """

    ── purge #{inspect(f.module)} ────────────────────────────────
       lingering process killed by :code.purge  #{f.lingering_killed?}
       died                                     #{inspect(f.deaths)}
       restarted with a new pid                 #{inspect(f.replaced)}
       gone from the supervisor                 #{inspect(f.missing)}
    """
  end
end
