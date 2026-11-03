defmodule Dojo.Cluster.NetworkMonitor do
  @moduledoc """
  Monitors network interface changes and hot-swaps Partisan's listen_addrs.

  When the node roams (WiFi hop, hotspot change), this process:
  1. Detects the new set of routable IPs
  2. Updates partisan_config:listen_addrs so node_spec() advertises correctly
  3. Restarts the Partisan peer_service_server listeners on new IPs
  4. Triggers an immediate mDNS re-announcement on the new interfaces
  5. Publishes the current HTTP endpoint whenever it moves, which can happen
     with the socket set unchanged (interface order, proxy host)

  Does NOT restart the node, the BEAM, or the Partisan application.
  """
  use GenServer
  require Logger

  # 3s — fast enough for WiFi hops, cheap enough for constrained devices
  @poll_interval 3_000
  # Require N consecutive polls with same new IPs before triggering change.
  # Absorbs transient WiFi flaps without delaying genuine roaming too much.
  @debounce_stable_count 2

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    port = partisan_port()

    # ips: nil means "not read yet" — the first successful poll adopts it as
    # baseline instead of mistaking it for a roam.
    current_ips =
      case read_ips() do
        {:ok, ips} -> ips
        :unavailable -> nil
      end

    Logger.info("[NetworkMonitor] init — IPs=#{fmt_ips(current_ips)} port=#{port}")

    # Seed addr cache so Gate.routable_addr/0 reads from cache instead of live
    # syscall. Skipping the seed is safe — Gate falls back to computing it live.
    seed_addr =
      case read_addr() do
        {:ok, addr} ->
          :persistent_term.put({Dojo.Gate, :addr}, addr)
          Logger.info("[NetworkMonitor] seeded addr=#{addr}")
          addr

        :unavailable ->
          Logger.debug("[NetworkMonitor] addr seed skipped — module reloading")
          nil
      end

    schedule_poll()

    {:ok, %{ips: current_ips, addr: seed_addr, port: port, pending: nil, stable_count: 0}}
  end

  @impl true
  def handle_info(:poll, state) do
    state =
      case read_ips() do
        {:ok, new_ips} -> debounce_ip_change(new_ips, state)
        :unavailable -> state
      end

    schedule_poll()
    {:noreply, state}
  end

  # The socket set and the advertised endpoint are different facts, and they can
  # change independently: interface order flips the address while the set stays
  # the same, and no event would otherwise fire. Both are compared and debounced.
  defp debounce_ip_change(new_ips, state) do
    case read_addr() do
      {:ok, new_addr} -> debounce_route(new_ips, new_addr, state)
      :unavailable -> state
    end
  end

  # init couldn't read interfaces — adopt the first real reading as the
  # baseline rather than hot-swapping Partisan against a phantom change.
  defp debounce_route(new_ips, new_addr, %{ips: nil} = state) do
    Logger.info(
      "[NetworkMonitor] baseline adopted — IPs=#{fmt_ips(new_ips)} addr=#{fmt_addr(new_addr)}"
    )

    %{state | ips: new_ips, addr: new_addr, pending: nil, stable_count: 0}
  end

  defp debounce_route(new_ips, new_addr, %{ips: old_ips, addr: old_addr} = state) do
    seen = {MapSet.new(new_ips), new_addr}

    cond do
      # No change — reset any pending debounce
      transition(old_ips, old_addr, new_ips, new_addr) == :none ->
        %{state | pending: nil, stable_count: 0}

      # Same observation seen again — increment stable count
      state.pending == seen ->
        confirm_change(state, old_ips, old_addr, new_ips, new_addr)

      # New observation (or different from pending) — start fresh debounce
      true ->
        Logger.debug("[NetworkMonitor] change detected, starting debounce")
        %{state | pending: seen, stable_count: 1}
    end
  end

  # @debounce_stable_count identical observations are required before acting.
  # The baseline moves only on success: a failed bind must leave the old one in
  # place so the next poll re-detects the change instead of cancelling the retry.
  defp confirm_change(state, old_ips, old_addr, new_ips, new_addr) do
    count = state.stable_count + 1

    if count < @debounce_stable_count do
      Logger.debug("[NetworkMonitor] debouncing change, stable_count=#{count}")
      %{state | stable_count: count}
    else
      Logger.warning(
        "[NetworkMonitor] change confirmed after #{count} polls: " <>
          "IPs #{inspect(Enum.map(old_ips, &fmt/1))} → " <>
          "#{inspect(Enum.map(new_ips, &fmt/1))}, " <>
          "addr #{fmt_addr(old_addr)} → #{fmt_addr(new_addr)}"
      )

      case apply_transition(old_ips, old_addr, new_ips, new_addr, state.port) do
        :ok -> %{state | ips: new_ips, addr: new_addr, pending: nil, stable_count: 0}
        :error -> %{state | pending: nil, stable_count: 0}
      end
    end
  end

  @doc false
  # Which action a confirmed observation licenses. Pure so the policy is testable
  # without sockets: an empty reading is a transient to hold, never an instruction
  # to unbind and advertise localhost.
  def transition(old_ips, old_addr, new_ips, new_addr) do
    cond do
      MapSet.new(old_ips) == MapSet.new(new_ips) and old_addr == new_addr -> :none
      new_ips == [] -> :hold
      MapSet.new(old_ips) == MapSet.new(new_ips) -> :addr_only
      true -> :rebind
    end
  end

  defp apply_transition(old_ips, old_addr, new_ips, new_addr, port) do
    case transition(old_ips, old_addr, new_ips, new_addr) do
      :none ->
        :ok

      :hold ->
        Logger.warning(
          "[NetworkMonitor] no routable interface seen; keeping #{fmt_addr(old_addr)} and retrying"
        )

        :error

      :addr_only ->
        # The sockets did not move, so listeners and the mDNS announcement stand.
        # Only who peers are told to talk to changes.
        publish_addr(new_addr)

      :rebind ->
        handle_ip_change(new_ips, old_ips, port, new_addr)
    end
  end

  # ── The critical hot-swap sequence ──────────────────────────────────────

  # Bind and accept first, publish second, withdraw the old announcement last
  # (D069). Publishing before the bind advertises an endpoint that may never have
  # existed; withdrawing before the bind leaves us unreachable if the bind fails.
  defp handle_ip_change(new_ips, old_ips, port, new_addr) do
    t0 = System.monotonic_time(:millisecond)
    step = fn label ->
      Logger.warning("[NetworkMonitor] step #{label} +#{System.monotonic_time(:millisecond) - t0}ms")
    end

    new_addrs = Enum.map(new_ips, fn ip -> %{ip: ip, port: port} end)
    old_addrs = Enum.map(old_ips, fn ip -> %{ip: ip, port: port} end)

    # The listener reads `listen_addrs` when it starts, so the config moves with
    # the bind and is reverted with it if the bind fails.
    :partisan_config.set(:listen_addrs, new_addrs)
    Logger.warning("[NetworkMonitor] listen_addrs → #{inspect(new_addrs)}")
    step.("config set")

    case restart_listeners() do
      :ok ->
        step.("listeners rebound")

        case refresh_hyparview_node_spec() do
          :ok ->
            step.("spec refreshed")
            # The new endpoint exists, is bound, and is now advertised. Only now
            # may the old announcement be withdrawn.
            Dojo.Cluster.MDNS.goodbye(old_ips)

            # No disconnect here. The peer learns our new spec while its old
            # connections still stand; killing them first pins the old spec at
            # the zero-to-one connection transition (D068, spike F1-kill).
            adapter = Application.get_env(:dojo, :cluster_adapter)

            if function_exported?(adapter, :on_network_change, 0),
              do: adapter.on_network_change()

            GenServer.cast(Dojo.Cluster.MDNS, {:rejoin_multicast, old_ips, new_ips})
            Dojo.Cluster.MDNS.reannounce(new_ips)

            step.("reannounced")

            publish_addr(new_addr)

          :error ->
            # Bound on the new addresses but unable to advertise them. Keep the
            # old advertisement (peers can still reach the old listener if it is
            # still up), revert the config, and retry the whole transition.
            :partisan_config.set(:listen_addrs, old_addrs)
            _ = restart_listeners()

            Logger.error(
              "[NetworkMonitor] spec refresh failed; old addresses kept, config reverted, " <>
                "transition will retry"
            )

            :error
        end

      :error ->
        # Nothing was bound and nothing was advertised (D069.2). Put the old
        # binding back so we do not strand ourselves on a failed transition.
        :partisan_config.set(:listen_addrs, old_addrs)
        _ = restart_listeners()

        Logger.warning(
          "[NetworkMonitor] listener bind failed; old config restored and rebound, " <>
            "transition will retry next poll"
        )

        :error
    end
  end

  # One place makes a resolved address current: the cache Gate reads, then the
  # local presence refresh. Called for a rebind and for an address-only change.
  defp publish_addr(new_addr) do
    :persistent_term.put({Dojo.Gate, :addr}, new_addr)

    if Application.get_env(:dojo, :routing_strategy) == Dojo.Cluster.Routing.Local do
      Phoenix.PubSub.local_broadcast(
        Dojo.PubSub,
        "system:network",
        {:network_change, new_addr}
      )

      Logger.info("[NetworkMonitor] addr updated → #{new_addr}, broadcast to system:network")
    else
      Logger.info("[NetworkMonitor] addr updated → #{new_addr}")
    end

    :ok
  end

  # A refresh that did not happen is not success (D069.3). `{error,
  # not_implemented}` from a Partisan without the patch, an exit, or an unknown
  # term all mean the node is still advertising its boot-time address, and that
  # is a warning an operator has to see.
  defp refresh_hyparview_node_spec do
    case GenServer.call(:partisan_hyparview_peer_service_manager, :refresh_node_spec, 5_000) do
      :updated ->
        Logger.info("[NetworkMonitor] hyparview node_spec refreshed")
        :ok

      :unchanged ->
        :ok

      other ->
        Logger.warning(
          "[NetworkMonitor] hyparview node_spec NOT refreshed: #{inspect(other)}; " <>
            "this node is still advertising its boot-time addresses"
        )

        :error
    end
  catch
    kind, reason ->
      Logger.warning(
        "[NetworkMonitor] hyparview node_spec refresh failed: #{inspect({kind, reason})}; " <>
          "this node is still advertising its boot-time addresses"
      )

      :error
  end

  defp restart_listeners do
    # The acceptor pool is the TCP listener that binds to listen_addrs.
    # Restarting it forces rebind on the new IPs from partisan_config.
    # The HyParView manager (under partisan_peer_service_sup) is left alone —
    # its membership state (active/passive views) survives the listener restart.
    try do
      Logger.warning("[NetworkMonitor] terminating acceptor pool")
      case Supervisor.terminate_child(:partisan_sup, :partisan_acceptor_socket_pool_sup) do
        :ok ->
          Logger.warning("[NetworkMonitor] restarting acceptor pool")
          case Supervisor.restart_child(:partisan_sup, :partisan_acceptor_socket_pool_sup) do
            {:ok, pid} ->
              Logger.info("[NetworkMonitor] acceptor pool restarted → #{inspect(pid)}")
              :ok

            {:error, reason} ->
              Logger.error("[NetworkMonitor] acceptor pool restart failed: #{inspect(reason)}")
              :error
          end

        {:error, reason} ->
          Logger.error("[NetworkMonitor] acceptor pool terminate failed: #{inspect(reason)}")
          :error
      end
    rescue
      e ->
        Logger.error("[NetworkMonitor] listener restart error: #{inspect(e)}")
        :error
    end
  end

  # ── Helpers ─────────────────────────────────────────────────────────────

  defp partisan_port do
    case :partisan_config.get(:listen_addrs) do
      [%{port: p} | _] -> p
      _ -> 9090
    end
  end

  # Dev code reload purges a module before recompiling it, so a sibling can be
  # briefly absent. A poll that lands in that window skips the tick; it must
  # never kill this process, because a failed init would burn the restart budget.
  @reloadable [Dojo.Cluster.MDNS, Dojo.Cluster.Routing, Dojo.Cluster.Routing.Local]

  defp read_ips do
    {:ok, Dojo.Cluster.MDNS.routable_ipv4_addrs()}
  rescue
    e in UndefinedFunctionError -> mid_reload(e, __STACKTRACE__)
  end

  defp read_addr do
    {:ok, Dojo.Cluster.Routing.routable_addr()}
  rescue
    e in UndefinedFunctionError -> mid_reload(e, __STACKTRACE__)
  end

  # Only a purged sibling is tolerated; any other undefined call is a real bug.
  defp mid_reload(%UndefinedFunctionError{module: mod} = e, stacktrace) do
    if mod in @reloadable, do: :unavailable, else: reraise(e, stacktrace)
  end

  defp schedule_poll, do: Process.send_after(self(), :poll, @poll_interval)

  defp fmt_ips(nil), do: "unread"
  defp fmt_ips(ips), do: inspect(Enum.map(ips, &fmt/1))
  defp fmt(ip), do: ip |> :inet.ntoa() |> to_string()
  defp fmt_addr(nil), do: "unread"
  defp fmt_addr(addr), do: addr
end
