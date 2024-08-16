defmodule Dojo.Turtle do

  def hatch(path, %{class: pid}) when is_map(path) do
    Dojo.Table.publish(pid, {__MODULE__, path}, :hatch)
  end

   def print(ast) do
    ast |> Enum.map(&visit/1) |> Enum.join("\n")
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
    for #{value} (
    #{indent_lines(child_output)}
    )
    """
  end

  defp visit(%{"type" => "Define", "value" => value, "meta" => %{"args" => args}, "children" => children}) do
    arg_output = args |> Enum.map(&visit/1) |> Enum.join(" ")
    child_output = children |> Enum.map(&visit/1) |> Enum.join("\n")
    """
    draw #{value} #{arg_output} (
    #{indent_lines(child_output)}
    )
    """
  end

  defp visit(_), do: ""

  defp indent_lines(input) do
    input
    |> String.split("\n")
    |> Enum.map_join("\n", fn line -> "  #{line}" end)
  end
end
