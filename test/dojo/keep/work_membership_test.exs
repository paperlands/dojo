defmodule Dojo.Keep.WorkMembershipTest do
  @moduledoc """
  Modern membership: the origin proves the work, the room lists bytes it holds,
  and a legacy works row never authorizes or captures an origin-backed river.
  """
  use Dojo.DataCase, async: true

  import Ecto.Query

  alias Dojo.Keep
  alias Dojo.Keep.Repo

  @clan "room-a"
  @other_clan "room-b"
  @at 1_700_000_000_000

  defp origin(root, title \\ "origin") do
    Jason.encode!(%{
      "v" => 1,
      "kind" => "snap",
      "root" => root,
      "ts" => %{"t" => @at, "n" => 0},
      "title" => title
    })
  end

  defp child(root, target, title, t, source \\ nil) do
    body = %{
      "v" => 1,
      "kind" => "snap",
      "root" => root,
      "target" => target,
      "ts" => %{"t" => @at + t, "n" => 0},
      "title" => title
    }

    body = if source, do: Map.put(body, "source_id", Keep.hash(source)), else: body
    Jason.encode!(body)
  end

  defp ship(bytes, opts \\ []) do
    payload = %{"id" => Keep.hash(bytes), "message" => bytes}

    payload =
      case Keyword.get(opts, :source) do
        nil -> payload
        text -> Map.put(payload, "source", text)
      end

    Keep.receive(Dojo.KeepSigning.sign(payload),
      clan: Keyword.get(opts, :clan, @clan),
      author_id: "author-a",
      name: "spike"
    )
  end

  defp fan(clan), do: Keep.latest(clan, of: :target) |> elem(0)
  defp ids(rows), do: Enum.map(rows, & &1.id)
  defp root_of(work), do: Keep.owner_of(work)

  defp seed_works(work, root) do
    Repo.insert_all("works", [%{work_id: work, root: root}], on_conflict: :nothing)
  end

  defp works_count, do: Repo.one(from(w in "works", select: count(w.work_id)))

  defp page_queries(acc \\ []) do
    receive do
      {:keep_page_query, q} -> page_queries([q | acc])
    after
      50 -> Enum.reverse(acc)
    end
  end

  defp read_queries(read) do
    parent = self()
    handler = {__MODULE__, make_ref()}

    :telemetry.attach(
      handler,
      [:dojo, :keep, :repo, :query],
      fn _event, _measurements, meta, _config ->
        q = to_string(meta[:query])

        if self() == parent and q =~ ~r/^\s*(SELECT|WITH)\b/i,
          do: send(parent, {:keep_page_query, q})
      end,
      nil
    )

    result =
      try do
        read.()
      after
        :telemetry.detach(handler)
      end

    {result, page_queries()}
  end

  describe "origin evidence" do
    test "the origin is a member and the head of a one-keep work" do
      a = Dojo.KeepSigning.root(String.duplicate("a", 64))
      o = origin(a)
      work = Keep.hash(o)
      assert %{id: ^work} = ship(o)

      assert {{:ok, %{id: ^work}}, [_query]} = read_queries(fn -> Keep.head(work) end)
      assert {[%{id: ^work}], nil} = Keep.history(work, of: :target)
      assert Enum.any?(fan(@clan), &(&1.id == work))
    end

    test "fork credit does not grant membership or change the origin root" do
      mine = Dojo.KeepSigning.root(String.duplicate("a", 64))
      peer = Dojo.KeepSigning.root(String.duplicate("b", 64))

      o =
        origin(mine, "fork")
        |> Jason.decode!()
        |> Map.put("signature_of", %{mine => "me", peer => "ghost"})
        |> Jason.encode!()

      work = Keep.hash(o)
      assert %{id: ^work} = ship(o)
      credited_child = child(peer, work, "credit is not authority", 2)
      assert %{id: credited_id} = ship(credited_child)

      assert root_of(work) == mine
      assert {:ok, %{id: ^work}} = Keep.head(work)
      assert {[%{id: ^work}], nil} = Keep.history(work, of: :target)
      assert ids(fan(@clan)) == [work]
      assert {:ok, %{id: ^credited_id}} = Keep.get(credited_id)
    end

    test "head hydrates the source of the selected member" do
      a = Dojo.KeepSigning.root(String.duplicate("b", 64))
      o = origin(a)
      work = Keep.hash(o)
      assert %{id: ^work} = ship(o, source: "fd 1")

      c = child(a, work, "later", 1, "fd 2")
      assert %{id: child_id} = ship(c, source: "fd 2")
      assert child_id == Keep.hash(c)
      assert {:ok, %{id: ^child_id, source: "fd 2"}} = Keep.head(work)
    end

    test "owner_of: origin root, nil for a child, legacy only for an id with no keep" do
      a = Dojo.KeepSigning.root(String.duplicate("c", 64))
      o = origin(a)
      work = Keep.hash(o)
      ship(o)
      c = child(a, work, "child", 1)
      ship(c)

      assert root_of(work) == a
      assert root_of(Keep.hash(c)) == nil, "a child id is not a work"

      legacy = String.duplicate("d", 64)
      seed_works(legacy, a)
      assert root_of(legacy) == a, "legacy display for an id nothing claims"
    end
  end

  describe "poisoned legacy rows" do
    test "an origin overrides a works row written by a foreign claimant" do
      a = Dojo.KeepSigning.root(String.duplicate("e", 64))
      b = Dojo.KeepSigning.root(String.duplicate("f", 64))
      o = origin(a)
      work = Keep.hash(o)

      seed_works(work, b)
      assert root_of(work) == b, "before the origin arrives, legacy display only"

      assert %{id: ^work} = ship(o)
      mine = child(a, work, "mine", 1)
      theirs = child(b, work, "theirs", 2)
      assert %{id: mine_id} = ship(mine)
      assert %{id: theirs_id} = ship(theirs)

      # The origin proves the work; the foreign child is retained, not a member.
      assert root_of(work) == a
      assert {rows, _} = Keep.history(work, of: :target, n: 10)
      assert Enum.sort(ids(rows)) == Enum.sort([work, mine_id])
      refute theirs_id in ids(rows)

      assert Repo.one(from(w in "works", where: w.work_id == ^work, select: w.root)) == b,
             "the legacy row is left as it was, never rewritten"

      assert Enum.any?(fan(@clan), &(&1.id == mine_id))
    end
  end

  describe "known ids are never reclassified" do
    test "a child id with a planted works key stays a child" do
      a = Dojo.KeepSigning.root(String.duplicate("9", 64))
      o = origin(a)
      work = Keep.hash(o)
      ship(o)
      c = child(a, work, "child", 1)
      child_id = Keep.hash(c)
      ship(c)

      # A legacy key naming the child's own id must change nothing.
      seed_works(child_id, a)

      assert root_of(child_id) == nil
      assert Keep.history(child_id, of: :target) == {[], nil}
      assert Keep.head(child_id) == :none
      assert {:ok, %{id: ^child_id}} = Keep.pull(child_id), "exact get still answers"
      assert conn_pull(child_id, "work").status == 404
    end

    test "a legacy river may grow with same-root keeps but takes no new works keys" do
      a = Dojo.KeepSigning.root(String.duplicate("a", 64))
      b = Dojo.KeepSigning.root(String.duplicate("b", 64))
      legacy = String.duplicate("c", 64)
      seed_works(legacy, a)

      one = child(a, legacy, "one", 1)
      two = child(a, legacy, "two", 2)
      ship(one)
      ship(two)

      # A different root's bytes land, and are not part of the legacy river.
      foreign = child(b, legacy, "foreign", 3)
      foreign_id = Keep.hash(foreign)
      ship(foreign)

      assert works_count() == 1, "no new work keys"
      assert {rows, _} = Keep.history(legacy, of: :target, n: 10)
      assert ids(rows) == [Keep.hash(two), Keep.hash(one)], "same-root keeps may grow it"
      refute foreign_id in ids(rows)
      assert root_of(legacy) == a
    end
  end

  describe "rooms" do
    test "a room page is one SELECT, bounded by n, and walks completely" do
      mem = for r <- 1..6, do: Dojo.KeepSigning.root(String.duplicate(Integer.to_string(r), 64))

      ids =
        Enum.map(mem, fn a ->
          o = origin(a)
          ship(o)
          Keep.hash(o)
        end)

      for selector <- [:root, :target] do
        {{first, c1}, qs} = read_queries(fn -> Keep.latest(@clan, of: selector, n: 2) end)

        # Current plan is SQLite window ranking over delivery metadata; it is
        # measured separately, not asserted here as permanent shape.
        assert length(first) <= 2, "the page never exceeds n"
        assert is_binary(c1)
        assert Keep.after_room(c1) == %{at: List.last(first).at, id: List.last(first).id}
        assert length(qs) == 1, "one SELECT per room page"

        {second, c2} = Keep.latest(@clan, of: selector, after: Keep.after_room(c1), n: 2)
        {third, c3} = Keep.latest(@clan, of: selector, after: Keep.after_room(c2), n: 2)
        {[], nil} = Keep.latest(@clan, of: selector, after: Keep.after_room(c3), n: 2)

        walked = Enum.map(first ++ second ++ third, & &1.id)
        assert Enum.sort(walked) == Enum.sort(ids)
        assert length(Enum.uniq(walked)) == 6
      end
    end

    test "the same keep delivered to two rooms is visible in both, with its own receipt" do
      # One keeps row (clan = first insert), two incidences. The fan is the
      # room's delivered set, so the second room is not blind to the first
      # room's row, and its seat is its own receipt.
      a = Dojo.KeepSigning.root(String.duplicate("d", 64))
      o = origin(a)
      work = Keep.hash(o)

      ship(o, clan: @clan)
      ship(o, clan: @other_clan)

      assert Repo.one(from(k in "keeps", where: k.id == ^work, select: k.clan)) == @clan
      assert Repo.one(from(k in "keeps", where: k.id == ^work, select: count(k.id))) == 1

      assert Repo.one(from(ck in "clan_keeps", where: ck.id == ^work, select: count(ck.clan))) ==
               2

      assert [%{at: at_a}] = Enum.filter(fan(@clan), &(&1.target == work or &1.id == work))
      assert [%{at: at_b}] = Enum.filter(fan(@other_clan), &(&1.target == work or &1.id == work))
      assert is_integer(at_a) and is_integer(at_b)
    end

    test "a foreign-only room never exposes the work, even after the origin arrives elsewhere" do
      a = Dojo.KeepSigning.root(String.duplicate("e", 64))
      b = Dojo.KeepSigning.root(String.duplicate("f", 64))
      o = origin(a)
      work = Keep.hash(o)

      foreign = child(b, work, "foreign", 1)
      ship(foreign, clan: @other_clan)
      assert fan(@other_clan) == [], "delivered bytes, no member"

      ship(o, clan: @clan)
      assert Enum.any?(fan(@clan), &(&1.target == work or &1.id == work))
      assert fan(@other_clan) == [], "the foreign packet never becomes the work"
    end

    test "a pending child delivered to two rooms becomes visible in both when the origin lands" do
      a = Dojo.KeepSigning.root(String.duplicate("0", 64))
      o = origin(a)
      work = Keep.hash(o)
      early = child(a, work, "early", 1)

      ship(early, clan: @clan)
      ship(early, clan: @other_clan)
      assert fan(@clan) == []
      assert fan(@other_clan) == []

      ship(o, clan: "elsewhere")

      assert [%{id: id_a}] = Enum.filter(fan(@clan), &(&1.target == work))
      assert [%{id: id_b}] = Enum.filter(fan(@other_clan), &(&1.target == work))
      assert id_a == Keep.hash(early) and id_b == Keep.hash(early)
    end
  end

  describe "pending children and rooms" do
    test "a child before its origin is pending; the fan sees it once the origin arrives" do
      a = Dojo.KeepSigning.root(String.duplicate("0", 64))
      # The work id is the hash of the origin we have not shipped yet.
      o = origin(a)
      work = Keep.hash(o)

      early = child(a, work, "early", 1)
      assert %{id: _} = ship(early)
      assert fan(@clan) == []
      assert Keep.history(work, of: :target) == {[], nil}

      assert %{id: ^work} = ship(o)
      # The child is newer, so it is the head; the work is listed by its member.
      assert Enum.any?(fan(@clan), &(&1.target == work or &1.id == work))
    end

    test "the fan lists member bytes in the requested room, origin once" do
      a = Dojo.KeepSigning.root(String.duplicate("1", 64))
      o = origin(a)
      work = Keep.hash(o)
      ship(o, clan: @clan)
      c = child(a, work, "elsewhere", 1)
      ship(c, clan: @other_clan)

      assert Enum.count(fan(@clan), &(&1.target == work or &1.id == work)) == 1
      assert Enum.count(fan(@other_clan), &(&1.target == work or &1.id == work)) == 1
      assert fan("room-that-never-was") == []
    end

    test "a foreign-root child is never a work in the fan" do
      a = Dojo.KeepSigning.root(String.duplicate("2", 64))
      b = Dojo.KeepSigning.root(String.duplicate("3", 64))
      o = origin(a)
      work = Keep.hash(o)
      ship(o, clan: @clan)

      foreign = child(b, work, "foreign", 1)
      assert %{id: foreign_id} = ship(foreign, clan: @other_clan)

      other = fan(@other_clan)
      refute Enum.any?(other, &(&1.id == foreign_id))
      assert root_of(work) == a
    end

    test "the legacy fan stays separate, for ids nothing claims" do
      a = Dojo.KeepSigning.root(String.duplicate("4", 64))
      legacy = String.duplicate("5", 64)
      seed_works(legacy, a)

      c = child(a, legacy, "old river", 1)
      assert %{id: c_id} = ship(c)

      rows = fan(@clan)
      assert Enum.any?(rows, &(&1.target == legacy))
      # It is not a modern work: no origin keep names that id.
      assert Keep.head(legacy) == :none
      assert root_of(legacy) == a
      assert {hist, _} = Keep.history(legacy, of: :target, n: 10)
      assert ids(hist) == [c_id]
    end
  end

  describe "exact reads at the door" do
    test "read=keep is exact; read=work is evidenced head; unknown is 400" do
      a = Dojo.KeepSigning.root(String.duplicate("6", 64))
      o = origin(a)
      work = Keep.hash(o)
      ship(o)
      c = child(a, work, "child", 1)
      ship(c)

      keep = conn_pull(work, "keep")
      assert keep.status == 200
      assert Jason.decode!(keep.resp_body)["id"] == work

      head = conn_pull(work, "work")
      assert head.status == 200
      assert Jason.decode!(head.resp_body)["id"] == Keep.hash(c)

      assert conn_pull(work, "nope").status == 400
      assert conn_pull(work, nil).status == 200, "deprecated resolver kept for old URLs"
    end

    test "the door states its reading in x-dojo-keep-read, including 404" do
      a = Dojo.KeepSigning.root(String.duplicate("9", 64))
      o = origin(a)
      work = Keep.hash(o)
      ship(o)
      absent = String.duplicate("c", 64)

      assert header(conn_pull(work, "keep")) == "keep"
      assert header(conn_pull(work, "work")) == "work"
      assert header(conn_pull(work, nil)) == "legacy"

      missing = conn_pull(absent, "keep")
      assert missing.status == 404
      assert header(missing) == "keep"

      assert header(conn_pull(work, "nope")) == nil

      routed =
        Plug.Test.conn(:get, "/keeps/#{work}?read=work")
        |> Plug.Conn.fetch_query_params()
        |> DojoWeb.Router.call(DojoWeb.Router.init([]))

      assert routed.status == 200
      assert header(routed) == "work"
    end

    test "read=work never falls back to a legacy works row" do
      a = Dojo.KeepSigning.root(String.duplicate("7", 64))
      legacy = String.duplicate("8", 64)
      seed_works(legacy, a)
      ship(child(a, legacy, "old", 1))

      assert conn_pull(legacy, "work").status == 404
      assert conn_pull(legacy, "keep").status == 404
      assert conn_pull(legacy, nil).status == 200, "deprecated resolver answers the old alias"
    end
  end

  defp header(conn) do
    conn.resp_headers
    |> Map.new()
    |> Map.get("x-dojo-keep-read")
  end

  defp conn_pull(ref, read) do
    params = if read, do: %{"ref" => ref, "read" => read}, else: %{"ref" => ref}
    conn = Plug.Test.conn(:get, "/keeps/#{ref}")
    DojoWeb.KeepController.pull(conn, params)
  end
end
