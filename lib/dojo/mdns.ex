defmodule Dojo.Discovery.MdnsBridge do
  require Logger

  # Called by mdns_lite lib when a service is found
  def handle_event(:add, service) do
    # 1. Extract details from the mDNS record
    # The UUID is hidden in the TXT record "uuid=..."
    uuid = get_txt_value(service.txt, "uuid")
    ip = service.ip
    port = service.port

    if uuid && ip do
       # 2. Forward to the Strategy GenServer
       send(Dojo.Cluster, {:peer_discovered, uuid, ip, port})
    else
       Logger.debug("Dojo: Ignored mDNS record without UUID.")
    end
  end

  # Handle removal (optional - HyParView handles failure naturally)
  def handle_event(:remove, _service), do: :ok
  def handle_event(:update, _service), do: :ok

  defp get_txt_value(txt_list, key) do
    IO.inspect(txt_list)
    prefix = "#{key}="
    Enum.find_value(txt_list, fn entry ->
      str = List.to_string(entry)
      if String.starts_with?(str, prefix) do
        String.replace_prefix(str, prefix, "")
      else
        nil
      end
    end)
  end
end
