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
  @root Dojo.KeepSigning.root(String.duplicate("e", 64))
  @target String.duplicate("f", 64)
  @png "PNGBYTES"

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

    payload =
      %{"id" => id, "message" => bytes}
      |> maybe_put("source", Keyword.get(opts, :source))
      |> maybe_image(Keyword.get(opts, :image, @png))

    Keep.receive(Dojo.KeepSigning.sign(payload),
      clan: clan,
      author_id: author_id,
      name: Keyword.get(opts, :name)
    )
  end

  # A targetless origin: its id IS the work (keep kernel).
  defp targetless(root), do: snap_for(root, nil, "origin", 1)

  defp snap_for(root, target, title, t) do
    body = %{
      "v" => 1,
      "kind" => "snap",
      "root" => root,
      "ts" => %{"t" => 1_700_000_000_000 + t, "n" => 0},
      "title" => title
    }

    body = if target, do: Map.put(body, "target", target), else: body
    Jason.encode!(body)
  end

  defp maybe_put(payload, _key, nil), do: payload
  defp maybe_put(payload, key, value), do: Map.put(payload, key, value)

  defp maybe_image(payload, false), do: payload

  defp maybe_image(payload, bin) when is_binary(bin),
    do: Map.put(payload, "image", Base.encode64(bin))

  defp count_keeps(id) do
    from(k in "keeps", where: k.id == ^id, select: count(k.id)) |> Repo.one()
  end

  describe "honest ship" do
    test "shared carries the row's fact; message is stored verbatim" do
      bytes = snap()
      id = Keep.hash(bytes)

      assert %{id: _, at: _, node: _} = fact = ship(bytes)
      assert fact.id == id
      assert is_integer(fact.at)
      assert is_binary(fact.node) and fact.node != ""
      # Continuant for presence — not the keep id (id:kb-8).
      assert fact.target == @target

      message =
        from(k in "keeps", where: k.id == ^id, select: k.message) |> Repo.one()

      assert message == bytes
      assert count_keeps(id) == 1
    end

    test "unknown kind is shared — meaning is never judged" do
      bytes = snap(kind: "invented-today")
      assert %{id: id} = fact = ship(bytes, image: false)
      refute Map.has_key?(fact, :why)
      assert id == Keep.hash(bytes)
    end

    test "ship twice is once — same fact for both replies" do
      bytes = snap()

      assert %{id: _} = a = ship(bytes)
      # A later stamp must not leak: read back is the row.
      Process.sleep(2)
      assert %{id: _} = b = ship(bytes)

      assert a == b
      assert count_keeps(a.id) == 1
    end
  end

  describe "permanent refusals are answers" do
    test "name mismatch → refused :name, stamped, no row" do
      bytes = snap()
      bad = String.duplicate("0", 64)

      assert %{id: _, why: _} = r = ship(bytes, id: bad)
      assert r.id == bad
      assert r.why == :name
      assert is_integer(r.at)
      assert is_binary(r.node)
      assert count_keeps(bad) == 0
      assert count_keeps(Keep.hash(bytes)) == 0
    end

    test "unparseable → refused :unparseable, stamped" do
      assert %{id: _, why: _} =
               r =
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
      assert %{id: _, why: _} = r = ship(bytes)
      assert r.id == id
      assert r.why == :shape
      assert count_keeps(id) == 0
    end

    test "missing message → refused :shape" do
      assert %{id: _, why: _} =
               r =
               Keep.receive(%{"id" => "only-id"}, clan: @clan, author_id: @author)

      assert r.why == :shape
    end

    test "empty payload → silence, not an answer" do
      assert Keep.receive(%{}, clan: @clan, author_id: @author) == nil
    end
  end

  describe "the roots row — bookkeeping, not a fence" do
    test "first author is recorded on the root row; their keep is shared" do
      bytes = snap()
      assert %{id: _} = ship(bytes, author_id: @author)

      bound =
        from(r in "roots",
          where: r.root == ^@root,
          select: %{clan: r.clan, author_id: r.author_id}
        )
        |> Repo.one()

      assert bound.clan == @clan
      assert bound.author_id == @author
    end

    test "attach/remember withdrawn — authors stays empty; first author_id stands" do
      assert %{id: _} = ship(snap(), name: "alice")

      assert Repo.one(from(a in "authors", select: count(a.author_id))) == 0

      assert %{id: _} =
               ship(snap(title: "again", n: 1), author_id: @other, name: "Alice Chen")

      assert Repo.one(from(a in "authors", select: count(a.author_id))) == 0

      assert Repo.one(from(r in "roots", where: r.root == ^@root, select: r.author_id)) ==
               @author
    end

    test "a foreign-root child lands, and joins no river without an origin" do
      # The fence moved from the write to evidence: bytes are retained, and
      # membership needs the origin's root (Member law), not a first writer.
      mine = snap(title: "mine", t: 1_700_000_000_000)

      theirs =
        Jason.encode!(%{
          "source_id" => "abc",
          "title" => "theirs",
          "v" => 1,
          "kind" => "snap",
          "root" => Dojo.KeepSigning.root(String.duplicate("9", 64)),
          "ts" => %{"t" => 1_700_000_999_999, "n" => 0},
          "target" => @target
        })

      assert %{id: _} = ship(mine, author_id: @author)
      assert %{id: id, at: at} = ship(theirs, author_id: @other)
      assert is_integer(at)
      assert id == Keep.hash(theirs)
      assert count_keeps(id) == 1, "bytes land"

      assert Repo.one(from(w in "works", select: count(w.work_id))) == 0
      assert Keep.history(@target, of: :target) == {[], nil}
      assert Keep.pull(@target) == :none
    end

    test "another room's ship lands; the roots row is bookkeeping, not a fence" do
      a = snap(title: "alice", n: 0)
      b = snap(title: "elsewhere", n: 1)

      assert %{id: _} = ship(a, clan: @clan)
      assert %{id: _} = ship(b, clan: "other-clan")

      # Retention is not ownership: the second room's bytes land.
      assert count_keeps(Keep.hash(b)) == 1
      assert count_keeps(Keep.hash(a)) == 1

      # The first arrival still names the root's recorded room — a fact beside
      # the bytes, never a veto, and never a grant.
      assert Repo.one(from(r in "roots", where: r.root == ^@root, select: r.clan)) == @clan
    end

    test "a rename does not sever the bind — author_id is recorded, not compared" do
      # The wound (id:kb-vet5 40): comparing author_id made every later keep of
      # that root a permanent refusal. author_id is never a write fence.
      before = snap(title: "before", n: 0)
      after_rename = snap(title: "after", n: 1)

      assert %{id: _} = ship(before, author_id: @author)
      assert %{id: _} = ship(after_rename, author_id: @other)

      assert count_keeps(Keep.hash(after_rename)) == 1

      # First insert stands. attach withdrawn — no rewrite.
      bound =
        from(r in "roots", where: r.root == ^@root, select: r.author_id) |> Repo.one()

      assert bound == @author
    end

    test "same author ships many keeps under one bound root" do
      a = snap(title: "one", n: 0)
      b = snap(title: "two", n: 1)

      assert %{id: _} = ship(a)
      assert %{id: _} = ship(b)
      assert count_keeps(Keep.hash(a)) == 1
      assert count_keeps(Keep.hash(b)) == 1
    end
  end

  # One judgement per continuant, by its primary key (id:ka-rule).
  describe "works — evidence, not a bind (keep-cut IV)" do
    test "a continuation writes no works row; origin and child are the members" do
      origin = targetless(@root)
      work = Keep.hash(origin)
      assert %{id: ^work} = ship(origin)

      child = snap_for(@root, work, "child", 2)
      assert %{id: child_id} = ship(child)

      assert Repo.one(from(w in "works", select: count(w.work_id))) == 0

      assert {rows, _} = Keep.history(work, of: :target, n: 10)
      assert Enum.sort(Enum.map(rows, & &1.id)) == Enum.sort([work, child_id])
    end

    test "a foreign-root child is retained and never a member" do
      origin = targetless(@root)
      work = Keep.hash(origin)
      assert %{id: ^work} = ship(origin)

      stranger = Dojo.KeepSigning.root(String.duplicate("9", 64))
      theirs = snap_for(stranger, work, "theirs", 3)

      assert %{id: theirs_id} = ship(theirs, author_id: @other)
      assert count_keeps(theirs_id) == 1, "bytes land"

      assert {rows, _} = Keep.history(work, of: :target, n: 10)
      assert Enum.map(rows, & &1.root) |> Enum.uniq() == [@root]
      refute theirs_id in Enum.map(rows, & &1.id)
    end

    test "a child before its origin is pending, then eligible when the origin arrives" do
      origin = targetless(@root)
      work = Keep.hash(origin)
      child = snap_for(@root, work, "early", 2)

      assert %{id: child_id} = ship(child)
      assert Keep.history(work, of: :target) == {[], nil}, "no origin, no membership"

      assert %{id: ^work} = ship(origin)
      assert {rows, _} = Keep.history(work, of: :target, n: 10)
      assert Enum.sort(Enum.map(rows, & &1.id)) == Enum.sort([work, child_id])
    end

    test "an unheard-of kind lands; nothing binds" do
      walk = fn root ->
        Jason.encode!(%{
          "v" => 1,
          "kind" => "walk",
          "root" => root,
          "ts" => %{"t" => 1_700_000_000_000, "n" => 0},
          "target" => @target
        })
      end

      assert %{id: _} = ship(walk.(@root))

      assert %{id: _} =
               ship(walk.(Dojo.KeepSigning.root(String.duplicate("9", 64))), author_id: @other)

      assert Repo.one(from(w in "works", select: count(w.work_id))) == 0
    end
  end

  describe "the referent law — source (id:kb-vet5-referent)" do
    test "the source rides the ship and lands under its DERIVED name" do
      # The wound (id:kb-vet5 39): the client shipped it, the server dropped
      # it, and every peer's keep arrived a tombstone — a name, a time, a
      # target and nothing to show.
      text = "fd 100 rt 90"
      bytes = snap()

      assert %{id: _} = ship(bytes, source: text)

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

      assert %{id: _} = ship(bytes, source: text)

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
        ship(bytes, source: text)
      end

      count = from(s in "sources", select: count(s.id)) |> Repo.one()
      assert count == 1
    end

    test "a keep with no source held still lands — absence is a state, not a refusal" do
      bytes = snap()
      assert %{id: _} = ship(bytes)
      assert count_keeps(Keep.hash(bytes)) == 1
      assert from(s in "sources", select: count(s.id)) |> Repo.one() == 0
    end
  end

  describe "the ceiling — one sentence, message and referents (finding 47)" do
    test "an oversized message is a permanent refusal, stamped" do
      big = String.duplicate("x", 300 * 1024)
      bytes = snap(title: big)

      assert %{id: _, why: _} = r = ship(bytes)
      assert r.why == :too_big
      assert is_integer(r.at)
      assert count_keeps(Keep.hash(bytes)) == 0
    end

    test "an oversized source refuses the ship — the keep does not land half" do
      bytes = snap()

      assert %{id: _, why: _} =
               r = ship(bytes, source: String.duplicate("x", 300 * 1024))

      assert r.why == :too_big
      assert count_keeps(Keep.hash(bytes)) == 0
    end
  end

  describe "image — rides the insert when the mint held one" do
    defp image_of(id) do
      from(k in "keeps", where: k.id == ^id, select: k.image) |> Repo.one()
    end

    test "a snap lands with its picture in the same insert" do
      bytes = snap()
      assert %{id: id} = ship(bytes, image: "FACE")
      assert image_of(id) == "FACE"
    end

    test "a snap without a picture is a row — face is the named absence" do
      bytes = snap()
      assert %{id: id} = fact = ship(bytes, image: false)
      refute Map.has_key?(fact, :why)
      assert image_of(id) == nil
    end

    test "an unknown kind lands without a face" do
      bytes = snap(kind: "invented-today")
      assert %{id: id} = fact = ship(bytes, image: false)
      refute Map.has_key?(fact, :why)
      assert image_of(id) == nil
    end

    test "an oversized or unreadable picture refuses the ship — no half keep" do
      bytes = snap()
      id = Keep.hash(bytes)

      assert %{why: :unparseable} =
               Keep.receive(
                 %{"id" => id, "message" => bytes, "image" => "!!not-base64!!"},
                 clan: @clan,
                 author_id: @author
               )

      assert %{why: :too_big} = ship(bytes, image: String.duplicate("A", 300 * 1024))
      assert count_keeps(id) == 0
    end

    test "ship twice is once for the picture too — first write wins" do
      bytes = snap()
      assert %{id: id} = ship(bytes, image: "FIRST")
      assert %{id: ^id} = ship(bytes, image: "SECOND")
      assert image_of(id) == "FIRST"
    end

    test "the receipt names the stored picture digest" do
      bytes = snap()
      assert %{image_digest: digest} = ship(bytes, image: "FACE")
      assert digest == Keep.hash("FACE")
    end

    test "a text-only receipt names no picture" do
      assert %{image_digest: nil} = ship(snap(), image: false)
    end

    test "a second picture under one id reports the FIRST digest" do
      bytes = snap()
      assert %{id: id, image_digest: first} = ship(bytes, image: "FIRST")
      assert %{id: ^id, image_digest: ^first} = ship(bytes, image: "SECOND")
      assert image_of(id) == "FIRST"
      assert first == Keep.hash("FIRST")
    end
  end

  describe "structural" do
    test "clan is never read from the message" do
      src = File.read!("lib/dojo/keep.ex")
      refute src =~ ~s|e["clan"]|
    end

    test "receive is the one insert path for keeps" do
      # No second write API. insert_all on "keeps" lives only here, via row/5.
      src = File.read!("lib/dojo/keep.ex")
      assert src =~ ~s|insert_all("keeps"|
      assert length(Regex.scan(~r/insert_all\("keeps"/, src)) == 1
      assert src =~ "row(cols, clan, at, node, image)"
    end
  end
end
