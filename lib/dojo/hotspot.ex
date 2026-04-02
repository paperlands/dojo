defmodule Dojo.Hotspot do
  @moduledoc """
  OS-abstracted WiFi hotspot management.

  Platform-dispatched commands for creating, stopping, and querying
  WiFi hotspots. Follows the DojoCLI.Browser pattern of per-platform
  command dispatch via System.cmd/3.
  """

  require Logger

  @type hotspot_status :: %{
          active: boolean(),
          ssid: String.t() | nil,
          interface: String.t() | nil,
          ip: String.t() | nil
        }

  # ── Public API ───────────────────────────────────────────────────────

  @spec start(String.t(), String.t()) :: :ok | {:error, term()}
  def start(ssid, password) do
    case platform() do
      :linux -> start_linux(ssid, password)
      :windows -> start_windows(ssid, password)
      :darwin -> start_darwin(ssid, password)
      other -> {:error, {:unsupported_platform, other}}
    end
  end

  @spec stop() :: :ok | {:error, term()}
  def stop do
    case platform() do
      :linux -> stop_linux()
      :windows -> stop_windows()
      :darwin -> stop_darwin()
      other -> {:error, {:unsupported_platform, other}}
    end
  end

  @spec status() :: {:ok, hotspot_status()} | {:error, term()}
  def status do
    case platform() do
      :linux -> status_linux()
      :windows -> status_windows()
      :darwin -> status_darwin()
      other -> {:error, {:unsupported_platform, other}}
    end
  end

  @spec detect_wifi_interface() :: {:ok, String.t()} | {:error, term()}
  def detect_wifi_interface do
    case platform() do
      :linux -> detect_wifi_linux()
      :windows -> detect_wifi_windows()
      :darwin -> detect_wifi_darwin()
      other -> {:error, {:unsupported_platform, other}}
    end
  end

  @spec platform() :: atom()
  def platform do
    case :os.type() do
      {:win32, _} -> :windows
      {:unix, :darwin} -> :darwin
      {:unix, :linux} -> :linux
      {:unix, :freebsd} -> :linux
      {:unix, _} -> :linux
    end
  end

  # ── Linux (nmcli) ───────────────────────────────────────────────────

  defp start_linux(ssid, password) do
    with {:ok, iface} <- detect_wifi_linux(),
         exe when exe != nil <- System.find_executable("nmcli") do
      case System.cmd(
             exe,
             [
               "device",
               "wifi",
               "hotspot",
               "ifname",
               iface,
               "ssid",
               ssid,
               "password",
               password
             ],
             stderr_to_stdout: true
           ) do
        {_, 0} ->
          Logger.info("[Hotspot] started on #{iface} ssid=#{ssid}")
          :ok

        {output, code} ->
          Logger.warning("[Hotspot] nmcli hotspot failed (#{code}): #{output}")
          parse_linux_error(output)
      end
    else
      nil -> {:error, :nmcli_not_found}
      {:error, _} = err -> err
    end
  end

  defp stop_linux do
    case System.find_executable("nmcli") do
      nil ->
        {:error, :nmcli_not_found}

      exe ->
        case System.cmd(exe, ["connection", "down", "Hotspot"], stderr_to_stdout: true) do
          {_, 0} ->
            Logger.info("[Hotspot] stopped")
            :ok

          {output, _} ->
            Logger.warning("[Hotspot] stop failed: #{output}")
            {:error, :stop_failed}
        end
    end
  end

  defp status_linux do
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
              |> Enum.find(&String.contains?(&1, "Hotspot"))

            if hotspot_line do
              [_name, _type, device] = String.split(hotspot_line, ":")
              ip = get_linux_ip(device)
              {:ok, %{active: true, ssid: get_linux_ssid(), interface: device, ip: ip}}
            else
              {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
            end

          {_, _} ->
            {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
        end
    end
  end

  defp detect_wifi_linux do
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

  defp detect_wifi_sysfs do
    case Path.wildcard("/sys/class/net/*/wireless") do
      [path | _] ->
        iface = path |> Path.dirname() |> Path.basename()
        {:ok, iface}

      [] ->
        {:error, :no_wifi}
    end
  end

  defp get_linux_ip(device) do
    case System.find_executable("nmcli") do
      nil ->
        nil

      exe ->
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
  end

  defp get_linux_ssid do
    case System.find_executable("nmcli") do
      nil ->
        nil

      exe ->
        case System.cmd(
               exe,
               ["-t", "-f", "802-11-wireless.ssid", "connection", "show", "Hotspot"],
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
  end

  defp parse_linux_error(output) do
    cond do
      String.contains?(output, "permission") or String.contains?(output, "not authorized") ->
        {:error, :privilege_required}

      String.contains?(output, "no wifi device") or String.contains?(output, "not found") ->
        {:error, :no_wifi}

      String.contains?(output, "IP configuration could not be reserved") ->
        {:error, :ip_config_failed}

      true ->
        {:error, {:hotspot_failed, String.trim(output)}}
    end
  end

  # ── Windows (PowerShell/WinRT) ─────────────────────────────────────

  defp start_windows(_ssid, _password) do
    script = """
    [Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime] | Out-Null
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    Function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
    }
    $connectionProfile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
    $tetheringManager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($connectionProfile)
    $result = Await ($tetheringManager.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    $result.Status
    """

    run_powershell(script, "start")
  end

  defp stop_windows do
    script = """
    [Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime] | Out-Null
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    Function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
    }
    $connectionProfile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
    $tetheringManager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($connectionProfile)
    $result = Await ($tetheringManager.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    $result.Status
    """

    run_powershell(script, "stop")
  end

  defp status_windows do
    script = """
    [Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime] | Out-Null
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $connectionProfile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
    $tetheringManager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($connectionProfile)
    $state = $tetheringManager.TetheringOperationalState
    $config = $tetheringManager.GetCurrentAccessPointConfiguration()
    Write-Output "$state|$($config.Ssid)"
    """

    case System.find_executable("powershell") do
      nil ->
        {:error, :powershell_not_found}

      exe ->
        case System.cmd(exe, ["-NoProfile", "-Command", script], stderr_to_stdout: true) do
          {output, 0} ->
            case output |> String.trim() |> String.split("|") do
              ["On" <> _, ssid] ->
                {:ok, %{active: true, ssid: ssid, interface: nil, ip: nil}}

              _ ->
                {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
            end

          _ ->
            {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
        end
    end
  end

  defp detect_wifi_windows do
    script =
      "Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Wi-Fi|Wireless|WLAN'} | Select-Object -First 1 -ExpandProperty Name"

    case System.find_executable("powershell") do
      nil ->
        {:error, :powershell_not_found}

      exe ->
        case System.cmd(exe, ["-NoProfile", "-Command", script], stderr_to_stdout: true) do
          {name, 0} when name != "" -> {:ok, String.trim(name)}
          _ -> {:error, :no_wifi}
        end
    end
  end

  defp run_powershell(script, action) do
    case System.find_executable("powershell") do
      nil ->
        {:error, :powershell_not_found}

      exe ->
        case System.cmd(exe, ["-NoProfile", "-Command", script], stderr_to_stdout: true) do
          {output, 0} ->
            if String.contains?(output, "Success") do
              Logger.info("[Hotspot] #{action} succeeded (Windows)")
              :ok
            else
              Logger.warning("[Hotspot] #{action} result: #{String.trim(output)}")
              {:error, {:hotspot_failed, String.trim(output)}}
            end

          {output, code} ->
            Logger.warning("[Hotspot] PowerShell #{action} failed (#{code}): #{output}")
            {:error, {:hotspot_failed, String.trim(output)}}
        end
    end
  end

  # ── macOS (launchctl Internet Sharing) ─────────────────────────────

  @internet_sharing_plist "/System/Library/LaunchDaemons/com.apple.InternetSharing.plist"

  defp start_darwin(_ssid, _password) do
    case System.find_executable("launchctl") do
      nil ->
        {:error, :launchctl_not_found}

      exe ->
        case System.cmd(exe, ["load", "-w", @internet_sharing_plist], stderr_to_stdout: true) do
          {_, 0} ->
            Logger.info("[Hotspot] Internet Sharing enabled (macOS)")
            :ok

          {output, _} ->
            Logger.warning("[Hotspot] launchctl failed: #{output}")

            if String.contains?(output, "permission") or
                 String.contains?(output, "Operation not permitted") do
              {:error, :privilege_required}
            else
              {:error, :platform_limited}
            end
        end
    end
  end

  defp stop_darwin do
    case System.find_executable("launchctl") do
      nil ->
        {:error, :launchctl_not_found}

      exe ->
        case System.cmd(exe, ["unload", "-w", @internet_sharing_plist], stderr_to_stdout: true) do
          {_, 0} ->
            Logger.info("[Hotspot] Internet Sharing disabled (macOS)")
            :ok

          {output, _} ->
            Logger.warning("[Hotspot] launchctl stop failed: #{output}")
            {:error, :stop_failed}
        end
    end
  end

  defp status_darwin do
    case System.find_executable("launchctl") do
      nil ->
        {:error, :launchctl_not_found}

      exe ->
        case System.cmd(exe, ["list"], stderr_to_stdout: true) do
          {output, 0} ->
            active = String.contains?(output, "com.apple.InternetSharing")
            {:ok, %{active: active, ssid: nil, interface: nil, ip: nil}}

          _ ->
            {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
        end
    end
  end

  defp detect_wifi_darwin do
    case System.find_executable("networksetup") do
      nil ->
        {:error, :networksetup_not_found}

      exe ->
        case System.cmd(exe, ["-listallhardwareports"], stderr_to_stdout: true) do
          {output, 0} ->
            # Parse pairs of "Hardware Port: Wi-Fi\nDevice: en0"
            output
            |> String.split("\n")
            |> Enum.chunk_every(2, 1, :discard)
            |> Enum.find_value(fn
              [port_line, device_line] ->
                if String.contains?(port_line, "Wi-Fi") do
                  case Regex.run(~r/Device:\s*(\w+)/, device_line) do
                    [_, device] -> {:ok, device}
                    _ -> nil
                  end
                end

              _ ->
                nil
            end) || {:error, :no_wifi}

          _ ->
            {:error, :no_wifi}
        end
    end
  end
end
