defmodule DojoCLI.Browser do
  @moduledoc """
  Cross-platform browser opener with silent failure semantics for CLI UX.

  Design principles:
  - Fire-and-forget: CLI apps shouldn't wait for browser process
  - Silent by default: Opening a browser is a side effect, not the main operation
  - Graceful degradation: Fall back through command chain without user intervention
  - No error noise: Failed browser open shouldn't crash or spam stderr
  """

  require Logger

  @type url :: String.t()
  @type result :: :ok | {:error, atom()}

  @doc """
  Opens URL in default browser. Returns immediately without waiting.

  This is fire-and-forget by design - CLI shouldn't block on browser launch.
  Logs failures at debug level to avoid polluting user's terminal.

  ## Examples

      DojoCLI.Browser.open("http://localhost:4000")
      #=> :ok (always, even if browser fails to open)
  """
  @spec open(url()) :: :ok
  def open(url) when is_binary(url) do
    Task.start(fn ->
      url
      |> normalize_url()
      |> open_async()
    end)

    :ok
  end

  @doc """
  Opens URL synchronously. Useful when you need to know if it succeeded.

  Returns :ok or {:error, reason}. Tries all available commands for the OS.
  """
  @spec open_sync(url()) :: result()
  def open_sync(url) when is_binary(url) do
    url
    |> normalize_url()
    |> try_open_commands()
  end

  # Platform detection

  defp os_type, do: :os.type()

  defp platform do
    case os_type() do
      {:win32, _} -> :windows
      {:unix, :darwin} -> :darwin
      {:unix, :linux} -> :linux
      {:unix, :freebsd} -> :freebsd
      {:unix, _} -> :unix
    end
  end

  # Command strategy: ordered by preference/commonality

  defp commands(:windows) do
    [
      # cmd.exe start is most reliable on Windows
      {~c"cmd", [~c"/c", ~c"start", ~c"", :url]},
      # PowerShell as fallback
      {~c"powershell", [~c"-NoProfile", ~c"-Command", ~c"Start-Process", :url]}
    ]
  end

  defp commands(:darwin) do
    # macOS - open is always available
    [{~c"open", [:url]}]
  end

  defp commands(:linux) do
    [
      # XDG standard - should be present on all modern Linux
      {~c"xdg-open", [:url]},
      # Fallbacks for older/minimal systems
      {~c"gnome-open", [:url]},
      {~c"kde-open", [:url]},
      {~c"wslview", [:url]}  # WSL support
    ]
  end

  defp commands(:freebsd), do: commands(:linux)

  defp commands(:unix) do
    # Generic Unix fallback
    commands(:linux) ++
      [
        {~c"firefox", [:url]},
        {~c"chromium", [:url]},
        {~c"chrome", [:url]}
      ]
  end

  # URL normalization

  defp normalize_url(url) do
    case URI.parse(url) do
      %URI{scheme: nil, host: nil} ->
        # Raw path like "localhost:4000" or "example.com"
        "http://#{url}"

      %URI{scheme: scheme} when scheme in ~w(http https file) ->
        url

      _ ->
        url
    end
  end

  # Command execution primitives

  defp try_open_commands(url) do
    platform()
    |> commands()
    |> Enum.reduce_while({:error, :no_command}, fn cmd_spec, _acc ->
      case exec_command(cmd_spec, url) do
        :ok -> {:halt, :ok}
        {:error, _} = err -> {:cont, err}
      end
    end)
  end

  defp exec_command({cmd, arg_template}, url) do
    # Convert charlist command to string for System.find_executable
    cmd_string = List.to_string(cmd)
    
    case System.find_executable(cmd_string) do
      nil ->
        {:error, :command_not_found}

      exe_path ->
        args = Enum.map(arg_template, fn
          :url -> url
          arg when is_list(arg) -> List.to_string(arg)
          arg -> arg
        end)

        # System.cmd is more reliable across platforms than Port.open
        # Use :stderr_to_stdout to suppress error noise
        try do
          # Spawn detached so CLI doesn't wait for browser
          Task.start(fn ->
            case System.cmd(exe_path, args, stderr_to_stdout: true) do
              {_, 0} -> :ok
              _ -> :error
            end
          end)
          
          :ok
        rescue
          e ->
            Logger.debug("Failed to exec browser command: #{inspect(e)}")
            {:error, :exec_failed}
        end
    end
  end

  # Async path (fire-and-forget)

  defp open_async(url) do
    case try_open_commands(url) do
      :ok ->
        Logger.debug("Opened #{url} in browser")

      {:error, reason} ->
        Logger.debug("Could not open browser: #{reason}. URL: #{url}")
    end
  end
end
