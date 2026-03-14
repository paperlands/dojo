defmodule Dojo.Cluster.MDNS.Responder do
  @moduledoc """
  Listens for inbound mDNS PTR queries and replies immediately
  with our announcement. This eliminates the dependency on polling
  cycle alignment for initial discovery.

  Runs on a separate socket with active mode so it responds
  within milliseconds of receiving a query, rather than waiting
  up to 5s for the next lookup cycle.
  """
  use GenServer
  require Logger

  @mdns_addr {224, 0, 0, 251}
  @mdns_port 5353
  @type_ptr  12

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    service = Application.get_env(:partisan, :peer_discovery, %{})
              |> get_in([:config, :service]) || "_erlang._tcp.local"

    # Open a SEPARATE socket in active mode for reactive responses.
    # The Discovery agent keeps its own passive socket for lookup cycles.
    opts = [
      :binary,
      active: true,
      reuseaddr: true,
      multicast_loop: true,
      multicast_ttl: 255,
      ip: {0, 0, 0, 0}
    ]

    opts = case :gen_udp.open(0, [reuseport: true]) do
      {:ok, s} -> :gen_udp.close(s); [{:reuseport, true} | opts]
      _ -> opts
    end

    case :gen_udp.open(@mdns_port, opts) do
      {:ok, socket} ->
        join_multicast(socket)
        Logger.info("[mDNS:Responder] listening for queries on *:#{@mdns_port}")
        {:ok, %{socket: socket, service: service}}

      {:error, reason} ->
        Logger.warning("[mDNS:Responder] could not open socket: #{inspect(reason)}")
        # Non-fatal — discovery still works via polling, just slower
        {:ok, %{socket: nil, service: service}}
    end
  end

  # ── Incoming UDP packet ──────────────────────────────────────────────
  @impl true
  def handle_info({:udp, _sock, src_ip, _src_port, raw}, state) do
    case is_ptr_query?(raw, state.service) do
      true ->
        # Someone is looking for our service — announce immediately
        Logger.debug("[mDNS:Responder] query from #{fmt(src_ip)}, replying")
        send_announcement(state)
      false ->
        :ok
    end
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # ── Detect PTR queries for our service ───────────────────────────────
  defp is_ptr_query?(raw, service) do
    case Dojo.Cluster.MDNS.Packet.decode(raw) do
      {:ok, _records} ->
        # Check if this is a query (not a response) for our service
        # Quick check: byte 2-3 are flags. QR bit (bit 15) = 0 means query.
        case raw do
          <<_id::16, 0::1, _::15, qdcount::16, _::binary>> when qdcount > 0 ->
            # Has questions, QR=0 → it's a query. Check if it's for our service.
            check_question_names(raw, service)
          _ -> false
        end
      _ -> false
    end
  end

  defp check_question_names(raw, service) do
    try do
      # Skip 12-byte header
      <<_header::binary-size(12), rest::binary>> = raw
      {qname, _rest} = Dojo.Cluster.MDNS.Packet.read_name(raw, rest)
      # Check if the question is for our service type
      String.ends_with?(qname, service) or qname == service
    rescue
      _ -> false
    end
  end

  # ── Send our announcement out every routable interface ───────────────
  defp send_announcement(%{socket: nil}), do: :ok
  defp send_announcement(%{socket: sock, service: service}) do
    own_name = partisan_own_name()
    own_port = partisan_own_port()
    name_str = Atom.to_string(own_name)

    routable_ipv4_addrs()
    |> Enum.each(fn ip ->
      :inet.setopts(sock, [{:multicast_if, ip}])
      pkt = Dojo.Cluster.MDNS.Packet.announcement(service, name_str, ip, 120, own_port)
      :gen_udp.send(sock, @mdns_addr, @mdns_port, pkt)
    end)
  end

  # ── Jitter to avoid announcement storms ──────────────────────────────
  # When multiple nodes query simultaneously (e.g., at boot), stagger
  # responses to avoid packet collision on the multicast group.
  # Not implemented yet but the hook is here.

  # ── Helpers (same as Discovery module) ───────────────────────────────
  defp join_multicast(socket) do
    routable_ipv4_addrs()
    |> Enum.each(fn ip ->
      :inet.setopts(socket, [{:add_membership, {@mdns_addr, ip}}])
    end)
  end

  defp routable_ipv4_addrs do
    case :inet.getifaddrs() do
      {:ok, ifaddrs} ->
        ifaddrs
        |> Enum.reject(fn {iface, _} ->
          name = to_string(iface)
          String.starts_with?(name, "docker") or
          String.starts_with?(name, "br-") or
          String.starts_with?(name, "veth") or
          String.starts_with?(name, "lo")
        end)
        |> Enum.flat_map(fn {_, opts} -> Keyword.get_values(opts, :addr) end)
        |> Enum.filter(fn
          {127, _, _, _}   -> false
          {169, 254, _, _} -> false
          {a, _, _, _} when is_integer(a) -> true
          _                -> false
        end)
        |> Enum.uniq()
      _ -> []
    end
  end

  defp partisan_own_name do
    case System.get_env("PARTISAN_NAME") do
      s when is_binary(s) and s != "" -> String.to_atom(s)
      _ -> Application.get_env(:partisan, :name, node())
    end
  end

  defp partisan_own_port do
    case System.get_env("PARTISAN_PORT") do
      s when is_binary(s) ->
        case Integer.parse(s) do
          {n, ""} when n > 0 and n < 65536 -> n
          _ -> 9090
        end
      _ -> 9090
    end
  end

  defp fmt(ip), do: ip |> :inet.ntoa() |> to_string()
end
