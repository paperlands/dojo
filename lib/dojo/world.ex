defmodule Dojo.World do
  @world 10

  def create(str, %{name: name}) when is_binary(str) do
    str = create(str)
    Dojo.PubSub.publish({name, {__MODULE__, :create, str}}, :animate, "class:book1")
    str
  end

  def create(str) do
    w_pad = String.duplicate("0", @world)
    [w_pad <> str <> w_pad]
  end

  def print(str, [book: true]) when is_list(str) do
    str
        |> Enum.join("
")
    |> print_world()
    |> Kino.Markdown.new()
  end

  def print(rules, [book: true]) when is_map(rules) do
    """
    | Input Pattern | Output Value |
    | ------------- | ------------ |
    """ <>
    (Enum.map(rules, fn {k, v} ->
          "| #{print_world(k)} | #{print_world(v)} |\n"
        end)
        |> Enum.join(""))
        |> Kino.Markdown.new()
  end

  def print(str) when is_binary(str) do
    print_world(str)
  end


  def print(gen) when is_list(gen) do
    gen
    |> Enum.join("
")
    |> print_world()
  end

  def print(gen, [list: true]) when is_list(gen) do
    gen
    |> Enum.map(&print_world(&1))
  end

  def next() do


  end

  def run(str, rule, times) do
    w_pad = String.duplicate("0", @world)
    str = w_pad <> str <> w_pad

    # to work on padder later
    #padder = &String.slice(&1, pad, len - pad)
    each(str, rule_pattern(rule), times)
  end

  def rule_pattern(rule) when is_map(rule) do
    rule
  end

  def rule_pattern(rule) when is_integer(rule) do
    list =
      Integer.to_string(rule, 2)
      |> String.pad_leading(8, "0")
      |> String.codepoints()
      |> Enum.reverse()

    Enum.map(0..7, fn i -> Integer.to_string(i, 2) |> String.pad_leading(3, "0") end)
    |> Enum.zip(list)
    |> Map.new()
    |> IO.inspect()
   end

  defp each(_, _, 0), do: :ok

  defp each(str, patterns, times) do
    IO.puts(String.replace(str, "0", "⬜") |> String.replace("1", "⬛"))
    str2 = String.last(str) <> str <> String.first(str)

    next_str =
      Enum.map_join(0..(String.length(str) - 1), fn i ->
        Map.get(patterns, String.slice(str2, i, 3))
      end)

    each(next_str, patterns, times - 1)
  end


  defp print_world(str) do
    str
    |> String.replace("0", "⬜")
    |> String.replace("1", "⬛")
  end
end
