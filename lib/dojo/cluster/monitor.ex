# lib/partisan/network_monitor.ex
defmodule Dojo.Partisan.NetworkMonitor do
  @moduledoc """
  Monitors local interface changes and updates Partisan's advertised
  listen_addrs dynamically without restarting the peer service.

  The TCP acceptor is bound to 0.0.0.0 and survives all roams.
  Only the advertised spec needs updating — which flows through
  partisan_config → partisan:node_spec() → HyParView shuffle gossip.
  """
  use GenServer
  require Logger

  @check_interval 5_000

  def start_link(opts \\ []),
    do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    addrs = current_routable_addrs()
    Logger.info("[NetworkMonitor] initial addrs: #{inspect(addrs)}")
    schedule_check()
    {:ok, %{addrs: addrs}}
  end

  @impl true
  def handle_info(:check, %{addrs: prev_addrs} = state) do
    current_addrs = current_routable_addrs()

    state =
      if MapSet.equal?(prev_addrs, current_addrs) do
        state
      else
        added   = MapSet.difference(current_addrs, prev_addrs)
        removed = MapSet.difference(prev_addrs, current_addrs)
        Logger.warning("[NetworkMonitor] IP change — +#{inspect(MapSet.to_list(added))} " <>
                       "-#{inspect(MapSet.to_list(removed))}")

        handle_ip_change(current_addrs)
        %{state | addrs: current_addrs}
      end

    schedule_check()
    {:noreply, state}
  end

  # ── IP change handler ────────────────────────────────────────────────────────

  defp handle_ip_change(new_addrs) do
    port = partisan_port()

    # 1. Update partisan_config so partisan:node_spec() returns fresh IPs.
    #    This is read live on every shuffle/neighbor_request — no restart needed.
    new_listen_addrs = new_addrs |> MapSet.to_list() |> Enum.map(&%{ip: &1, port: port})
    :partisan_config.set(:listen_addrs, new_listen_addrs)

    Logger.info("[NetworkMonitor] partisan_config listen_addrs updated: " <>
                "#{inspect(new_listen_addrs)}")

    # 2. Push fresh node_spec into the membership CRDT immediately.
    #    state_awmap deduplicates by node() name — old IP spec is pruned.
    #    Do NOT call join/1 — that creates a new membership entry.
    #    update_members reconciles the existing entry with fresh spec.
    case :partisan_peer_service.members() do
      {:ok, current_members} ->
        own_spec = :partisan.node_spec()
        fresh_members = [own_spec | current_members]
        :ok = :partisan_peer_service.update_members(fresh_members)
        Logger.info("[NetworkMonitor] membership CRDT updated with fresh spec")

      {:error, reason} ->
        Logger.warning("[NetworkMonitor] could not read members for update: #{inspect(reason)}")
    end

    # 3. If any peer has {0,0,0,0} in their stored spec (the Windows bug),
    #    force a reconnect attempt with whatever IP we last saw them on via mDNS.
    # This is handled by the discovery agent's next poll cycle — nothing to do here.
  end

  # ── Helpers ──────────────────────────────────────────────────────────────────

  defp current_routable_addrs do
    # Use routing-table method first — most accurate on Windows/macOS/Linux
    primary = routing_table_addr()

    enumerated =
      case :inet.getifaddrs() do
        {:ok, ifaddrs} ->
          ifaddrs
          |> Enum.flat_map(fn {_name, opts} ->
            flags = Keyword.get(opts, :flags, [])
            if :up in flags and :loopback not in flags do
              Keyword.get_values(opts, :addr)
            else
              []
            end
          end)
          |> Enum.filter(fn
            {127, _, _, _}          -> false
            {169, 254, _, _}        -> false
            {a, _, _, _} when is_integer(a) -> true
            _                       -> false
          end)
        _ -> []
      end

    all = if primary, do: [primary | enumerated], else: enumerated
    all |> Enum.uniq() |> MapSet.new()
  end

  # Connect a UDP socket to the mDNS group — kernel assigns correct src IP.
  # Zero packets sent. Works correctly on Windows where enumeration lies.
  defp routing_table_addr do
    case :gen_udp.open(0, [:inet, active: false]) do
      {:ok, sock} ->
        result =
          case :gen_udp.connect(sock, {224, 0, 0, 251}, 5353) do
            :ok ->
              case :inet.sockname(sock) do
                {:ok, {ip, _}} when ip != {0, 0, 0, 0} -> ip
                _ -> nil
              end
            _ -> nil
          end
        :gen_udp.close(sock)
        result
      _ -> nil
    end
  end

  defp partisan_port do
    case System.get_env("PARTISAN_PORT") do
      s when is_binary(s) ->
        case Integer.parse(s) do
          {n, ""} when n > 0 and n < 65536 -> n
          _ -> 9090
        end
      _ -> 9090
    end
  end

  defp schedule_check, do: Process.send_after(self(), :check, @check_interval)
end
