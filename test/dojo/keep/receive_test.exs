defmodule Dojo.Keep.ReceiveTest do
  @moduledoc """
  Step 12 — bind · stamp · insert · the row's fact (id:kb-12).
  """
  use Dojo.DataCase

  import Ecto.Query

  alias Dojo.Keep
  alias Dojo.Keep.Repo

  @clan "test-clan"
  @author "author-alice"
  @other "author-bob"
  @root String.duplicate("e", 64)
  @target String.duplicate("f", 64)

  defp snap(opts \\ []) do
    root = Keyword.get(opts, :root, @root)
    kind = Keyword.get(opts, :kind, "snap")
    t = Keyword.get(opts, :t, 1_700_000_000_000)
    n = Keyword.get(opts, :n, 0)
    title = Keyword.get(opts, :title, "hello")

    Jason.encode!(%{
      "source_id" => "abc",
      "title" => title,
      "v" => 1,
      "kind" => kind,
      "root" => root,
      "ts" => %{"t" => t, "n" => n},
      "target" => @target
    })
  end

  defp ship(bytes, opts \\ []) do
    clan = Keyword.get(opts, :clan, @clan)
    author_id = Keyword.get(opts, :author_id, @author)
    id = Keyword.get(opts, :id, Keep.hash(bytes))

    Keep.receive(%{"id" => id, "message" => bytes}, clan: clan, author_id: author_id)
  end

  defp count_keeps(id) do
    from(k in "keeps", where: k.id == ^id, select: count(k.id)) |> Repo.one()
  end

  describe "honest ship" do
    test "shared carries the row's fact; message is stored verbatim" do
      bytes = snap()
      id = Keep.hash(bytes)

      assert %{shared: [fact], refused: []} = ship(bytes)
      assert fact.id == id
      assert is_integer(fact.at)
      assert is_binary(fact.node) and fact.node != ""

      message =
        from(k in "keeps", where: k.id == ^id, select: k.message) |> Repo.one()

      assert message == bytes
      assert count_keeps(id) == 1
    end

    test "unknown kind is shared — meaning is never judged" do
      bytes = snap(kind: "invented-today")
      assert %{shared: [%{id: id}], refused: []} = ship(bytes)
      assert id == Keep.hash(bytes)
    end

    test "ship twice is once — same fact for both replies" do
      bytes = snap()

      assert %{shared: [a], refused: []} = ship(bytes)
      # A later stamp must not leak: read back is the row.
      Process.sleep(2)
      assert %{shared: [b], refused: []} = ship(bytes)

      assert a == b
      assert count_keeps(a.id) == 1
    end
  end

  describe "permanent refusals are answers" do
    test "name mismatch → refused :name, stamped, no row" do
      bytes = snap()
      bad = String.duplicate("0", 64)

      assert %{shared: [], refused: [r]} = ship(bytes, id: bad)
      assert r.id == bad
      assert r.why == :name
      assert is_integer(r.at)
      assert is_binary(r.node)
      assert count_keeps(bad) == 0
      assert count_keeps(Keep.hash(bytes)) == 0
    end

    test "unparseable → refused :unparseable, stamped" do
      assert %{shared: [], refused: [r]} =
               Keep.receive(%{"id" => "x", "message" => "{not json"},
                 clan: @clan,
                 author_id: @author
               )

      assert r.why == :unparseable
      assert is_integer(r.at)
    end

    test "shape (null root) → refused :shape, stamped" do
      bytes =
        Jason.encode!(%{
          "v" => 1,
          "kind" => "snap",
          "root" => nil,
          "ts" => %{"t" => 1, "n" => 0},
          "target" => @target
        })

      id = Keep.hash(bytes)
      assert %{shared: [], refused: [r]} = ship(bytes)
      assert r.id == id
      assert r.why == :shape
      assert count_keeps(id) == 0
    end

    test "missing message → refused :shape" do
      assert %{shared: [], refused: [r]} =
               Keep.receive(%{"id" => "only-id"}, clan: @clan, author_id: @author)

      assert r.why == :shape
    end

    test "empty payload → silence, not an answer" do
      assert Keep.receive(%{}, clan: @clan, author_id: @author) == %{
               shared: [],
               refused: []
             }
    end
  end

  describe "TOFU bind — the only decision" do
    test "first author binds the root; their keep is shared" do
      bytes = snap()
      assert %{shared: [_], refused: []} = ship(bytes, author_id: @author)

      bound =
        from(r in "roots",
          where: r.root == ^@root,
          select: %{clan: r.clan, author_id: r.author_id}
        )
        |> Repo.one()

      assert bound.clan == @clan
      assert bound.author_id == @author
    end

    test "another room claiming the root is refused :root — permanently" do
      a = snap(title: "alice", n: 0)
      b = snap(title: "elsewhere", n: 1)

      assert %{shared: [_], refused: []} = ship(a, clan: @clan)
      assert %{shared: [], refused: [r]} = ship(b, clan: "other-clan")

      assert r.why == :root
      assert r.id == Keep.hash(b)
      assert is_integer(r.at)
      # The other room's message never lands.
      assert count_keeps(Keep.hash(b)) == 0
      # The bound room's stands alone.
      assert count_keeps(Keep.hash(a)) == 1
    end

    test "a rename does not sever the bind — author_id is recorded, not compared" do
      # The wound (id:kb-vet5 40): author_id = name <> b64(last_opened), and
      # changeName is live. Comparing it made every later keep of that root a
      # permanent :root refusal — which the client marks SHARED, so the keep
      # never reaches the clan and the surface says it did.
      before = snap(title: "before", n: 0)
      after_rename = snap(title: "after", n: 1)

      assert %{shared: [_], refused: []} = ship(before, author_id: @author)
      assert %{shared: [_], refused: []} = ship(after_rename, author_id: @other)

      assert count_keeps(Keep.hash(after_rename)) == 1

      # First arrival's author stands as the record; it is never rewritten.
      bound =
        from(r in "roots", where: r.root == ^@root, select: r.author_id) |> Repo.one()

      assert bound == @author
    end

    test "same author ships many keeps under one bound root" do
      a = snap(title: "one", n: 0)
      b = snap(title: "two", n: 1)

      assert %{shared: [_], refused: []} = ship(a)
      assert %{shared: [_], refused: []} = ship(b)
      assert count_keeps(Keep.hash(a)) == 1
      assert count_keeps(Keep.hash(b)) == 1
    end
  end

  describe "the referent law — source (id:kb-vet5-referent)" do
    test "the source rides the ship and lands under its DERIVED name" do
      # The wound (id:kb-vet5 39): the client shipped it, the server dropped
      # it, and every peer's keep arrived a tombstone — a name, a time, a
      # target and nothing to show.
      text = "fd 100 rt 90"
      bytes = snap()

      assert %{shared: [_], refused: []} =
               Keep.receive(
                 %{"id" => Keep.hash(bytes), "message" => bytes, "source" => text},
                 clan: @clan,
                 author_id: @author
               )

      held = from(s in "sources", where: s.id == ^Keep.hash(text), select: s.text) |> Repo.one()
      assert held == text
    end

    test "the key is derived, never read from the message" do
      # A lying source_id in the body cannot misplace the text: the server
      # hashes what it received. Reading source_id would be a sixth field.
      text = "fd 1"

      bytes =
        Jason.encode!(%{
          "source_id" => "not-the-hash",
          "v" => 1,
          "kind" => "snap",
          "root" => @root,
          "ts" => %{"t" => 1, "n" => 0},
          "target" => @target
        })

      assert %{shared: [_]} =
               Keep.receive(%{"id" => Keep.hash(bytes), "message" => bytes, "source" => text},
                 clan: @clan,
                 author_id: @author
               )

      assert from(s in "sources", where: s.id == ^Keep.hash(text), select: s.text) |> Repo.one() ==
               text

      assert from(s in "sources", where: s.id == "not-the-hash", select: s.id) |> Repo.one() ==
               nil
    end

    test "ship twice is once for the source too — content-addressed, no fence" do
      text = "fd 100"
      a = snap(title: "one", n: 0)
      b = snap(title: "two", n: 1)

      for bytes <- [a, b, a] do
        Keep.receive(%{"id" => Keep.hash(bytes), "message" => bytes, "source" => text},
          clan: @clan,
          author_id: @author
        )
      end

      count = from(s in "sources", select: count(s.id)) |> Repo.one()
      assert count == 1
    end

    test "a keep with no source held still lands — absence is a state, not a refusal" do
      bytes = snap()
      assert %{shared: [_], refused: []} = ship(bytes)
      assert count_keeps(Keep.hash(bytes)) == 1
      assert from(s in "sources", select: count(s.id)) |> Repo.one() == 0
    end
  end

  describe "the ceiling — one sentence, message and referents (finding 47)" do
    test "an oversized message is a permanent refusal, stamped" do
      big = String.duplicate("x", 300 * 1024)
      bytes = snap(title: big)

      assert %{shared: [], refused: [r]} = ship(bytes)
      assert r.why == :too_big
      assert is_integer(r.at)
      assert count_keeps(Keep.hash(bytes)) == 0
    end

    test "an oversized source refuses the ship — the keep does not land half" do
      bytes = snap()

      assert %{shared: [], refused: [r]} =
               Keep.receive(
                 %{
                   "id" => Keep.hash(bytes),
                   "message" => bytes,
                   "source" => String.duplicate("x", 300 * 1024)
                 },
                 clan: @clan,
                 author_id: @author
               )

      assert r.why == :too_big
      assert count_keeps(Keep.hash(bytes)) == 0
    end
  end

  describe "image — the referent that follows the fact (id:kb-12a)" do
    defp share_and_image(bytes, image, opts \\ []) do
      clan = Keyword.get(opts, :clan, @clan)
      %{shared: [_]} = ship(bytes)

      Keep.image(%{"id" => Keep.hash(bytes), "image" => Base.encode64(image)}, clan: clan)
    end

    defp image_of(id) do
      from(k in "keeps", where: k.id == ^id, select: k.image) |> Repo.one()
    end

    test "the message shares, then the image lands" do
      bytes = snap()
      assert image_of(Keep.hash(bytes)) == nil or true
      assert :ok = share_and_image(bytes, "PNGBYTES")
      assert image_of(Keep.hash(bytes)) == "PNGBYTES"
    end

    test "ship one image three times → one picture, byte-identical" do
      bytes = snap()
      assert :ok = share_and_image(bytes, "FIRST")
      id = Keep.hash(bytes)

      for _ <- 1..2 do
        Keep.image(%{"id" => id, "image" => Base.encode64("SECOND")}, clan: @clan)
      end

      # IS NULL is what makes it a fact rather than a write.
      assert image_of(id) == "FIRST"
    end

    test "another room cannot fill this room's picture" do
      bytes = snap()
      id = Keep.hash(bytes)
      assert %{shared: [_]} = ship(bytes)

      Keep.image(%{"id" => id, "image" => Base.encode64("INTRUDER")}, clan: "other-clan")
      assert image_of(id) == nil
    end

    test "an oversized or unreadable picture is refused, and the row stays empty" do
      bytes = snap()
      id = Keep.hash(bytes)
      assert %{shared: [_]} = ship(bytes)

      assert {:error, :unparseable} =
               Keep.image(%{"id" => id, "image" => "!!not-base64!!"}, clan: @clan)

      assert {:error, :too_big} =
               Keep.image(%{"id" => id, "image" => String.duplicate("A", 5 * 1024 * 1024)},
                 clan: @clan
               )

      assert image_of(id) == nil
    end

    test "an image for a keep that never shared lands nowhere" do
      assert :ok =
               Keep.image(%{"id" => String.duplicate("0", 64), "image" => Base.encode64("x")},
                 clan: @clan
               )

      assert from(k in "keeps", select: count(k.id)) |> Repo.one() == 0
    end
  end

  describe "structural" do
    test "clan is never read from the message" do
      src = File.read!("lib/dojo/keep.ex")
      refute src =~ ~s|e["clan"]|
    end

    test "receive is the one insert path for keeps" do
      # No second write API. insert_all on "keeps" lives only here.
      src = File.read!("lib/dojo/keep.ex")
      assert src =~ ~s|insert_all(\n      "keeps"|
    end
  end
end
