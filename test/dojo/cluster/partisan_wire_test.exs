defmodule Dojo.Cluster.PartisanWireTest do
  @moduledoc """
  What crosses the wire as itself, and what does not.

  `ref_encoding` rewrites every reference into a `partisan_remote_ref` form
  before it leaves the node, so a reference that arrives is an *address*, not the
  term that was sent. A payload needing identity carries a value; a `make_ref()`
  token matches on the far side only by accident (D070.7).
  """
  use ExUnit.Case, async: true

  test "a reference in a payload does not survive as itself" do
    ref = make_ref()
    wire = round_trip({:tok, ref})

    refute wire == {:tok, ref}
    refute is_reference(elem(wire, 1))
  end

  test "partisan:make_ref/0 is an address, not a reference" do
    # It returns the encoded form: there is no distinguishable "alias reference"
    # an encoder could leave alone, so identity cannot be preserved in general.
    refute is_reference(:partisan.make_ref())
  end

  test "a plain value crosses unchanged" do
    token = "tok-#{System.unique_integer([:positive])}"

    assert round_trip({:tok, token}) == {:tok, token}
  end

  defp round_trip(term) do
    term
    |> :partisan_util.encode()
    |> IO.iodata_to_binary()
    |> :erlang.binary_to_term()
  end
end
