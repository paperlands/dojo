defmodule Dojo.Hotspot.Windows do
  @moduledoc """
  Windows hotspot management via PowerShell / WinRT NetworkOperatorTetheringManager.
  """

  require Logger

  @wifi_preamble """
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime] | Out-Null
  [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime] | Out-Null
  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  # Await helper for IAsyncOperation<T>
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  Function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  # Await helper for IAsyncAction (no return value)
  Function AwaitAction($WinRtTask) {
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethod(
      'AsTask', [Type[]]@([Windows.Foundation.IAsyncAction]))
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
  }

  # Find WiFi adapter profile — works even when NOT connected to internet.
  # IanaInterfaceType 71 = IEEE 802.11 (Wi-Fi)
  $wifiProfile = [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles() |
    Where-Object { $_.NetworkAdapter -and $_.NetworkAdapter.IanaInterfaceType -eq 71 } |
    Select-Object -First 1

  if ($null -eq $wifiProfile) {
    Write-Output "NoWifiAdapter"
    exit 1
  }

  $tetheringManager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($wifiProfile)
  """

  # ── Public API ───────────────────────────────────────────────────────

  @spec start(String.t(), String.t()) :: :ok | {:error, term()}
  def start(ssid, password) do
    script =
      @wifi_preamble <>
        """
        $config = $tetheringManager.GetCurrentAccessPointConfiguration()
        $config.Ssid       = #{inspect(ssid)}
        $config.Passphrase = #{inspect(password)}
        AwaitAction ($tetheringManager.ConfigureAccessPointAsync($config))

        $result = Await ($tetheringManager.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        $result.Status
        """

    run_powershell(script, "start")
  end

  @spec stop() :: :ok | {:error, term()}
  def stop do
    script =
      @wifi_preamble <>
        """
        $result = Await ($tetheringManager.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        $result.Status
        """

    run_powershell(script, "stop")
  end

  @spec status() :: {:ok, map()} | {:error, term()}
  def status do
    script =
      @wifi_preamble <>
        """
        $state  = $tetheringManager.TetheringOperationalState
        $config = $tetheringManager.GetCurrentAccessPointConfiguration()
        Write-Output "$state|$($config.Ssid)"
        """

    case System.find_executable("powershell") do
      nil ->
        {:error, :powershell_not_found}

      exe ->
        case System.cmd(exe, ["-NoProfile", "-Command", script], stderr_to_stdout: true) do
          {"NoWifiAdapter" <> _, _} ->
            {:error, :no_wifi_adapter}

          {output, 0} ->
            case output |> String.trim() |> String.split("|") do
              ["On" <> _, ssid] -> {:ok, %{active: true, ssid: ssid, interface: nil, ip: nil}}
              _ -> {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
            end

          _ ->
            {:ok, %{active: false, ssid: nil, interface: nil, ip: nil}}
        end
    end
  end

  @spec detect_wifi_interface() :: {:ok, String.t()} | {:error, term()}
  def detect_wifi_interface do
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

  @spec connected_ssid(String.t()) :: String.t() | nil
  def connected_ssid(_iface), do: nil

  # ── Helpers ──────────────────────────────────────────────────────────

  defp run_powershell(script, action) do
    case System.find_executable("powershell") do
      nil ->
        {:error, :powershell_not_found}

      exe ->
        case System.cmd(exe, ["-NoProfile", "-Command", script], stderr_to_stdout: true) do
          {"NoWifiAdapter" <> _, _} ->
            Logger.warning("[Hotspot] #{action} failed: no Wi-Fi adapter found")
            {:error, :no_wifi_adapter}

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
end
