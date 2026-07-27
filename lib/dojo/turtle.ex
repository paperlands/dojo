defmodule Dojo.Turtle do
  # The reflect envelope. `commands` is the buffer's standing tree AS INHABITED
  # — the document, not the instructions some seat happened to run; reflect the
  # document (D022). `attend` is that document's own coordinate: the two are
  # made together by `reflectPhase` in one walk from one input (D025 R1), so
  # they can never disagree about which text a line indexes.
  #
  # The tree is CARRIED here, never interpreted — AND SO IS `attend`. The server
  # has no printer and no AST walker of its own, and must not grow one. It had
  # one — `print/1`, `find_title/1`, `filter_fns/1`, `find_fn/2` — with zero
  # callers, and it drifted unnoticed until it emitted `for N do` for a Loop and
  # still matched a `Lit` node type retired with D013. A second grammar for the
  # one alphabet is worse than none; `turtling/parse.js` printAST is the one
  # printer. The same prohibition answers the question this field invites: no,
  # the server may not rate-limit by line or fan out by phase. It is luggage.
  #
  # `diagnostics` rides beside it: the span-true diagnostics (parse errors at any
  # nesting, standing walk ailments). They are a LIST, not a state — healthy
  # parts live (D020), so the figure still drew, and a diagnostic must be loud
  # without darkening it.
  defstruct state: :hatch,
            path: nil,
            commands: [],
            attend: nil,
            diagnostics: [],
            source: nil,
            message: nil,
            time: nil,
            buffer_id: nil

  def reflect(%{"state" => "success"} = body, opts) do
    body
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> (&struct(__MODULE__, &1)).()
    |> Map.merge(%{state: :success, time: System.os_time(:second)})
    |> Map.update(:path, nil, &store(&1, opts))
    |> Map.update(:commands, [], &Enum.take(&1, 1008))
    |> reflect(opts)
  end

  def reflect(%{"state" => "error"} = body, opts) do
    body
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> (&struct(__MODULE__, &1)).()
    |> Map.merge(%{state: :error, time: System.os_time(:second)})
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
      Path.join(["frames", clan, id]) <>
        ext <> "?t=#{System.os_time(:second)}" <> Dojo.Cluster.Routing.asset_path_params()
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
