defmodule Dojo.Turtle do

  def hatch(%{path: path, commands: cmd} = body, %{class: pid}) do
    Dojo.Table.publish(pid, {__MODULE__, %{path: path}, body}, :hatch)
  end
  def hatch() do
    nil
  end
  def filter_fns(ast) when is_map(ast) do
    ast |> Enum.reject(fn
    %{"type" => "Define", "value" => value, "meta" => %{"args" => args}, "children" => children} ->
      false
      _ ->
        true
    end)
  end

  def filter_fns(_)  do
    []
  end

  def find_fn(ast, name) do

    ast |> Enum.reject(fn
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

  defp visit(%{"type" => "Define", "value" => value, "meta" => %{"args" => args}, "children" => children}) do
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
