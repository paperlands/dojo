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
    %{at: at} = ship(bytes, source: "fw 50")

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

  test "a work with keeps but no binding answers nothing, not a guess" do
    # Written past receive, so no bind — head_of answers nothing (id:ka-works-bind).
    bytes = snap("fw 9", t: 9_000, title: "unbound")
    {:ok, cols} = Keep.project(bytes, Keep.hash(bytes))
    Repo.insert_all("keeps", [Keep.row(cols, @clan, 1, "n")], on_conflict: :nothing)

    assert Keep.pull(@target) == :none
    # Still reachable by its own name (id:ka-capability).
    assert {:ok, %{id: _}} = Keep.pull(Keep.hash(bytes))
  end

  # THE TWO CLOCKS, USED AS TWO (id:ka-latest, id:kb-8's two orders).
  #   the author's clock orders WITHIN a river · the room's clock orders THE RIVERS
  describe "latest — the room's memory (id:ka-latest)" do
    defp keeps({rows, _next}), do: rows

    defp other_clan_snap(work, t) do
      Jason.encode!(%{
        "source_id" => Keep.hash("x"),
        "title" => "elsewhere",
        "v" => 1,
        "kind" => "snap",
        "root" => String.duplicate("7", 64),
        "ts" => %{"t" => t, "n" => 0},
        "target" => work
      })
    end

    test "one row per river — the head by the AUTHOR's clock" do
      older = snap("a", t: 1_000, title: "older")
      newer = snap("b", t: 2_000, title: "newer")
      ship(older, source: "a")
      ship(newer, source: "b")

      assert {[row], nil} = Keep.latest(@clan)
      assert row.target == @target
      assert row.id == Keep.hash(newer), "the head, not the oldest"
      assert Jason.decode!(row.message)["title"] == "newer"
    end

    test "rivers are ordered by the ROOM's clock, never the author's" do
      # The wound the old index encoded: keeps_latest_idx was (clan, ts_t DESC)
      # — the AUTHOR's clock — so a river stamped with a low ts_t sinks in the
      # room's memory forever, however recently the room met it.
      sunk = String.duplicate("1", 64)
      recent = String.duplicate("2", 64)

      ship(
        Jason.encode!(%{
          "source_id" => Keep.hash("s"),
          "v" => 1,
          "kind" => "snap",
          "root" => @root,
          "ts" => %{"t" => 1, "n" => 0},
          "target" => sunk
        }),
        source: "s"
      )

      ship(snap("r", t: 9_999_999_999_999, title: "high clock"), source: "r")

      ship(
        Jason.encode!(%{
          "source_id" => Keep.hash("t"),
          "v" => 1,
          "kind" => "snap",
          "root" => @root,
          "ts" => %{"t" => 2, "n" => 0},
          "target" => recent
        }),
        source: "t"
      )

      # [⚠] `shared_at` is MILLISECOND resolution, so three ships inside one
      # millisecond tie and their order is arbitrary. Stamp the arrivals
      # explicitly, so this measures the ORDER BY and not the clock's grain.
      # (The residue is real and named at id:ka-latest: rivers the room met in
      # the same millisecond are unordered among themselves.)
      met = fn work, at ->
        Repo.update_all(from(k in "keeps", where: k.target == ^work), set: [shared_at: at])
      end

      met.(sunk, 300)
      met.(@target, 200)
      met.(recent, 100)

      works = Keep.latest(@clan) |> keeps() |> Enum.map(& &1.target)

      assert works == [sunk, @target, recent],
             "the room's clock decides; the author's numbers (1, 9999999999999, 2) do not"

      assert hd(works) == sunk,
             "the LOWEST author clock sits first, because the room met it last"
    end

    test "the room asked for is the room answered" do
      # `clan` SELECTS a room; it does not fence one. Reads are open — privacy
      # is residence, and everything here was already shipped. What this pins is
      # that the selector selects, and that an unknown room is empty, not a peek.
      ship(snap("mine", t: 5_000), source: "mine")

      theirs = other_clan_snap(String.duplicate("8", 64), 6_000)

      assert %{id: _} =
               Keep.receive(%{"id" => Keep.hash(theirs), "message" => theirs},
                 clan: "other-room",
                 author_id: "someone"
               )

      mine = Keep.latest(@clan) |> keeps() |> Enum.map(& &1.target)
      theirs_works = Keep.latest("other-room") |> keeps() |> Enum.map(& &1.target)

      assert mine == [@target]
      assert theirs_works == [String.duplicate("8", 64)]
      assert Keep.latest("room-that-never-was") == {[], nil}
    end

    test "face is a flag, never the bytes — and the message rides whole" do
      bytes = snap("pix", title: "has a face")
      ship(bytes, source: "pix")
      id = Keep.hash(bytes)

      assert {[%{face: false}], nil} = Keep.latest(@clan)

      assert :ok =
               Keep.image(%{"id" => id, "image" => Base.encode64(<<1, 2, 3>>)}, clan: @clan)

      assert {[row], nil} = Keep.latest(@clan)
      assert row.face == true
      refute Map.has_key?(row, :image), "the picture's ADDRESS travels, never its bytes"
      # kc-law 3: the reader derives the name from the bytes it was handed.
      assert Keep.hash(row.message) == row.id
    end

    test "n bounds the answer and cannot be unbounded" do
      for i <- 1..5 do
        w = String.duplicate("#{i}", 64)

        ship(
          Jason.encode!(%{
            "source_id" => Keep.hash("k#{i}"),
            "v" => 1,
            "kind" => "snap",
            "root" => @root,
            "ts" => %{"t" => 1_000 + i, "n" => 0},
            "target" => w
          }),
          source: "k#{i}"
        )
      end

      assert {page, next} = Keep.latest(@clan, n: 2)
      assert length(page) == 2
      assert next != nil, "a full page always offers the next"

      assert {[_], _} = Keep.latest(@clan, n: 0), "n is clamped to at least one river"
      assert {all, nil} = Keep.latest(@clan, n: 10_000)
      assert length(all) == 5, "a short page is the last page"
    end

    test "a river with no binding is not in the room's memory" do
      # Only reachable by writing past receive; the room cannot vouch for a
      # river it never bound, so it does not present one (id:ka-works-bind).
      bytes = snap("unbound", t: 7_000)
      {:ok, cols} = Keep.project(bytes, Keep.hash(bytes))
      Repo.insert_all("keeps", [Keep.row(cols, @clan, 1, "n")], on_conflict: :nothing)

      assert Keep.latest(@clan) == {[], nil}
    end

    test "the room cursor pages same-ms rivers without overlap or skip" do
      # The residue id:ka-cursor named: shared_at is milliseconds, so a drain
      # lands many rivers on one tick. A cursor on `at` alone skips or dups
      # at that seam. `id` is the tiebreak, already on the row.
      ids =
        for i <- 1..4 do
          w = String.duplicate("#{i}", 64)

          b =
            Jason.encode!(%{
              "source_id" => Keep.hash("s#{i}"),
              "v" => 1,
              "kind" => "snap",
              "root" => @root,
              "ts" => %{"t" => 1_000 + i, "n" => 0},
              "target" => w
            })

          ship(b, source: "s#{i}")
          Keep.hash(b)
        end

      Repo.update_all(from(k in "keeps", where: k.root == ^@root), set: [shared_at: 100])

      {p1, next} = Keep.latest(@clan, n: 2)
      {p2, _} = Keep.latest(@clan, n: 2, after: Keep.after_room(next))

      assert length(p1) == 2
      assert length(p2) == 2

      assert MapSet.size(MapSet.intersection(MapSet.new(p1, & &1.id), MapSet.new(p2, & &1.id))) ==
               0

      # desc shared_at, desc id — four names, two pages, none missing.
      assert Enum.sort(Enum.map(p1, & &1.id) ++ Enum.map(p2, & &1.id)) == Enum.sort(ids)
    end

    test "of: :root is last word per journal, room-ordered" do
      other = String.duplicate("a", 64)
      alice_old = snap("ao", t: 1_000, title: "alice-old")
      alice_new = snap("an", t: 3_000, title: "alice-new")

      bob =
        Jason.encode!(%{
          "source_id" => Keep.hash("bo"),
          "v" => 1,
          "kind" => "snap",
          "root" => other,
          "ts" => %{"t" => 2_000, "n" => 0},
          "target" => String.duplicate("b", 64)
        })

      ship(alice_old, source: "ao")
      ship(bob, source: "bo")
      ship(alice_new, source: "an")

      Repo.update_all(from(k in "keeps", where: k.id == ^Keep.hash(alice_new)),
        set: [shared_at: 10]
      )

      Repo.update_all(from(k in "keeps", where: k.id == ^Keep.hash(bob)), set: [shared_at: 20])

      {rows, nil} = Keep.latest(@clan, of: :root)
      assert Enum.map(rows, & &1.root) == [other, @root]
      assert Enum.map(rows, & &1.id) == [Keep.hash(bob), Keep.hash(alice_new)]
      refute Enum.any?(rows, &(&1.id == Keep.hash(alice_old))), "the head, not an older keep"
    end

    test "unknown of is the empty page, never a guess" do
      ship(snap("x", t: 1), source: "x")
      assert Keep.latest(@clan, of: :nope) == {[], nil}
      assert Keep.latest(@clan, of: "nope") == {[], nil}
    end
  end

  # ONE RIVER, CURSORED (id:ka-door-shape) — the door id:la-undone said had no
  # backing. Rung 3.
  describe "history — one river, cursored (id:ka-door-shape)" do
    defp river(n) do
      for i <- 1..n do
        b = snap("h#{i}", t: 1_000 + i, title: "v#{i}")
        ship(b, source: "h#{i}")
        b
      end
    end

    test "newest first, bounded, and the whole message rides" do
      river(5)

      {rows, _next} = Keep.history(@target, n: 3)
      assert length(rows) == 3
      titles = Enum.map(rows, &Jason.decode!(&1.message)["title"])
      assert titles == ["v5", "v4", "v3"], "the author's clock, newest first"

      assert Enum.all?(rows, &(Keep.hash(&1.message) == &1.id)),
             "the reader can verify (kc-law 3)"
    end

    test "the cursor pages without overlap and without skipping" do
      river(7)

      # The page hands its own next cursor — a caller never builds one.
      {p1, next} = Keep.history(@target, n: 3)
      {p2, _} = Keep.history(@target, n: 3, after: Keep.after_cursor(next))

      ids1 = MapSet.new(p1, & &1.id)
      ids2 = MapSet.new(p2, & &1.id)
      assert MapSet.size(MapSet.intersection(ids1, ids2)) == 0, "no keep served twice"
      assert length(p2) == 3

      {rows, _} = Keep.history(@target, n: 100)
      all = Enum.map(rows, & &1.id)

      assert Enum.take(all, 6) == Enum.map(p1, & &1.id) ++ Enum.map(p2, & &1.id),
             "and none skipped between the pages"
    end

    test "[⚠] the bound is the domain's, so a big n cannot fake the end" do
      # The clamp and the short-page rule lived in two modules and disagreed:
      # n past the cap returned a full page while reporting `next: nil`.
      river(3)

      assert {rows, nil} = Keep.history(@target, n: 10_000), "clamped, and honestly done"
      assert length(rows) == 3

      assert {[_], cur} = Keep.history(@target, n: 1)
      assert cur != nil, "a full page always offers the next"

      assert {[_], _} = Keep.history(@target, n: 0), "n is clamped to at least one keep"
    end

    test "[⚠] a keep id has no river — the capability names a moment" do
      # Enforced by the BINDING, not a second check: no `works` row bears a
      # keep's id. And it preserves the choice the mint offers — standing on
      # HEAD shares the work, standing on an older keep shares that commit
      # (id:la-fork-pull).
      [first | _] = river(2)
      assert Keep.history(Keep.hash(first)) == {[], nil}
    end

    test "a river answers only its owner's keeps" do
      river(2)
      stranger = String.duplicate("9", 64)

      theirs =
        Jason.encode!(%{
          "source_id" => Keep.hash("x"),
          "v" => 1,
          "kind" => "snap",
          "root" => stranger,
          "ts" => %{"t" => 9_999, "n" => 0},
          "target" => @target
        })

      assert %{why: :work} =
               Keep.receive(%{"id" => Keep.hash(theirs), "message" => theirs},
                 clan: @clan,
                 author_id: "mallory"
               )

      {rows, _} = Keep.history(@target, n: 100)
      assert rows |> Enum.map(& &1.root) |> Enum.uniq() == [@root]
    end

    test "no source rides — it shows, it does not accept" do
      # id:kb-13-ground requires the source beside any fold that ENTERS a
      # journal, or the keep lands a tombstone. This fold does not enter one:
      # forking a moment out of a peer's river is `pull/1`, which carries the
      # source for the single keep the child chose.
      river(1)
      {[row], _} = Keep.history(@target)

      refute Map.has_key?(row, :source)
      assert {:ok, %{source: "h1"}} = Keep.pull(row.id)
    end

    test "unbound, unminted, and unknown all answer nothing" do
      assert Keep.history(String.duplicate("0", 64)) == {[], nil}
      assert Keep.history("../etc/passwd") == {[], nil}
      assert Keep.history(nil) == {[], nil}
    end

    # The codec is pure and lives in the domain because the braid pages a
    # peer's river across hops and wants the same one (id:ka-cursor).
    test "the cursor round-trips, and garbage is no cursor" do
      assert Keep.cursor(%{t: 42, n: 0}) == "42.0"
      assert Keep.after_cursor("42.0") == %{t: 42, n: 0}
      assert Keep.after_cursor(Keep.cursor(%{t: 42, n: 3})) == %{t: 42, n: 3}

      for junk <- ["", "42", "42.", ".0", "a.b", "42.0.1", nil, 42] do
        assert Keep.after_cursor(junk) == nil, "#{inspect(junk)} is no cursor"
      end

      assert Keep.cursor(%{t: "x", n: 0}) == nil, "a stamp is two integers"
      assert Keep.cursor(%{message: "irrelevant"}) == nil, "never re-derived from bytes"

      id = String.duplicate("a", 64)
      assert Keep.room_cursor(%{at: 9, id: id}) == "9.#{id}"
      assert Keep.after_room("9.#{id}") == %{at: 9, id: id}
      assert Keep.after_room(Keep.room_cursor(%{at: 9, id: id})) == %{at: 9, id: id}
      # An author cursor is no room cursor, and the reverse.
      assert Keep.after_room("42.0") == nil
      assert Keep.after_cursor("9.#{id}") == nil
    end

    test "[⚑] only the single-river door carries a stamp" do
      # A cursor cannot cross a hop (id:ka-law): each river is another hand's
      # clock. The row shape is the fence — `latest` rows have no (t, n) to
      # build one from, so no caller can page across the edge by accident.
      river(1)
      {[row], _} = Keep.history(@target)
      assert %{t: t, n: n} = row
      assert is_integer(t) and is_integer(n)

      assert {[head], _} = Keep.latest(@clan)
      refute Map.has_key?(head, :t)
      assert Keep.cursor(head) == nil
    end

    test "of: :root pages one journal across works, author order" do
      other = String.duplicate("c", 64)

      for {src, t, work} <- [
            {"a1", 1_000, @target},
            {"a2", 3_000, String.duplicate("d", 64)},
            {"a3", 2_000, @target},
            {"b1", 9_000, String.duplicate("1", 64)}
          ] do
        root = if String.starts_with?(src, "b"), do: other, else: @root

        b =
          Jason.encode!(%{
            "source_id" => Keep.hash(src),
            "v" => 1,
            "kind" => "snap",
            "root" => root,
            "ts" => %{"t" => t, "n" => 0},
            "target" => work
          })

        ship(b, source: src)
      end

      {rows, _} = Keep.history(@root, of: :root, n: 10)
      titles = Enum.map(rows, &Jason.decode!(&1.message)["source_id"])
      # newest first, Alice only — a2 (t=3000), a3 (t=2000), a1 (t=1000)
      assert titles == [Keep.hash("a2"), Keep.hash("a3"), Keep.hash("a1")]

      {p1, next} = Keep.history(@root, of: :root, n: 2)
      {p2, _} = Keep.history(@root, of: :root, n: 2, after: Keep.after_cursor(next))
      assert Enum.map(p1, & &1.id) ++ Enum.map(p2, & &1.id) == Enum.map(rows, & &1.id)

      # Default of: :target must not over-answer a root mint into a journal.
      assert Keep.history(@root) == {[], nil}
      assert Keep.history(@target, of: :nope) == {[], nil}
    end
  end

  describe "image_of — the picture comes back out (id:kb-13, id:ka-seat)" do
    test "what image/2 wrote, image_of reads — byte-identical" do
      # The write door shipped alone (id:kb-12a) and NOTHING read the column.
      # The client's eviction is built on this door existing: a shared blob may
      # be dropped because the room holds it — true about the bytes, and false
      # about reachability while nothing served them.
      bytes = snap("pix", title: "with a face")
      ship(bytes, source: "pix")
      id = Keep.hash(bytes)

      png = <<137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3>>
      assert :ok = Keep.image(%{"id" => id, "image" => Base.encode64(png)}, clan: @clan)

      assert {:ok, ^png} = Keep.image_of(id)
    end

    test "absent is a NAMED state, not an error" do
      # kc-e-missing-image: the keep renders whole; the picture may be absent
      # and says so. A keep with no image and an id nobody minted answer alike.
      bytes = snap("nopix")
      ship(bytes, source: "nopix")

      assert Keep.image_of(Keep.hash(bytes)) == :none
      assert Keep.image_of(String.duplicate("0", 64)) == :none
    end

    test "a ref that is not a minted name is :none, without a query" do
      assert Keep.image_of("../etc/passwd") == :none
      assert Keep.image_of("") == :none
      assert Keep.image_of(nil) == :none
    end
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
