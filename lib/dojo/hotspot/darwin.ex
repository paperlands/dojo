defmodule Dojo.Hotspot.Darwin do
  @moduledoc """
  macOS hotspot management via launchctl / Internet Sharing.
  """

  require Logger

  @internet_sharing_plist "/System/Library/LaunchDaemons/com.apple.InternetSharing.plist"

  # ── Public API ───────────────────────────────────────────────────────

  @spec start(String.t(), String.t()) :: :ok | {:error, term()}
  def start(_ssid, _password) do
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

  @spec stop() :: :ok | {:error, term()}
  def stop do
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

  @spec status() :: {:ok, map()} | {:error, term()}
  def status do
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

  @spec detect_wifi_interface() :: {:ok, String.t()} | {:error, term()}
  def detect_wifi_interface do
    case System.find_executable("networksetup") do
      nil ->
        {:error, :networksetup_not_found}

      exe ->
        case System.cmd(exe, ["-listallhardwareports"], stderr_to_stdout: true) do
          {output, 0} ->
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

  @spec connected_ssid(String.t()) :: String.t() | nil
  def connected_ssid(iface) do
    case System.find_executable("networksetup") do
      nil ->
        nil

      exe ->
        case System.cmd(exe, ["-getairportnetwork", iface], stderr_to_stdout: true) do
          {output, 0} ->
            case Regex.run(~r/Current Wi-Fi Network:\s*(.+)/, output) do
              [_, ssid] -> String.trim(ssid)
              _ -> nil
            end

          _ ->
            nil
        end
    end
  end
end
