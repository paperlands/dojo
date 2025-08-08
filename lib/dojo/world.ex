defmodule Dojo.World do
  @moduledoc """
  Implements functionality for simulating and visualizing elementary cellular automata.

  Provides functions to create, print, and evolve cellular automata based on given rules.
  """

  @world 10

  @doc """
  Creates an initial state for the cellular automaton.

  Takes a binary string representing the initial state and returns a padded version of it,
  ensuring it fits within the predefined world size.

  ## Parameters

  - `str`: A binary string where '1' represents a live cell and '0' represents a dead cell.

  ## Examples

  iex> Dojo.World.create("101")
  ["00001010000"]

  """

  def create(str, %{class: pid}) when is_binary(str) do
    str = create(str)
    Dojo.Table.publish(pid, {__MODULE__, :create, str}, :animate)
    str
  end

  def create(str) do
    w_pad = String.duplicate("0", @world)
    [w_pad <> str <> w_pad]
  end

  @doc """
  Prints the current state of the cellular automaton.

  Supports different output formats based on the options provided.

  ## Options

  - `book: true`: Formats the output for display in a book-like layout.
  - `view: true`: Formats the output for direct viewing in a console or web page.
  - `animate: true`: Animates the evolution of the cellular automaton over time.

  ## Examples

  iex> Dojo.World.print(["00001010000"], book: true)
  "⬜⬜⬜⬛⬜⬛⬜⬜⬜⬜"

  """
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
        _x, acc when length(acc) > index ->
          {:halt, Enum.reverse(acc)}

        _x, acc when length(acc) == timesteps ->
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

  def print(gen, list: true) when is_binary(gen) do
    [gen]
    |> Enum.map(&print_world(&1))
  end

  def print(gen, list: true) when is_list(gen) do
    gen
    |> Enum.map(&print_world(&1))
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

  @doc """
  Evolves the cellular automaton through a series of generations.

  Applies the given rule to the current state of the cellular automaton for a specified number of times.

  ## Parameters

  - `state`: The current state of the cellular automaton, represented as a list of binary strings.
  - `rule`: The rule to apply, either as a binary string, an integer, or a map of patterns to outputs.
  - `times`: The number of generations to evolve.
  - `opts`: Optional parameters, such as a `class` PID for publishing events.

  ## Examples

  iex> Dojo.World.next(["00001010000"], "30", 5)
  ["00001010000",...]

  """

  def next(state, _rule, times, opts \\ %{})

  def next(state, _rule, 0, _) do
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

    Dojo.Table.publish(pid, {__MODULE__, :next, [state, patterns, 10]}, :animate)

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

  @doc """
  Runs the cellular automaton simulation and publishes the result.

  We pad the initial state to fit the predefined world size, applies the specified rule over the given number of generations, and returns the sequence of states resulting from the simulation.

  Evolves the cellular automaton according to the given rule and times, then publishes the final state.

  ## Parameters

  - `str`: The initial state of the cellular automaton as a binary string.
  - `rule`: The rule to apply, either as a binary string or an integer.
  - `times`: The number of generations to evolve.
  - `%{class: pid}`: A map containing a `class` key with a PID for event publishing.

  ## Examples

  iex> Dojo.World.run("00001010000", "30", 5, %{class: self()})
  # Publishes the final state after evolving 5 generations.

  """

  def run(str, rule, times, %{class: pid}) do
    outcome = run(str, rule, times)
    Dojo.Table.publish(pid, {outcome, {__MODULE__, :run, [str, rule, times]}}, :animate)
    outcome
  end

  def run(str, rule, times) do
    w_pad = String.duplicate("0", @world)
    str = w_pad <> str <> w_pad
    each(str, rule_pattern(rule), times, [])
  end

  @doc """
  Converts a rule into a pattern map if it's an integer.

  ## Parameters

  - `rule`: The rule to convert, either as a map or an integer.

  ## Examples

  iex> Dojo.World.rule_pattern(30)
  %{"111" => "0", "110" => "1",...}

  """

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

  @doc """
  Converts the cellular automaton's state into a human-readable format.

  Replaces '0' with '⬜' and '1' with '⬛' for better visualization.

  ## Parameters

  - `str`: A binary string representing the state of the cellular automaton.

  ## Examples

  iex> Dojo.World.print_world("00001010000")
  "⬜⬜⬜⬛⬜⬛⬜⬜⬜⬜"

  """

  def print_world(str) do
    str
    |> String.replace("0", "⬜")
    |> String.replace("1", "⬛")
  end
end
