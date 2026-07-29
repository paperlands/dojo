defmodule Dojo.Turtle do
  # The reflect envelope. `commands` is the buffer's WHOLE standing tree (D022);
  # `attend` is where the author is looking in it (D025 R1).
  #
  # CARRIED, NEVER INTERPRETED — the tree and the line alike. The server has no
  # printer and no AST walker and must not grow one: it had one, with zero
  # callers, and it drifted until it emitted a node type retired by D013. So no
  # rate-limiting by line, no fan-out by phase.
  #
  # `diagnostics` is a LIST, not a state — healthy parts live (D020).
  defstruct state: :hatch,
            path: nil,
            commands: [],
            attend: nil,
            diagnostics: [],
            source: nil,
            message: nil,
            # MILLISECONDS: a version stamp readers compare with `>`. At second
            # resolution the watcher's gate dropped all but one hatch a second.
            time: nil,
            buffer_id: nil

  def reflect(%{"state" => "success"} = body, opts) do
    body
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> (&struct(__MODULE__, &1)).()
    |> Map.merge(%{state: :success, time: System.os_time(:millisecond)})
    |> Map.update(:path, nil, &store(&1, opts))
    |> Map.update(:commands, [], &Enum.take(&1, 1008))
    |> reflect(opts)
  end

  def reflect(%{"state" => "error"} = body, opts) do
    body
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> (&struct(__MODULE__, &1)).()
    |> Map.merge(%{state: :error, time: System.os_time(:millisecond)})
    |> Map.update(:path, nil, &store(&1, opts))
    |> reflect(opts)
  end

  def reflect(%__MODULE__{} = body, %{topic: topic, class: pid}) do
    Dojo.Table.publish(pid, {__MODULE__, nil, body}, topic)
  end

  def reflect(_body, _) do
    nil
  end

  def store(path, %{id: id, clan: clan}) when is_binary(path) do
    dest_dir = Path.join([:code.priv_dir(:dojo), "static", "frames", clan])

    if !File.dir?(dest_dir) do
      File.mkdir(dest_dir)
    end

    # path is relative — routable addr comes from presence (Gate)
    with file when is_binary(file) <-
           DojoWeb.Utils.Base64.to_file(path, Path.join([dest_dir, id])),
         ext when byte_size(ext) > 0 <- Path.extname(file) do
      # Same unit as `time` (ms) so bump_path_time in shell_live does not
      # rewrite the cache-buster from seconds into milliseconds mid-life.
      Path.join(["frames", clan, id]) <>
        ext <> "?t=#{System.os_time(:millisecond)}" <> Dojo.Cluster.Routing.asset_path_params()
    else
      _ -> nil
    end
  end

  def store(_, _) do
    nil
  end

  defp to_atom(key) when is_atom(key), do: key

  defp to_atom(key) when is_binary(key) do
    try do
      String.to_existing_atom(key)
    rescue
      # Keep as string if atom doesn't exist
      ArgumentError -> key
    end
  end
end
