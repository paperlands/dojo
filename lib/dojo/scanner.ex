defmodule Dojo.Discovery.Scanner do
  use GenServer
  require Logger

  # Scan every 5 seconds (Trade-off: Latency vs Battery)
  @interval 5_000
  @service_domain "_dojo_cluster._tcp.local"
  # The Local DNS Bridge IP (Must match config)
  @dns_server {{127, 0, 0, 53}, 1212}

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  def init(_) do
    # Start the heartbeat
    schedule_scan()
    {:ok, %{last_scan: []}}
  end

  def handle_info(:scan, state) do
    # 1. Perform the Deep Scan
    found_peers = scan_network()
    
    # 2. Notify Bridge for each valid peer
    Enum.each(found_peers, fn peer ->
      # Convert to the struct expected by your Bridge
      service_struct = %{
        ip: peer.ip,
        port: peer.port,
        txt: peer.txt,
        domain: peer.domain
      }
      Dojo.Discovery.MdnsBridge.handle_event(:add, service_struct)
    end)

    schedule_scan()
    {:noreply, %{last_scan: found_peers}}
  end

  # --- DNS-SD Implementation ---

  defp scan_network do
    
    # Step 1: Query PTR records (Find all instances of our service)
    # We explicitly use the local bridge to ensure we hit MdnsLite
    case dns_query(@service_domain, :ptr) do
      {:ok, domain_names} ->
        # Step 2: Resolve details for each instance (Parallel-ish)
        Enum.map(domain_names, &resolve_peer/1)
        |> Enum.reject(&is_nil/1)
      
      _ -> []
    end
  end

  defp resolve_peer(domain_charlist) do
    domain = List.to_string(domain_charlist)

    # We need SRV (Port/Target), TXT (Metadata), and A (IP)
    with {:ok, {target, port}} <- get_srv(domain_charlist),
         {:ok, txt_records} <- get_txt(domain_charlist),
         {:ok, ip} <- get_a_record(target) do
      
      %{
        domain: domain,
        port: port,
        txt: txt_records, # List of charlists ["uuid=...", "ver=1"]
        ip: ip
      }
    else
      _ -> nil # Skip incomplete records
    end
  end

  # --- DNS Helpers (using :inet_res) ---

  defp dns_query(domain, type) do
    # Use :inet_res.lookup/3 targeting our Bridge specifically
    # to avoid OS resolver caching issues
    options = [nameservers: [@dns_server]]
    
    case :inet_res.lookup(to_charlist(domain), :in, type, options) do
      [] -> {:error, :not_found}
      results -> {:ok, results}
    end
  end

  defp get_srv(domain) do
    case dns_query(domain, :srv) do
      {:ok, [{_prio, _weight, port, target} | _]} -> {:ok, {target, port}}
      _ -> :error
    end
  end

  defp get_txt(domain) do
    # TXT records come back as list of charlists
    dns_query(domain, :txt)
  end

  defp get_a_record(target) do
    case dns_query(target, :a) do
      {:ok, [ip | _]} -> {:ok, ip}
      _ -> :error
    end
  end

  defp schedule_scan, do: Process.send_after(self(), :scan, @interval)
end
