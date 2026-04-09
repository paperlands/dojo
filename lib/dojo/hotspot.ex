defmodule Dojo.Hotspot do
  @moduledoc """
  OS-abstracted WiFi hotspot management.

  Platform-dispatched to per-OS modules:
  - `Dojo.Hotspot.Linux` — nmcli / NetworkManager
  - `Dojo.Hotspot.Windows` — PowerShell / WinRT
  - `Dojo.Hotspot.Darwin` — launchctl / Internet Sharing
  """

  @type hotspot_status :: %{
          active: boolean(),
          ssid: String.t() | nil,
          interface: String.t() | nil,
          ip: String.t() | nil
        }

  @spec start(String.t(), String.t()) :: :ok | {:error, term()}
  def start(ssid, password), do: impl().start(ssid, password)

  @spec stop() :: :ok | {:error, term()}
  def stop, do: impl().stop()

  @spec status() :: {:ok, hotspot_status()} | {:error, term()}
  def status, do: impl().status()

  @spec detect_wifi_interface() :: {:ok, String.t()} | {:error, term()}
  def detect_wifi_interface, do: impl().detect_wifi_interface()

  @spec connected_ssid(String.t()) :: String.t() | nil
  def connected_ssid(iface), do: impl().connected_ssid(iface)

  @spec platform() :: :linux | :windows | :darwin | term()
  def platform do
    case :os.type() do
      {:win32, _} -> :windows
      {:unix, :darwin} -> :darwin
      {:unix, _} -> :linux
    end
  end

  defp impl do
    case platform() do
      :linux -> Dojo.Hotspot.Linux
      :windows -> Dojo.Hotspot.Windows
      :darwin -> Dojo.Hotspot.Darwin
    end
  end
end
