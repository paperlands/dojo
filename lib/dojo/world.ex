defmodule Dojo.World do
  @world 10

  def create(str, %{class: pid}) when is_binary(str) do
    str = create(str)
    Dojo.Class.publish(pid, {__MODULE__, :create, str}, :animate)
    str
  end

  def create(str) do
    w_pad = String.duplicate("0", @world)
    [w_pad <> str <> w_pad]
  end

  def print(str, book: true) when is_list(str) do
    str
    |> Enum.join("  ")
    |> print_world()
    |> Kino.Markdown.new()
  end

  def print(str, view: true) when is_list(str) do
    str
    |> Enum.join(" <br> ")
    |> print_world()
  end

  def print(str, animate: true) when is_list(str) do
    DojoKino.Animate.new(0..(length(str) - 1), fn index ->
      Enum.at(str, index)
      |> print_world()
      |> Kino.Markdown.new()
    end)
  end

  # def print(str, [spacetime: true, class: pid]) when is_list(str) do
  #   Dojo.Class.publish(pid, str, :animate)
  #   print(str, [spacetime: true])
  # end

  def print(str, spacetime: true) when is_list(str) do
    timesteps = length(str) - 1

    DojoKino.Animate.new(0..timesteps, fn index ->
      Enum.reduce_while(str, [], fn
        x, acc when length(acc) > index ->
          {:halt, Enum.reverse(acc)}

        x, acc when length(acc) == timesteps ->
          {:halt, Enum.reverse(acc)}

        x, acc ->
          {:cont, [x | acc]}
      end)
      |> print(book: true)
    end)
  end

  def print(rules, book: true) when is_map(rules) do
    ("""
     | Input Pattern | Output Value |
     | ------------- | ------------ |
     """ <>
       (Enum.map(rules, fn {k, v} ->
          "| #{print_world(k)} | #{print_world(v)} |\n"
        end)
        |> Enum.join("")))
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

  def print(gen, list: true) when is_binary(gen) do
    [gen]
    |> Enum.map(&print_world(&1))
  end

  def print(gen, list: true) when is_list(gen) do
    gen
    |> Enum.map(&print_world(&1))
  end

  def next(state, rule, times, opts \\ %{})

  def next(state, rule, 0, _) do
    state |> Enum.reverse()
  end

  def next(state, rule, times, opts) when is_binary(rule) do
    next(state, String.to_integer(rule), times, opts)
  end

  def next(state, rule, times, opts) when is_integer(rule) do
    next(state, rule_pattern(rule), times, opts)
  end

  # 1st state
  def next([str | []] = state, patterns, times, %{class: pid}) when is_map(patterns) do
    str2 = String.last(str) <> str <> String.first(str)

    new =
      Enum.map_join(0..(String.length(str) - 1), fn i ->
        Map.get(patterns, String.slice(str2, i, 3))
      end)

    outcome = next([new | state], patterns, times - 1, %{})

    Dojo.Class.publish(pid, {__MODULE__, :next, [state, patterns, 10]}, :animate)

    outcome
  end

  def next([str | _] = state, patterns, times, _) when is_map(patterns) do
    str2 = String.last(str) <> str <> String.first(str)

    new =
      Enum.map_join(0..(String.length(str) - 1), fn i ->
        Map.get(patterns, String.slice(str2, i, 3))
      end)

    next([new | state], patterns, times - 1)
  end

  def run(str, rule, times, %{class: pid}) do
    outcome = run(str, rule, times)
    Dojo.Class.publish(pid, outcome, :animate)
    outcome
  end

  def run(str, rule, times) do
    w_pad = String.duplicate("0", @world)
    str = w_pad <> str <> w_pad
    each(str, rule_pattern(rule), times, [])
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

  defp each(str, _, 0, board), do: [str | board] |> Enum.reverse()

  defp each(str, patterns, times, board) do
    str2 = String.last(str) <> str <> String.first(str)

    next_str =
      Enum.map_join(0..(String.length(str) - 1), fn i ->
        Map.get(patterns, String.slice(str2, i, 3))
      end)

    each(next_str, patterns, times - 1, [str | board])
  end

  def print_world(str) do
    str
    |> String.replace("0", "⬜")
    |> String.replace("1", "⬛")
  end
end
