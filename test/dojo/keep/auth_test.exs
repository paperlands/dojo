defmodule Dojo.Keep.AuthTest do
  use Dojo.DataCase

  alias Dojo.Keep
  alias Dojo.KeepSigning, as: Signing

  setup do
    hand = Signing.identity("alice")
    message = message(hand.root)

    payload = %{
      "id" => Keep.hash(message),
      "message" => message,
      "proof" => Signing.proof(message, hand)
    }

    %{hand: hand, payload: payload}
  end

  defp message(root),
    do:
      Jason.encode!(%{"v" => 1, "kind" => "snap", "root" => root, "ts" => %{"t" => 1, "n" => 0}})

  defp ship(payload, clan \\ "signed-room"),
    do: Keep.receive(payload, clan: clan, author_id: "not-authority")

  defp counts do
    for table <- ~w(keeps roots clan_keeps sources keep_evidence keep_proofs), into: %{} do
      {table, Repo.one(from(r in table, select: count()))}
    end
  end

  defp refuses_without_writing(payload) do
    before = counts()

    assert %{why: :auth} =
             ship(
               Map.merge(payload, %{"source" => "not retained", "image" => Base.encode64("png")})
             )

    assert counts() == before
  end

  test "valid proof retains exact bytes, root evidence and detached proof atomically", %{
    payload: payload,
    hand: hand
  } do
    assert %{id: id} = receipt = ship(payload)
    refute Map.has_key?(receipt, :why)
    assert {:ok, %{message: message, proof: proof}} = Keep.get(id)
    assert proof |> Jason.encode!() |> Jason.decode!() == payload["proof"]
    assert message == payload["message"]
    assert Keep.owner_of(id) == hand.root

    assert Repo.one(
             from(e in "keep_evidence",
               select: %{root: e.root, epoch: e.epoch, genesis: e.genesis}
             )
           ) ==
             %{root: hand.root, epoch: 0, genesis: hand.genesis}

    assert Repo.one(from(p in "keep_proofs", select: p.signature)) ==
             payload["proof"]["signature"]

    assert ship(payload) == receipt
    assert %{id: ^id} = ship(payload, "second-room")
    assert counts()["keeps"] == 1
    assert counts()["keep_proofs"] == 1
    assert counts()["keep_evidence"] == 1
    assert counts()["clan_keeps"] == 2
  end

  test "missing proof cannot use any legacy binding or a previously accepted id", %{
    payload: payload,
    hand: hand
  } do
    Repo.insert_all("roots", [
      %{root: hand.root, clan: "signed-room", author_id: "not-authority", bound_at: 0}
    ])

    Repo.insert_all("works", [%{work_id: payload["id"], root: hand.root}])
    refuses_without_writing(Map.delete(payload, "proof"))
    assert %{id: _} = ship(payload)
    refuses_without_writing(Map.delete(payload, "proof"))
  end

  test "a valid key cannot acquire another hand by naming its public root", %{payload: payload} do
    mallory = Signing.identity("mallory")
    refuses_without_writing(Map.put(payload, "proof", Signing.proof(payload["message"], mallory)))

    forged =
      put_in(
        payload,
        ["proof", "signature"],
        Signing.proof(payload["message"], mallory)["signature"]
      )

    refuses_without_writing(forged)
  end

  test "changed bytes fail even when rehashed under a fresh id", %{payload: payload} do
    changed = payload["message"] <> " "
    refuses_without_writing(%{payload | "message" => changed, "id" => Keep.hash(changed)})
  end

  test "wrong domain, corrupt encoding, missing and unknown versions fail closed", %{
    payload: payload,
    hand: hand
  } do
    der = :crypto.sign(:ecdsa, :sha256, payload["message"], [hand.private, :secp256r1])
    {:"ECDSA-Sig-Value", r, s} = :public_key.der_decode(:"ECDSA-Sig-Value", der)
    raw = Base.encode16(<<r::256, s::256>>, case: :lower)

    for proof <- [
          nil,
          %{},
          [],
          Map.delete(payload["proof"], "v"),
          Map.put(payload["proof"], "v", 2),
          Map.put(payload["proof"], "signature", raw),
          Map.put(payload["proof"], "signature", String.duplicate("0", 128)),
          Map.put(payload["proof"], "signature", String.duplicate("A", 128)),
          Map.put(payload["proof"], "extra", true)
        ] do
      refuses_without_writing(Map.put(payload, "proof", proof))
    end
  end

  test "keyless, duplicate-key, oversized and inadmissible genesis cannot enroll", %{
    payload: payload
  } do
    original = Jason.decode!(payload["proof"]["genesis"])
    auth = original["auth"]

    births = [
      original |> Map.delete("auth") |> Jason.encode!(),
      original |> put_in(["auth", "algorithm"], "Ed25519") |> Jason.encode!(),
      original
      |> put_in(["auth", "public_key"], "04" <> String.duplicate("0", 128))
      |> Jason.encode!(),
      ~s({"v":1,"v":1,"kind":"genesis","ts":{"t":0,"n":0},"auth":#{Jason.encode!(auth)}}),
      String.duplicate("x", 64 * 1024 + 1)
    ]

    for birth <- births do
      bytes = message(Keep.hash(birth))
      proof = %{payload["proof"] | "genesis" => birth}
      refuses_without_writing(%{"id" => Keep.hash(bytes), "message" => bytes, "proof" => proof})
    end
  end

  test "duplicate message keys cannot create parser-dependent authority", %{hand: hand} do
    bytes =
      ~s({"v":1,"kind":"snap","root":"other","root":"#{hand.root}","ts":{"t":1,"n":0}})

    refuses_without_writing(%{
      "id" => Keep.hash(bytes),
      "message" => bytes,
      "proof" => Signing.proof(bytes, hand)
    })
  end

  test "an invalid first proof cannot block a later valid proof", %{payload: payload} do
    refuses_without_writing(put_in(payload, ["proof", "signature"], String.duplicate("0", 128)))
    assert %{id: id} = receipt = ship(payload)
    refute Map.has_key?(receipt, :why)
    assert {:ok, %{id: ^id}} = Keep.head(id)
  end

  test "historical bytes and same-root ghosts cannot inherit an origin's proof", %{
    payload: payload,
    hand: hand
  } do
    ghost = message(hand.root)
    {:ok, cols} = Keep.project(ghost, Keep.hash(ghost))
    Repo.insert_all("keeps", [Keep.row(cols, "signed-room", 0, "old-node")])
    Repo.insert_all("clan_keeps", [%{clan: "signed-room", id: cols.id, at: 0, node: "old-node"}])
    assert {:ok, %{message: ^ghost, proof: nil}} = Keep.get(cols.id)
    assert Keep.owner_of(cols.id) == nil
    assert Keep.head(cols.id) == :none
    assert Keep.history(cols.id) == {[], nil}
    assert Keep.latest("signed-room") == {[], nil}

    assert %{id: work} = ship(payload)

    child =
      Jason.encode!(%{
        "v" => 1,
        "kind" => "snap",
        "root" => hand.root,
        "target" => work,
        "ts" => %{"t" => 999, "n" => 0}
      })

    {:ok, cols} = Keep.project(child, Keep.hash(child))
    Repo.insert_all("keeps", [Keep.row(cols, "signed-room", 999, "old-node")])

    Repo.insert_all("clan_keeps", [%{clan: "signed-room", id: cols.id, at: 999, node: "old-node"}])

    assert {:ok, %{id: ^work}} = Keep.head(work)
    assert {[%{id: ^work}], nil} = Keep.history(work)
    assert {[%{id: ^work}], nil} = Keep.latest("signed-room")
    assert {:ok, %{message: ^child}} = Keep.get(cols.id)
  end

  test "proof insertion failure rolls back bytes, bindings, sources and receipts", %{
    payload: payload
  } do
    before = counts()

    Repo.query!(
      "CREATE TEMP TRIGGER reject_proof BEFORE INSERT ON keep_proofs BEGIN SELECT RAISE(ABORT, 'proof failure'); END"
    )

    assert_raise Exqlite.Error, fn -> ship(Map.put(payload, "source", "rolled back")) end
    Repo.query!("DROP TRIGGER reject_proof")
    assert counts() == before
  end
end
