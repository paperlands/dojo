defmodule Dojo.Automaton.Cell do
  @moduledoc """
  A Cell is the [primeveal] stateful life form. This module contains functions to handle lifetime functions of a cell.
  """

  @type cell_state :: 1 | 0

  @spec next_state(cell_state, integer()) :: cell_state
  def next_state(1, neighbor_count) when neighbor_count < 2, do: 0
  def next_state(1, neighbor_count) when neighbor_count in [2, 3], do: 1
  def next_state(1, neighbor_count) when neighbor_count >= 4, do: 0
  def next_state(0, neighbor_count) when neighbor_count < 3, do: 0
  def next_state(0, neighbor_count) when neighbor_count == 3, do: 1
  def next_state(0, neighbor_count) when neighbor_count > 3, do: 0
end
