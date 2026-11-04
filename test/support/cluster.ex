defmodule Dojo.Test.Cluster do
  @moduledoc """
  Spawns peer BEAM nodes for the `:clustered` tier.

  Uses OTP 25+ `:peer` with `connection: 0` (TCP control channel) so the test
  runner needs no ERTS distribution of its own — Partisan takes that over on
  the runner node.

  A peer runs the mDNS engine and nothing else of Dojo. "Nothing else" is a
  contract, not a description: `Dojo.Cluster.MDNS.init/1` dispatches its boot
  burst through `Dojo.TaskSupervisor`, so that supervisor is part of the
  minimum tree a peer needs. Leave it out and `init/1` exits `:noproc` after
  binding the socket and claiming the name — a peer that looks alive on the
  wire and is dead in the VM.

  Every failure to build that tree raises here. A peer that comes up
  mDNS-less is otherwise indistinguishable from a LAN that dropped every
  packet, and the suite reports the second when it means the first.

  Inspired by `Phoenix.PubSub.Cluster`.
  """

  @sup_name Dojo.Test.MDNSSupervisor

  # The runner is not distributed, so `:erlang.get_cookie/0` answers
  # `:nocookie`. Peers still have to agree on something to connect to each
  # other, so name it rather than propagate the placeholder.
  @cookie :dojo_test_cluster

  @doc """
  Spawn peer nodes and start mDNS discovery on each.

  Returns a list of `{node_name, peer_pid}` tuples. Raises unless every peer
  came up with a live mDNS engine.

  ## Options

    * `:adapter` — discovery adapter module (default: `DistAdapter`)
    * `:poll_interval` — mDNS poll interval in ms (default: 1_000)
  """
  def spawn_peers(nodes, opts \\ []) do
    results =
      nodes
      |> Enum.map(&Task.async(fn -> try_spawn_node(&1, opts) end))
      |> Enum.map(&Task.await(&1, 30_000))

    # All or nothing: a half-built mesh leaves BEAMs holding UDP 5454 and
    # announcing onto the LAN, which the next run inherits as phantom peers.
    case Enum.split_with(results, &match?({:ok, _, _}, &1)) do
      {ok, []} ->
        Enum.map(ok, fn {:ok, node, peer} -> {node, peer} end)

      {ok, failed} ->
        Enum.each(ok, fn {:ok, _node, peer} -> stop_peer(peer) end)

        raise """
        #{length(failed)} of #{length(results)} peers failed to start an mDNS engine.

        #{Enum.map_join(failed, "\n", fn {:error, name, reason} -> "  #{name}: #{inspect(reason)}" end)}

        A peer needs Dojo.TaskSupervisor before Dojo.Cluster.MDNS — see the
        moduledoc. This is a harness fault, not a network one.
        """
    end
  end

  @doc "Stop all peer nodes. Tolerates peers that are already gone."
  def stop(peers) do
    Enum.each(peers, fn {_node, peer} -> stop_peer(peer) end)
  end

  @doc """
  Run a function on a remote node via `:peer.call`.
  The closure is serialized to the peer and executed there.
  """
  def call(peer, func, timeout \\ 10_000) do
    :peer.call(peer, Kernel, :apply, [func, []], timeout)
  end

  @doc """
  Run a function on a remote node that stays alive until the test exits.
  Returns `{pid, result}`. Used for long-lived spies/receivers.
  """
  def spawn_on(peer, func) do
    :peer.call(peer, Kernel, :apply, [
      fn ->
        parent = self()
        ref = make_ref()

        pid =
          spawn(fn ->
            result = func.()
            send(parent, {ref, result})
            Process.sleep(:infinity)
          end)

        receive do
          {^ref, result} -> {pid, result}
        after
          5_000 -> {pid, {:error, :timeout}}
        end
      end,
      []
    ])
  end

  @doc """
  Restart the mDNS GenServer on a peer node. Raises if it does not come back.
  """
  def restart_mdns(peer, opts \\ []) do
    case setup_peer(peer, opts) do
      :ok -> :ok
      {:error, reason} -> raise "mDNS did not restart on #{inspect(peer)}: #{inspect(reason)}"
    end
  end

  @doc """
  Kill the mDNS engine and its supervisor, simulating a crash: no `terminate/2`,
  so no goodbye packet.

  The supervisor dies first. Killing the child first would let `:one_for_one`
  restart it, and the replacement's boot burst re-announces the node the
  caller is about to assert has vanished.
  """
  def kill_mdns(peer) do
    sup_name = @sup_name

    :peer.call(peer, Kernel, :apply, [fn -> teardown_tree(sup_name) end, []])
  end

  # ── Private ────────────────────────────────────────────────────────────

  defp try_spawn_node(spec, opts) do
    name = with {n, _} <- spec, do: n

    try do
      spawn_node(spec, opts)
    rescue
      e -> {:error, name, e}
    catch
      :exit, reason -> {:error, name, {:exit, reason}}
    end
  end

  defp spawn_node({name, node_opts}, global_opts) do
    spawn_node(name, Keyword.merge(global_opts, node_opts))
  end

  defp spawn_node(name, opts) do
    short = name |> to_string() |> String.split("@") |> hd() |> String.to_atom()

    cookie =
      case :erlang.get_cookie() do
        :nocookie -> @cookie
        set -> set
      end

    {:ok, peer, node} =
      :peer.start(%{
        name: short,
        connection: 0,
        args: [~c"-setcookie", String.to_charlist("#{cookie}")]
      })

    case setup_peer(peer, opts) do
      :ok ->
        {:ok, node, peer}

      {:error, reason} ->
        stop_peer(peer)
        {:error, name, reason}
    end
  end

  defp setup_peer(peer, opts) do
    adapter = Keyword.get(opts, :adapter, Dojo.Cluster.MDNS.DistAdapter)
    poll_interval = Keyword.get(opts, :poll_interval, 1_000)
    sup_name = @sup_name

    # Add code paths so the remote node can load our modules
    :peer.call(peer, :code, :add_paths, [:code.get_path()])

    # Start minimal required applications
    :peer.call(peer, Application, :ensure_all_started, [:elixir])
    :peer.call(peer, Application, :ensure_all_started, [:logger])
    :peer.call(peer, Application, :ensure_all_started, [:telemetry])

    # Set adapter config
    :peer.call(peer, Application, :put_env, [:dojo, :cluster_adapter, adapter])

    :peer.call(
      peer,
      Kernel,
      :apply,
      [fn -> boot_tree(sup_name, adapter, poll_interval) end, []],
      15_000
    )
  end

  # Runs on the peer. Returns :ok or {:error, term} — never a bare crash,
  # so the reason survives the trip back over :peer.call.
  defp boot_tree(sup_name, adapter, poll_interval) do
    with :ok <- teardown_tree(sup_name) do
      owner = self()
      ref = make_ref()

      # Supervisor.start_link links to its caller, so the tree needs an owner
      # that outlives this transient :peer.call process.
      spawn(fn ->
        result =
          Supervisor.start_link(
            [
              # Before MDNS: init/1 dispatches its boot burst here.
              {Task.Supervisor, name: Dojo.TaskSupervisor},
              {Dojo.Cluster.MDNS, [adapter: adapter, poll_interval: poll_interval]}
            ],
            strategy: :one_for_one,
            name: sup_name
          )

        send(owner, {ref, result})
        if match?({:ok, _}, result), do: Process.sleep(:infinity)
      end)

      receive do
        {^ref, {:ok, _sup}} -> await_registered(Dojo.Cluster.MDNS, 5_000)
        {^ref, {:error, reason}} -> {:error, {:supervisor_start, reason}}
      after
        10_000 -> {:error, :supervisor_start_timeout}
      end
    end
  end

  # Runs on the peer. Supervisor first so nothing can be restarted behind us.
  defp teardown_tree(sup_name) do
    with :ok <- await_down(sup_name) do
      await_down(Dojo.Cluster.MDNS)
    end
  end

  # Wait for the death instead of sleeping past it: the next boot needs both
  # the registered name and UDP 5454 released, and a fixed sleep only
  # usually buys that.
  defp await_down(name) do
    case Process.whereis(name) do
      nil ->
        :ok

      pid ->
        ref = Process.monitor(pid)
        Process.exit(pid, :kill)

        receive do
          {:DOWN, ^ref, :process, ^pid, _} -> :ok
        after
          5_000 -> {:error, {:will_not_die, name}}
        end
    end
  end

  defp await_registered(name, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_await_registered(name, deadline)
  end

  defp do_await_registered(name, deadline) do
    cond do
      is_pid(Process.whereis(name)) -> :ok
      System.monotonic_time(:millisecond) >= deadline -> {:error, {:never_registered, name}}
      true -> Process.sleep(50) && do_await_registered(name, deadline)
    end
  end

  defp stop_peer(peer) do
    :peer.stop(peer)
  catch
    :exit, _ -> :ok
  end
end
