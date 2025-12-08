defmodule Dojo.Turtle do
  defstruct state: :hatch, path: nil, commands: [], source: nil, message: nil, time: nil


  def reflect(%{"state" => "success"} = body, opts) do
    body
    |> Map.new(fn {k, v} -> {to_atom(k), v} end)
    |> (&struct(__MODULE__, &1) ).()
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
  
  def reflect(_body,_) do
    nil
  end

  def store(path , %{id: id, clan: clan}) when is_binary(path) do
    dest_dir = Path.join([:code.priv_dir(:dojo), "static", "frames", clan])
    if !File.dir?(dest_dir) do
      File.mkdir(dest_dir)
    end

    with file when is_binary(file) <-
         DojoWeb.Utils.Base64.to_file(path, Path.join([dest_dir, id])),
           ext when byte_size(ext) > 0 <- Path.extname(file) do       
           Path.join(["frames", clan, id]) <> ext <> "#bump=#{System.os_time(:second)}"
         else
           _ -> nil
         end
         
  end

  def store(_,_) do
    nil
  end

  defp to_atom(key) when is_atom(key), do: key
  defp to_atom(key) when is_binary(key) do
    try do
      String.to_existing_atom(key)
    rescue
      ArgumentError -> key  # Keep as string if atom doesn't exist
    end
  end

  

  def find_title(ast) when is_list(ast) do
    Enum.reduce_while(ast, "", fn
      %{"meta" => %{"lit" => title}}, _acc when is_binary(title) ->
        {:halt, title}

      _, _ ->
        {:cont, ""}
    end)
  end

  def find_title(_) do
    ""
  end

  def filter_fns(ast) when is_map(ast) do
    ast
    |> Enum.reject(fn
      %{
        "type" => "Define",
        "value" => _value,
        "meta" => %{"args" => _args},
        "children" => _children
      } ->
        false

      _ ->
        true
    end)
  end

  def filter_fns(_) do
    []
  end

  def find_fn(ast, name) do
    ast
    |> Enum.reject(fn
      %{"type" => "Define", "value" => ^name} ->
        false

      _ ->
        true
    end)
  end

  def print(ast) when is_map(ast) do
    ast |> Enum.map(&visit/1) |> Enum.join("\n")
  end

  def print(_) do
    ""
  end

  defp visit(%{"type" => "Call", "value" => value, "children" => children}) do
    child_output = children |> Enum.map(&visit/1) |> Enum.join(" ")
    "#{value} #{child_output}"
  end

  defp visit(%{"type" => "Argument", "value" => value}) do
    value
  end

  defp visit(%{"type" => "Lit", "value" => value}) do
    "# #{String.trim(value)}"
  end

  defp visit(%{"type" => "Loop", "value" => value, "children" => children}) do
    child_output = children |> Enum.map(&visit/1) |> Enum.join("\n")

    """
    for #{value} do
    #{indent_lines(child_output)}
    end
    """
  end

  defp visit(%{"type" => "When", "value" => value, "children" => children}) do
    child_output = children |> Enum.map(&visit/1) |> Enum.join("\n")

    """
    when #{value} do
    #{indent_lines(child_output)}
    end
    """
  end

  defp visit(%{
         "type" => "Define",
         "value" => value,
         "meta" => %{"args" => args},
         "children" => children
       }) do
    arg_output = args |> Enum.map(&visit/1) |> Enum.join(" ")
    child_output = children |> Enum.map(&visit/1) |> Enum.join("\n")

    """
    draw #{value} #{arg_output} do
    #{indent_lines(child_output)}
    end
    """
  end

  defp visit(_), do: ""

  defp indent_lines(input) do
    input
    |> String.split("\n")
    |> Enum.map_join("\n", fn line -> "  #{line}" end)
  end
end
