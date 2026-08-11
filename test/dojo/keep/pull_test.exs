defmodule Dojo.Keep.PullTest do
  @moduledoc """
  The read half of the fork word (id:la-fork-pull): two faces, the row's
  fact, the source beside the message — or an honest tombstone.
  """
  use Dojo.DataCase

  alias Dojo.Keep

  @clan "test-clan"
  @author "author-alice"
  @root String.duplicate("e", 64)
  @target String.duplicate("f", 64)

  defp snap(source, opts \\ []) do
    t = Keyword.get(opts, :t, 1_700_000_000_000)
    title = Keyword.get(opts, :title, "hello")

    Jason.encode!(%{
      "source_id" => Keep.hash(source),
      "title" => title,
      "v" => 1,
      "kind" => "snap",
      "root" => @root,
      "ts" => %{"t" => t, "n" => 0},
      "target" => @target
    })
  end

  defp ship(bytes, opts \\ []) do
    payload = %{"id" => Keep.hash(bytes), "message" => bytes}

    payload =
      case Keyword.get(opts, :source) do
        nil -> payload
        text -> Map.put(payload, "source", text)
      end

    Keep.receive(payload, clan: @clan, author_id: @author)
  end

  test "a keep id answers the message, its source, and the row's fact" do
    bytes = snap("fw 50")
    %{shared: [%{at: at}]} = ship(bytes, source: "fw 50")

    assert {:ok, keep} = Keep.pull(Keep.hash(bytes))
    assert keep.id == Keep.hash(bytes)
    assert keep.message == bytes
    assert keep.source == "fw 50"
    assert keep.at == at
    assert is_binary(keep.node)
  end

  test "a work id answers the HEAD of the chain" do
    older = snap("fw 1", t: 1_000, title: "first")
    newer = snap("fw 2", t: 2_000, title: "second")
    ship(older, source: "fw 1")
    ship(newer, source: "fw 2")

    assert {:ok, keep} = Keep.pull(@target)
    assert keep.id == Keep.hash(newer)
    assert keep.source == "fw 2"
  end

  test "a keep shipped without its source answers a tombstone" do
    bytes = snap("fw 3")
    ship(bytes)

    assert {:ok, keep} = Keep.pull(Keep.hash(bytes))
    assert keep.message == bytes
    assert keep.source == nil
  end

  test "an unknown ref is :none" do
    assert Keep.pull(String.duplicate("0", 64)) == :none
  end

  test "a ref that is not a minted name is :none, without a query" do
    assert Keep.pull("the-chase") == :none
    assert Keep.pull(String.duplicate("A", 64)) == :none
    assert Keep.pull(nil) == :none
  end
end
