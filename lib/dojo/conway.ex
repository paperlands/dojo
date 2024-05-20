defmodule Dojo.Conway do
  @moduledoc """
  2-D cellular game of life representation
  TODO abstract 1D elementary and 2D
  """
  # square of size size
  def genesis(name, size, generations, initial_life \\ nil) do
    board = seed(size, initial_life)
    print_board(board, name, size, 0)
    reason = generate(name, size, generations, board, 1)

    case reason do
      :all_dead ->
        "no more life."

      :static ->
        "no movement"

      reason ->
        reason
        # _  ->
        #   "specified lifetime ended"
    end
  end

  def reduce_genesis(name, size, generations, initial_life \\ nil) do
    board = seed(size, initial_life)
    print_board(board, name, size, 0)
    _reason = reduce_generate(name, size, generations, board, 1)

    # case reason do
    #   :all_dead ->
    #     "no more life."

    #   :static ->
    #     "no movement"

    #   reason ->
    #     reason
    #     # _  ->
    #     #   "specified lifetime ended"
    # end
  end

  defp new_board(n) do
    for x <- 1..n, y <- 1..n, into: %{}, do: {{x, y}, 0}
  end

  defp seed(n, points) do
    # randomly seed board
    if points do
      points
    else
      for(x <- 1..n, y <- 1..n, do: {x, y}) |> Enum.take_random(10)
    end
    |> Enum.reduce(new_board(n), fn pos, acc -> %{acc | pos => 1} end)
  end

  defp generate(_, size, generations, board, gen) when generations < gen,
    do: print_board(board, size)

  defp generate(name, size, generations, board, gen) do
    new = evolve(board, size)

    cond do
      barren?(new) -> :all_dead
      board == new -> :static
      true -> generate(name, size, generations, new, gen + 1)
    end
  end

  defp reduce_generate(n, s, g, b, gen, play \\ [])

  defp reduce_generate(_, size, generations, board, gen, play) when generations < gen,
    do: [print_board(board, size) | play]

  defp reduce_generate(name, size, generations, board, gen, play) do
    new = evolve(board, size)
    play = [print_board(board, size) | play]

    cond do
      barren?(new) -> :all_dead
      board == new -> :static
      true -> reduce_generate(name, size, generations, new, gen + 1, play)
    end
  end

  defp evolve(board, n) do
    for x <- 1..n, y <- 1..n, into: %{}, do: {{x, y}, fate(board, x, y, n)}
  end

  defp fate(board, x, y, n) do
    irange = max(1, x - 1)..min(x + 1, n)
    jrange = max(1, y - 1)..min(y + 1, n)
    sum = (for(i <- irange, j <- jrange, do: board[{i, j}]) |> Enum.sum()) - board[{x, y}]

    cond do
      sum == 3 -> 1
      sum == 2 and board[{x, y}] == 1 -> 1
      true -> 0
    end
  end

  defp barren?(board) do
    Enum.all?(board, fn {_, v} -> v == 0 end)
  end

  defp print_board(_board, _name, _n, _generation) do
    :ok
  end

  # defp print_board(board, name, n, generation) do
  #   IO.puts "#{name}: generation #{generation}"
  #   Enum.each(1..n, fn y ->
  #     Enum.map(1..n, fn x -> if board[{x,y}]==1, do: "⬛", else: "⬜" end)
  #     |> IO.puts
  #   end)
  # end

  defp print_board(board, n) do
    Enum.map(1..n, fn y ->
      "## " <>
        (Enum.map(1..n, fn x -> if board[{x, y}] == 1, do: "⬛", else: "⬜" end)
         |> Enum.join(""))
    end)
    |> Enum.join("
")
  end
end
