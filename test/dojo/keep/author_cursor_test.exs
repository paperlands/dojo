defmodule Dojo.Keep.AuthorCursorTest do
  @moduledoc """
  Author-clock paging must not skip messages that share a millisecond.

  `(ts_t, ts_n)` is the author's clock; it is not unique. Equal stamps need a
  third term (`id`) in the order, the seek, and the cursor, or a page boundary
  silently omits rows. IDs give a stable view order, never ancestry.
  """
  use Dojo.DataCase, async: true

  alias Dojo.Keep
  alias Dojo.Keep.Repo

  @clan "room-a"
  @t 1_700_000_000_000

  defp msg(root, target, title, t \\ @t, n \\ 0) do
    body = %{
      "v" => 1,
      "kind" => "snap",
      "root" => root,
      "ts" => %{"t" => t, "n" => n},
      "title" => title
    }

    body = if target, do: Map.put(body, "target", target), else: body
    Jason.encode!(body)
  end

  defp ship(bytes, opts \\ []) do
    Keep.receive(
      Dojo.KeepSigning.sign(%{"id" => Keep.hash(bytes), "message" => bytes}),
      clan: Keyword.get(opts, :clan, @clan),
      author_id: "author-a",
      name: "spike"
    )
  end

  # Walk a history the way a client does: opaque cursor out, decoder in.
  defp walk(ref, of, n, cur \\ nil, acc \\ [])
  defp walk(_ref, _of, _n, nil, acc) when acc != [], do: acc

  defp walk(ref, of, n, cur, acc) do
    {rows, next} = Keep.history(ref, of: of, n: n, after: cur)
    acc = acc ++ rows
    if next, do: walk(ref, of, n, Keep.after_cursor(next), acc), else: acc
  end

  defp first_page(ref, of, n, after_cursor \\ nil) do
    Keep.history(ref, of: of, n: n, after: after_cursor)
  end

  # Two stores, one set: each lifetime rolls back, so the second inserts the
  # same bytes into an empty keeps table rather than deduplicating.
  defp view_in_rollback(root, msgs, n) do
    parent = self()

    {:error, :rollback} =
      Repo.transaction(fn ->
        Enum.each(msgs, &ship/1)
        send(parent, {:view, walk(root, :root, n)})
        Repo.rollback(:rollback)
      end)

    receive do
      {:view, view} -> view
    after
      1_000 -> flunk("view was not captured")
    end
  end

  describe "author order" do
    test "equal stamps on one root page without skipping" do
      root = Dojo.KeepSigning.root(String.duplicate("a", 64))
      ids = for i <- 1..15, do: ship(msg(root, nil, "same-#{i}")) |> Map.fetch!(:id)

      rows = walk(root, :root, 5)
      assert length(rows) == 15
      assert rows |> Enum.map(& &1.id) |> Enum.uniq() |> length() == 15
      assert Enum.sort(Enum.map(rows, & &1.id)) == Enum.sort(ids)
    end

    test "equal stamps on one work page without skipping" do
      root = Dojo.KeepSigning.root(String.duplicate("b", 64))
      origin = msg(root, nil, "origin")
      work = Keep.hash(origin)
      assert %{id: ^work} = ship(origin)

      ids = for i <- 1..15, do: ship(msg(root, work, "same-#{i}")) |> Map.fetch!(:id)

      # The origin is a member, so the river is origin + 15 children.
      rows = walk(work, :target, 5)
      assert length(rows) == 16
      assert rows |> Enum.map(& &1.id) |> Enum.uniq() |> length() == 16
      assert Enum.sort(Enum.map(rows, & &1.id)) == Enum.sort([work | ids])
    end

    test "equal stamps order by id desc, independent of insertion order" do
      root = Dojo.KeepSigning.root(String.duplicate("c", 64))
      for i <- 1..9, do: ship(msg(root, nil, "tie-#{i}"))

      ids = Enum.map(walk(root, :root, 4), & &1.id)
      assert ids == Enum.sort(ids, :desc)
    end

    test "the same bytes inserted in opposite orders give the same view" do
      root = Dojo.KeepSigning.root(String.duplicate("d", 64))
      msgs = for i <- 1..9, do: msg(root, nil, "same-#{i}")

      forward = view_in_rollback(root, msgs, 4)
      backward = view_in_rollback(root, Enum.reverse(msgs), 4)

      assert Enum.map(forward, & &1.id) == Enum.map(backward, & &1.id)
      ids = Enum.map(forward, & &1.id)
      assert ids == Enum.sort(ids, :desc)
    end

    test "mixed t and n keep lexicographic order across page boundaries" do
      root = Dojo.KeepSigning.root(String.duplicate("1", 64))

      stamps = [
        {3, 0, "a"},
        {3, 0, "b"},
        {3, 0, "c"},
        {2, 5, "d"},
        {2, 5, "e"},
        {2, 4, "f"},
        {2, 4, "g"},
        {1, 9, "h"},
        {1, 9, "i"},
        {1, 8, "j"}
      ]

      for {t, n, title} <- Enum.reverse(stamps), do: ship(msg(root, nil, title, t, n))

      rows = walk(root, :root, 2)

      assert Enum.map(rows, &{&1.t, &1.n}) == [
               {3, 0},
               {3, 0},
               {3, 0},
               {2, 5},
               {2, 5},
               {2, 4},
               {2, 4},
               {1, 9},
               {1, 9},
               {1, 8}
             ]

      # Within one equal-stamp group, ids descend; across groups, t then n lead.
      grouped = Enum.group_by(rows, &{&1.t, &1.n})

      for {_stamp, group} <- grouped do
        ids = Enum.map(group, & &1.id)
        assert ids == Enum.sort(ids, :desc)
      end
    end

    test "a late insert in the traversed prefix needs a rescan, not a cursor" do
      root = Dojo.KeepSigning.root(String.duplicate("3", 64))
      for i <- 1..6, do: ship(msg(root, nil, "prefix-#{i}"))

      {first, next} = first_page(root, :root, 2)
      late = msg(root, nil, "late", @t + 1, 0)
      late_id = Keep.hash(late)
      assert %{id: ^late_id} = ship(late)

      # Continuing is honest paging, not anti-entropy: the new row sorts before
      # the cursor, so the cursor cannot see it.
      rest = walk(root, :root, 2, Keep.after_cursor(next), [])
      seen = first ++ rest
      assert length(seen) == 6
      refute late_id in Enum.map(seen, & &1.id)

      # Only a rescan from the head sees the late insert.
      rescanned = walk(root, :root, 2)
      assert length(rescanned) == 7
      assert hd(rescanned).id == late_id
    end

    test "a one-row page still carries a full tie-break cursor" do
      root = Dojo.KeepSigning.root(String.duplicate("e", 64))
      ship(msg(root, nil, "one"))
      ship(msg(root, nil, "two"))

      {rows, next} = first_page(root, :root, 1)
      assert [%{id: id, t: @t, n: 0}] = rows
      assert next == "#{@t}.0.#{id}"
      assert %{t: @t, n: 0, id: ^id} = Keep.after_cursor(next)
    end

    test "the head agrees between the river and the room fan on equal stamps" do
      root = Dojo.KeepSigning.root(String.duplicate("f", 64))
      origin = msg(root, nil, "origin")
      work = Keep.hash(origin)
      assert %{id: ^work} = ship(origin)
      for i <- 1..5, do: ship(msg(root, work, "tie-#{i}"))

      {[river_head | _], _} = first_page(work, :target, 1)
      {fan, _} = Keep.latest(@clan, of: :target)
      assert Enum.find(fan, &(&1.target == work)).id == river_head.id
    end
  end

  describe "cursor codec" do
    test "a full cursor round-trips" do
      id = String.duplicate("1", 64)
      assert Keep.cursor(%{t: 7, n: 2, id: id}) == "7.2.#{id}"
      assert Keep.after_cursor("7.2.#{id}") == %{t: 7, n: 2, id: id}
    end

    test "a two-part cursor is an explicit restart, not a silent continuation" do
      # Old cursors were "<t>.<n>"; they cannot name the row they stopped at.
      assert Keep.after_cursor("1700.0") == nil
      assert Keep.after_cursor("1700.0.zz") == nil
      assert Keep.after_cursor("1700.0.#{String.duplicate("1", 64)}.extra") == nil
    end

    test "an old cursor restarts the page from the head" do
      root = Dojo.KeepSigning.root(String.duplicate("9", 64))
      for i <- 1..3, do: ship(msg(root, nil, "old-#{i}"))

      {restart, next} = first_page(root, :root, 2, Keep.after_cursor("1700.0"))
      {[head | _], _} = first_page(root, :root, 2)
      assert List.first(restart).id == head.id
      assert length(restart) == 2
      assert String.split(next, ".") |> length() == 3
    end

    test "the room clock keeps its own two-part cursor" do
      id = String.duplicate("2", 64)
      assert Keep.room_cursor(%{at: 5, id: id}) == "5.#{id}"
      assert Keep.after_room("5.#{id}") == %{at: 5, id: id}
      # An author cursor is not a room cursor and vice versa.
      assert Keep.after_room("5.0.#{id}") == nil
      assert Keep.after_cursor("5.#{id}") == nil
    end
  end

  describe "controller decoder (params path, not routed HTTP)" do
    test "a legacy cursor restarts at the head through the controller decoder" do
      root = Dojo.KeepSigning.root(String.duplicate("7", 64))
      for i <- 1..3, do: ship(msg(root, nil, "http-#{i}"))

      conn = Plug.Test.conn(:get, "/keeps/#{root}/history?after=1700.0")

      conn =
        DojoWeb.KeepController.history(conn, %{
          "ref" => root,
          "of" => "root",
          "after" => "1700.0",
          "n" => "2"
        })

      assert conn.status == 200
      body = Jason.decode!(conn.resp_body)
      assert length(body["keeps"]) == 2
      assert [_t, _n, _id] = String.split(body["next"], ".")

      {[head | _], _} = first_page(root, :root, 2)
      assert hd(body["keeps"])["id"] == head.id
    end

    test "a returned cursor continues without a duplicate through the controller decoder" do
      root = Dojo.KeepSigning.root(String.duplicate("8", 64))
      ids = for i <- 1..5, do: ship(msg(root, nil, "http2-#{i}")) |> Map.fetch!(:id)

      c1 = Plug.Test.conn(:get, "/keeps/#{root}/history?n=2")
      c1 = DojoWeb.KeepController.history(c1, %{"ref" => root, "of" => "root", "n" => "2"})
      b1 = Jason.decode!(c1.resp_body)

      c2 = Plug.Test.conn(:get, "/keeps/#{root}/history")

      c2 =
        DojoWeb.KeepController.history(c2, %{
          "ref" => root,
          "of" => "root",
          "n" => "2",
          "after" => b1["next"]
        })

      b2 = Jason.decode!(c2.resp_body)

      seen = Enum.map(b1["keeps"] ++ b2["keeps"], & &1["id"])
      assert length(seen) == 4
      assert length(seen) == length(Enum.uniq(seen))
      assert Enum.all?(seen, &(&1 in ids))
    end
  end

  describe "rows and schema" do
    test "the tie-break adds no column and no write" do
      cols = Repo.query!("PRAGMA table_info(keeps)").rows |> Enum.map(&Enum.at(&1, 1))
      refute "cursor" in cols
      refute "stamp_id" in cols
    end
  end
end
