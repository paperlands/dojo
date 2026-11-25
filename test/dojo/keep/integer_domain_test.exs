defmodule Dojo.Keep.IntegerDomainTest do
  use Dojo.DataCase

  alias Dojo.Keep
  alias Dojo.KeepSigning, as: Signing

  @max 9_007_199_254_740_991

  defp message(root, path, value) do
    %{"v" => 1, "kind" => "snap", "root" => root, "ts" => %{"t" => 0, "n" => 0}}
    |> put_in(path, value)
    |> Jason.encode!()
  end

  defp payload(bytes, hand),
    do: %{"id" => Keep.hash(bytes), "message" => bytes, "proof" => Signing.proof(bytes, hand)}

  defp ship(payload),
    do: Keep.receive(payload, clan: "integer-domain", author_id: "not-authority")

  defp counts do
    for table <- ~w(keeps roots clan_keeps sources keep_evidence keep_proofs),
        into: %{},
        do: {table, Repo.one(from(r in table, select: count()))}
  end

  test "the exact protocol maximum is admitted without changing bytes" do
    hand = Signing.identity("integer-boundary")

    for path <- [["v"], ["ts", "t"], ["ts", "n"]] do
      bytes = message(hand.root, path, @max)
      assert %{id: id} = reply = ship(payload(bytes, hand))
      refute Map.has_key?(reply, :why)
      assert {:ok, %{message: ^bytes}} = Keep.get(id)
    end
  end

  test "unsafe protocol integers refuse normally before any table write" do
    hand = Signing.identity("integer-refusal")
    before = counts()

    for path <- [["v"], ["ts", "t"], ["ts", "n"]],
        value <- [@max + 1, @max + 2, 9_223_372_036_854_775_808] do
      bytes = message(hand.root, path, value)
      assert %{why: :shape} = ship(Map.put(payload(bytes, hand), "source", "not retained"))
      assert counts() == before
    end
  end
end
