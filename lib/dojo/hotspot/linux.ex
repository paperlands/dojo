defmodule Dojo.Hotspot.Linux do
  @moduledoc """
  Linux hotspot management via nmcli / NetworkManager.

  Pre-flight sequence before hotspot creation:
  1. Verify dnsmasq is available (NM needs it for DHCP in AP mode)
  2. Clean up stale Hotspot connection profiles
  3. Disconnect WiFi interface if currently connected
  """

  require Logger

  # ── Public API ───────────────────────────────────────────────────────

  @spec start(String.t(), String.t()) :: :ok | {:error, term()}
  def start(ssid, password) do
    with {:ok, iface} <- detect_wifi_interface(),
         exe when exe != nil <- System.find_executable("nmcli"),
         :ok <- prepare(iface) do
      case attempt_hotspot(exe, iface, ssid, password) do
        :ok ->
          :ok

        {:error, :ip_config_failed} ->
          Logger.info("[Hotspot] retrying after ip_config_failed")

          with :ok <- prepare(iface) do
            attempt_hotspot(exe, iface, ssid, password)
          end

        {:error, _} = err ->
          err
      end
    else
      nil -> {:error, :nmcli_not_found}
      {:error, _} = err -> err
    end
  end

  @spec stop() :: :ok | {:error, term()}
  def stop do
    case System.find_executable("nmcli") do
      nil ->
        {:error, :nmcli_not_found}

      exe ->
        # Grab the interface BEFORE we tear down — status returns nil after
        iface =
          case status() do
            {:ok, %{active: true, interface: iface}} -> iface
            _ -> nil
          end

        result =
          case System.cmd(exe, ["-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"],
                stderr_to_stdout: true
              ) do
            {output, 0} ->
              hotspot_names =
                output
                |> String.split("\n", trim: true)
                |> Enum.filter(&String.starts_with?(&1, "Hotspot"))
                |> Enum.map(fn line -> line |> String.split(":") |> hd() end)

              case hotspot_names do
                [] ->
                  Logger.info("[Hotspot] no active hotspot to stop")
                  :ok

                names ->
                  results =
                    Enum.map(names, fn name ->
                      case System.cmd(exe, ["connection", "down", name], stderr_to_stdout: true) do
                        {_, 0} ->
                          Logger.info("[Hotspot] stopped #{name}")
                          :ok

                        {out, _} ->
                          Logger.warning("[Hotspot] stop #{name} failed: #{out}")
                          {:error, :stop_failed}
                      end
                    end)

                  if Enum.all?(results, &(&1 == :ok)), do: :ok, else: {:error, :stop_failed}
              end

            {_, _} ->
              case System.cmd(exe, ["connection", "down", "Hotspot"], stderr_to_stdout: true) do
                {_, 0} -> :ok
                _ -> {:error, :stop_failed}
              end
          end

        # Re-enable autoconnect regardless of stop result — best effort, non-fatal
        if iface, do: reenable_autoconnect(exe, iface)

        result
    end
  end

  @spec status() :: {:ok, map()} | {:error, term()}
  def status do
    case System.find_executable("nmcli") do
      nil ->
        {:error, :nmcli_not_found}

      exe ->
        case System.cmd(exe, ["-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"],
               stderr_to_stdout: true
             ) do
          {output, 0} ->
            hotspot_line =
              output
              |> String.split("\n", trim: true)
              |> Enum.find(&String.starts_with?(&1, "Hotspot"))

            if hotspot_line do
              [_name, _type, device] = String.split(hotspot_line, ":")
              ip = get_ip(exe, device)
              {:ok, %{active: true, ssid: get_ssid(exe), interface: device, ip: ip}}
            else
              {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
            end

          {_, _} ->
            {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
        end
    end
  end

  @spec detect_wifi_interface() :: {:ok, String.t()} | {:error, term()}
  def detect_wifi_interface do
    case System.find_executable("nmcli") do
      nil ->
        detect_wifi_sysfs()

      exe ->
        case System.cmd(exe, ["-t", "-f", "DEVICE,TYPE", "device", "status"],
               stderr_to_stdout: true
             ) do
          {output, 0} ->
            output
            |> String.split("\n", trim: true)
            |> Enum.find_value(fn line ->
              case String.split(line, ":") do
                [device, "wifi"] -> {:ok, device}
                _ -> nil
              end
            end) || {:error, :no_wifi}

          _ ->
            detect_wifi_sysfs()
        end
    end
  end

  @spec connected_ssid(String.t()) :: String.t() | nil
  def connected_ssid(iface) do
    case System.find_executable("nmcli") do
      nil ->
        nil

      exe ->
        case System.cmd(exe, ["-t", "-f", "GENERAL.CONNECTION", "device", "show", iface],
               stderr_to_stdout: true
             ) do
          {output, 0} ->
            output
            |> String.split("\n", trim: true)
            |> Enum.find_value(fn line ->
              case String.split(line, ":", parts: 2) do
                ["GENERAL.CONNECTION", name] ->
                  name = String.trim(name)
                  if name != "" and name != "--", do: name

                _ ->
                  nil
              end
            end)

          _ ->
            nil
        end
    end
  end

  # ── Pre-flight ───────────────────────────────────────────────────────

  defp prepare(iface) do
    with :ok <- check_dnsmasq(),
         :ok <- cleanup_stale_profiles(),
         :ok <- disconnect_interface(iface) do
      :ok
    end
  end

  defp check_dnsmasq do
    cond do
      System.find_executable("dnsmasq") != nil ->
        :ok

      Path.wildcard("/usr/lib/NetworkManager/conf.d/*dnsmasq*") != [] ->
        :ok

      Path.wildcard("/etc/NetworkManager/conf.d/*dnsmasq*") != [] ->
        :ok

      true ->
        Logger.warning("[Hotspot] dnsmasq not found — required for hotspot DHCP")
        {:error, :dnsmasq_not_found}
    end
  end

  defp cleanup_stale_profiles do
    case System.find_executable("nmcli") do
      nil ->
        :ok

      exe ->
        case System.cmd(exe, ["-t", "-f", "NAME,UUID", "connection", "show"],
               stderr_to_stdout: true
             ) do
          {output, 0} ->
            output
            |> String.split("\n", trim: true)
            |> Enum.filter(fn line ->
              case String.split(line, ":", parts: 2) do
                [name, _uuid] -> String.starts_with?(name, "Hotspot")
                _ -> false
              end
            end)
            |> Enum.each(fn line ->
              [name, uuid] = String.split(line, ":", parts: 2)
              Logger.info("[Hotspot] deleting stale profile: #{name} (#{uuid})")

              case System.cmd(exe, ["connection", "delete", uuid], stderr_to_stdout: true) do
                {_, 0} -> :ok
                {out, _} -> Logger.warning("[Hotspot] delete #{name} failed: #{out}")
              end
            end)

            :ok

          _ ->
            :ok
        end
    end
  end

  defp disconnect_interface(iface) do
    case System.find_executable("nmcli") do
      nil -> :ok
      exe ->
        case System.cmd(exe, ["-t", "-f", "DEVICE,STATE", "device", "status"],
              stderr_to_stdout: true) do
          {output, 0} ->
            connected? =
              output
              |> String.split("\n", trim: true)
              |> Enum.any?(fn line ->
              case String.split(line, ":") do
                [^iface, "connected"] -> true
                _ -> false
              end
            end)

            if connected? do
              Logger.info("[Hotspot] disconnecting #{iface} from current network")

              with {_, 0} <- System.cmd(exe, ["device", "disconnect", iface],
                        stderr_to_stdout: true),
                   # --- KEY FIX: suppress autoconnect before NM races us ---
                   {_, 0} <- System.cmd(exe, ["device", "set", iface, "autoconnect", "no"],
                     stderr_to_stdout: true) do
                Process.sleep(1_500)
                :ok
              else
                {out, _} ->
                  Logger.warning("[Hotspot] failed to disconnect/suppress #{iface}: #{out}")
                {:error, :interface_busy}
              end
            else
              # Still suppress autoconnect even if not currently connected
              System.cmd(exe, ["device", "set", iface, "autoconnect", "no"],
                stderr_to_stdout: true)
              :ok
            end

          _ -> :ok
        end
    end
  end


  defp reenable_autoconnect(exe, iface) do
    case System.cmd(exe, ["device", "set", iface, "autoconnect", "yes"],
          stderr_to_stdout: true) do
      {_, 0} -> :ok
      {out, _} ->
        Logger.warning("[Hotspot] failed to re-enable autoconnect on #{iface}: #{out}")
        :ok  # non-fatal
    end
  end
  # ── Helpers ──────────────────────────────────────────────────────────

  # Try with 2.4GHz band + channel 6 for maximum client compatibility,
  # then fall back to band-only, then no band constraint.
  defp attempt_hotspot(exe, iface, ssid, password) do
    base_args = [
      "device",
      "wifi",
      "hotspot",
      "ifname",
      iface,
      "con-name",
      "Hotspot",
      "ssid",
      ssid,
      "password",
      password
    ]

    # Preferred: 2.4GHz channel 6 (widest compatibility)
    case run_hotspot(exe, base_args ++ ["band", "bg", "channel", "6"]) do
      {:ok, _} ->
        Logger.info("[Hotspot] started on #{iface} ssid=#{ssid} band=2.4GHz ch=6")
        :ok

      {:error, :band_not_supported} ->
        # Fallback: 2.4GHz without pinning channel
        Logger.info("[Hotspot] ch6 failed, retrying band=bg only")

        case run_hotspot(exe, base_args ++ ["band", "bg"]) do
          {:ok, _} ->
            Logger.info("[Hotspot] started on #{iface} ssid=#{ssid} band=2.4GHz")
            :ok

          {:error, :band_not_supported} ->
            # Last resort: let hardware pick
            Logger.info("[Hotspot] band=bg failed, retrying without band constraint")

            case run_hotspot(exe, base_args) do
              {:ok, _} ->
                Logger.info("[Hotspot] started on #{iface} ssid=#{ssid} (auto band)")
                :ok

              {:error, _} = err ->
                err
            end

          {:error, _} = err ->
            err
        end

      {:error, _} = err ->
        err
    end
  end

  defp run_hotspot(exe, args) do
    case System.cmd(exe, args, stderr_to_stdout: true) do
      {_, 0} ->
        {:ok, :started}

      {output, code} ->
        Logger.warning("[Hotspot] nmcli hotspot failed (#{code}): #{output}")
        parse_error(output)
    end
  end

  defp detect_wifi_sysfs do
    case Path.wildcard("/sys/class/net/*/wireless") do
      [path | _] ->
        iface = path |> Path.dirname() |> Path.basename()
        {:ok, iface}

      [] ->
        {:error, :no_wifi}
    end
  end

  defp get_ip(exe, device) do
    case System.cmd(exe, ["-t", "-f", "IP4.ADDRESS", "device", "show", device],
           stderr_to_stdout: true
         ) do
      {output, 0} ->
        output
        |> String.split("\n", trim: true)
        |> Enum.find_value(fn line ->
          case String.split(line, ":") do
            ["IP4.ADDRESS[1]", addr] -> addr |> String.split("/") |> hd()
            _ -> nil
          end
        end)

      _ ->
        nil
    end
  end

  defp get_ssid(exe) do
    # Find the active hotspot profile name
    hotspot_name =
      case System.cmd(exe, ["-t", "-f", "NAME,TYPE", "connection", "show", "--active"],
             stderr_to_stdout: true
           ) do
        {output, 0} ->
          output
          |> String.split("\n", trim: true)
          |> Enum.find_value(fn line ->
            case String.split(line, ":") do
              [name | _] ->
                if String.starts_with?(name, "Hotspot"), do: name

              _ ->
                nil
            end
          end)

        _ ->
          nil
      end

    name = hotspot_name || "Hotspot"

    case System.cmd(
           exe,
           ["-t", "-f", "802-11-wireless.ssid", "connection", "show", name],
           stderr_to_stdout: true
         ) do
      {output, 0} ->
        output
        |> String.split("\n", trim: true)
        |> Enum.find_value(fn line ->
          case String.split(line, ":", parts: 2) do
            ["802-11-wireless.ssid", ssid] -> String.trim(ssid)
            _ -> nil
          end
        end)

      _ ->
        nil
    end
  end

  defp parse_error(output) do
    cond do
      String.contains?(output, "permission") or String.contains?(output, "not authorized") ->
        {:error, :privilege_required}

      String.contains?(output, "no wifi device") ->
        {:error, :no_wifi}

      String.contains?(output, "band") or String.contains?(output, "channel") or
          String.contains?(output, "not supported") ->
        {:error, :band_not_supported}

      String.contains?(output, "IP configuration could not be reserved") ->
        {:error, :ip_config_failed}

      String.contains?(output, "is busy") ->
        {:error, :interface_busy}

      true ->
        {:error, {:hotspot_failed, String.trim(output)}}
    end
  end
end
