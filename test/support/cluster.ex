defmodule Dojo.Test.Cluster do
  @moduledoc """
  Spawns peer BEAM nodes for distributed mDNS testing.

  Uses OTP 25+ `:peer` module with `connection: 0` (TCP control channel)
  so the test runner doesn't need ERTS distribution enabled (Partisan
  takes over distribution in the Dojo app). Each peer runs only the
  mDNS GenServer with `DistAdapter` — no Partisan, no Phoenix.

  Inspired by `Phoenix.PubSub.Cluster`.
  """

  @sup_name Dojo.Test.MDNSSupervisor

  @doc """
  Spawn peer nodes and start mDNS discovery on each.

  Returns a list of `{node_name, peer_pid}` tuples.

  ## Options

    * `:adapter` — discovery adapter module (default: `DistAdapter`)
    * `:poll_interval` — mDNS poll interval in ms (default: 1_000)
  """
  def spawn_peers(nodes, opts \\ []) do
    nodes
    |> Enum.map(&Task.async(fn -> spawn_node(&1, opts) end))
    |> Enum.map(&Task.await(&1, 30_000))
  end

  @doc "Stop all peer nodes."
  def stop(peers) do
    Enum.each(peers, fn {_node, peer} -> :peer.stop(peer) end)
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

  @doc "Restart the mDNS GenServer on a peer node."
  def restart_mdns(peer, opts \\ []) do
    setup_peer(peer, opts)
  end

  @doc """
  Kill the mDNS GenServer AND its supervisor (no goodbye sent).

  Uses `:kill` signal to bypass `terminate/2`, simulating a crash.
  The supervisor is also killed to prevent automatic restart.
  """
  def kill_mdns(peer) do
    sup_name = @sup_name

    :peer.call(peer, Kernel, :apply, [
      fn ->
        # Kill mDNS first (bypasses terminate/2, no goodbye)
        case Process.whereis(Dojo.Cluster.MDNS) do
          pid when is_pid(pid) -> Process.exit(pid, :kill)
          nil -> :ok
        end

        # Kill the supervisor to prevent restart
        case Process.whereis(sup_name) do
          pid when is_pid(pid) -> Process.exit(pid, :kill)
          nil -> :ok
        end
      end,
      []
    ])
  end

  # ── Private ────────────────────────────────────────────────────────────

  defp spawn_node({name, node_opts}, global_opts) do
    spawn_node(name, Keyword.merge(global_opts, node_opts))
  end

  defp spawn_node(name, opts) do
    short = name |> to_string() |> String.split("@") |> hd() |> String.to_atom()
    cookie = :erlang.get_cookie()

    # connection: 0 — TCP control channel, doesn't require controller to be distributed.
    # This is essential because Partisan disables ERTS distribution on the test runner.
    {:ok, peer, node} =
      :peer.start(%{
        name: short,
        connection: 0,
        args: [~c"-setcookie", String.to_charlist("#{cookie}")]
      })

    setup_peer(peer, opts)
    {node, peer}
  end

  defp setup_peer(peer, opts) do
    adapter = Keyword.get(opts, :adapter, Dojo.Cluster.MDNS.DistAdapter)
    poll_interval = Keyword.get(opts, :poll_interval, 1_000)
    sup_name = @sup_name

    # Add code paths so remote node can load our modules
    :peer.call(peer, :code, :add_paths, [:code.get_path()])

    # Start minimal required applications
    :peer.call(peer, Application, :ensure_all_started, [:elixir])
    :peer.call(peer, Application, :ensure_all_started, [:logger])
    :peer.call(peer, Application, :ensure_all_started, [:telemetry])

    # Set adapter config
    :peer.call(peer, Application, :put_env, [:dojo, :cluster_adapter, adapter])

    # Start the mDNS GenServer under a named supervisor, owned by a persistent process.
    # The persistent process prevents the supervisor from dying when the :peer.call
    # temporary process exits (Supervisor.start_link links to its caller).
    :peer.call(
      peer,
      Kernel,
      :apply,
      [
        fn ->
          # Stop existing supervisor if present (idempotent restart)
          case Process.whereis(sup_name) do
            pid when is_pid(pid) -> Process.exit(pid, :kill)
            nil -> :ok
          end

          # Small delay to let the old supervisor die
          Process.sleep(100)

          spawn(fn ->
            {:ok, _sup} =
              Supervisor.start_link(
                [
                  {Dojo.Cluster.MDNS, [adapter: adapter, poll_interval: poll_interval]}
                ],
                strategy: :one_for_one,
                name: sup_name
              )

            Process.sleep(:infinity)
          end)

          # Wait for GenServer to register
          wait_for_process(Dojo.Cluster.MDNS, 5_000)
        end,
        []
      ],
      15_000
    )
  end

  defp wait_for_process(name, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_wait(name, deadline)
  end

  defp do_wait(name, deadline) do
    case Process.whereis(name) do
      pid when is_pid(pid) ->
        :ok

      nil ->
        if System.monotonic_time(:millisecond) < deadline do
          Process.sleep(50)
          do_wait(name, deadline)
        else
          {:error, :timeout}
        end
    end
  end
end
