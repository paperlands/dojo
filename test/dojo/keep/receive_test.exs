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

    Keep.receive(payload,
      clan: clan,
      author_id: author_id,
      name: Keyword.get(opts, :name)
    )
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

  describe "TOFU bind — the only decision" do
    test "first author binds the root; their keep is shared" do
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

    test "[⚠→✓] a clan-mate CANNOT take another member's river — refused :work" do
      # Closed (id:ka-hijack → id:ka-works-bind). The hole was on the write: target was unbound.
      mine = snap(title: "mine", t: 1_700_000_000_000)

      theirs =
        Jason.encode!(%{
          "source_id" => "abc",
          "title" => "theirs",
          "v" => 1,
          "kind" => "snap",
          "root" => String.duplicate("9", 64),
          "ts" => %{"t" => 1_700_000_999_999, "n" => 0},
          "target" => @target
        })

      assert %{id: _} = ship(mine, author_id: @author)

      assert %{id: id, at: at, node: _, why: :work} = ship(theirs, author_id: @other)
      assert id == Keep.hash(theirs)
      assert is_integer(at)
      assert count_keeps(Keep.hash(theirs)) == 0

      roots =
        from(k in "keeps", where: k.target == ^@target, select: k.root)
        |> Repo.all()
        |> Enum.uniq()

      assert roots == [@root], "one river, one hand — the ordering argument holds"

      assert {:ok, %{message: head}} = Keep.pull(@target)
      assert Jason.decode!(head)["title"] == "mine"
    end

    test "another room claiming the root is refused :root — permanently" do
      a = snap(title: "alice", n: 0)
      b = snap(title: "elsewhere", n: 1)

      assert %{id: _} = ship(a, clan: @clan)
      assert %{id: _, why: _} = r = ship(b, clan: "other-clan")

      assert r.why == :root
      assert r.id == Keep.hash(b)
      assert is_integer(r.at)
      # The other room's message never lands.
      assert count_keeps(Keep.hash(b)) == 0
      # The bound room's stands alone.
      assert count_keeps(Keep.hash(a)) == 1
    end

    test "a rename does not sever the bind — author_id is recorded, not compared" do
      # The wound (id:kb-vet5 40): comparing author_id made every later keep of
      # that root a permanent :root refusal. author_id is never a write fence.
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
  describe "the works bind — a river belongs to one hand (id:ka-works-bind)" do
    test "first hand binds the work; the row is the judgement and nothing else" do
      assert %{id: _} = ship(snap())

      assert Repo.one(from(w in "works", where: w.work_id == ^@target, select: w.root)) ==
               @root
    end

    test "the same hand keeps again — bound once, never re-bound" do
      assert %{id: _} = ship(snap(title: "one", n: 0))
      assert %{id: _} = ship(snap(title: "two", n: 1))

      assert Repo.one(from(w in "works", where: w.work_id == ^@target, select: count(w.work_id))) ==
               1
    end

    test "a snap with no work is an origin — it lands; hang is the cut" do
      # Origin omits target. Its id *is* the work (keep kernel).
      bytes =
        Jason.encode!(%{
          "source_id" => "abc",
          "v" => 1,
          "kind" => "snap",
          "root" => @root,
          "ts" => %{"t" => 1_700_000_000_000, "n" => 0}
        })

      assert %{id: id, target: nil} = ship(bytes)
      assert is_binary(id)
      assert count_keeps(id) == 1
      # Pre-cut works bind only when target is present.
      assert Repo.one(from(w in "works", select: count(w.work_id))) == 0
    end

    test "an unheard-of kind binds nothing — enforcement fails OPEN" do
      # `target` carries more than one continuant (id:ka-selectors): a work has
      # one owner, a walk's NODE has none — many hands walk one node. A
      # kind-blind bind would let the first hand to walk a node own it and
      # refuse every other hand :work, permanently. And an old server must
      # never refuse a kind it has not heard of (id:kb-12), so the unknown case
      # binds nothing rather than claiming or rejecting.
      walk = fn root ->
        Jason.encode!(%{
          "v" => 1,
          "kind" => "walk",
          "root" => root,
          "ts" => %{"t" => 1_700_000_000_000, "n" => 0},
          "target" => @target
        })
      end

      assert %{id: _} = a = ship(walk.(@root))
      refute Map.has_key?(a, :why)
      # A SECOND HAND walking the same node is admitted, not refused.
      assert %{id: _} = b = ship(walk.(String.duplicate("9", 64)), author_id: @other)
      refute Map.has_key?(b, :why)

      assert Repo.one(from(w in "works", select: count(w.work_id))) == 0,
             "nothing binds a continuant nobody owns"
    end

    test "a refusal leaves NO partial binding — one transaction holds them all" do
      # kb-source-keys: when two stores hold one fact, one transaction holds
      # them. `roots` and `works` are two more such stores, and both used to
      # write BEFORE the transaction opened — two lines under a comment
      # quoting that very law. The observable proof: a stranger's root is bound
      # by step one and the work refuses at step two, so if the binds were
      # outside, their roots row would survive the refusal.
      stranger = String.duplicate("9", 64)

      theirs =
        Jason.encode!(%{
          "source_id" => "abc",
          "v" => 1,
          "kind" => "snap",
          "root" => stranger,
          "ts" => %{"t" => 1_700_000_000_001, "n" => 0},
          "target" => @target
        })

      assert %{id: _} = ship(snap())
      assert %{why: :work} = ship(theirs, author_id: @other)

      assert Repo.one(from(r in "roots", where: r.root == ^stranger, select: count(r.root))) == 0,
             "the root bind rolled back with the refusal"

      assert Repo.one(from(w in "works", where: w.work_id == ^@target, select: w.root)) == @root
      assert count_keeps(Keep.hash(theirs)) == 0
    end

    test "owned_kinds stays frozen — kinds/ is not a registry" do
      # Condemned. A 1:1 with kinds/ baptizes it and gives every future kind
      # a chair it has not earned (keep kernel 2026-09-06).
      assert Keep.owned_kinds() == %{"snap" => :work}
    end

    test "the refusal is permanent and stamped, so announce terminates" do
      # :work is permanent — re-shipping does not change the hand (id:kb-12).
      theirs =
        Jason.encode!(%{
          "source_id" => "abc",
          "v" => 1,
          "kind" => "snap",
          "root" => String.duplicate("9", 64),
          "ts" => %{"t" => 1_700_000_000_001, "n" => 0},
          "target" => @target
        })

      assert %{id: _} = ship(snap())
      assert %{why: :work, at: at1} = ship(theirs, author_id: @other)
      assert %{why: :work, at: at2} = ship(theirs, author_id: @other)
      assert is_integer(at1) and is_integer(at2)
      assert count_keeps(Keep.hash(theirs)) == 0
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
