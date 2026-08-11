defmodule Dojo.Keep.RepoTest do
  @moduledoc """
  Step 10 + 11 storage seam (id:kb-10, id:kb-11).

  Schemaless: insert_all + explicit select. No changeset. No SELECT *.
  """
  use Dojo.DataCase

  import Ecto.Query

  alias Dojo.Keep
  alias Dojo.Keep.Repo
  alias Dojo.Keep.Repo.Reader

  @root String.duplicate("c", 64)
  @target String.duplicate("d", 64)

  defp snap_bytes(opts \\ []) do
    t = Keyword.get(opts, :t, 1_700_000_000_000)
    n = Keyword.get(opts, :n, 0)
    title = Keyword.get(opts, :title, "snap")

    Jason.encode!(%{
      "source_id" => "abc",
      "title" => title,
      "v" => 1,
      "kind" => "snap",
      "root" => @root,
      "ts" => %{"t" => t, "n" => n},
      "target" => @target
    })
  end

  defp row_from(bytes, clan \\ "test-clan") do
    {:ok, cols} = Keep.project(bytes, Keep.hash(bytes))

    %{
      id: cols.id,
      clan: clan,
      root: cols.root,
      kind: cols.kind,
      target: cols.target,
      ts_t: cols.ts_t,
      ts_n: cols.ts_n,
      message: cols.message,
      shared_at: nil,
      shared_node: nil,
      inserted_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      image: nil
    }
  end

  describe "adapters" do
    test "grep of Ecto.Adapters names SQLite3 for the keep" do
      assert Repo.__adapter__() == Ecto.Adapters.SQLite3
      assert Reader.__adapter__() == Ecto.Adapters.SQLite3
    end

    test "a write through the reader is refused by read_only, not SQLITE_BUSY" do
      # read_only: true omits schema write functions entirely (id:kb-10).
      refute function_exported?(Reader, :insert_all, 2)
      refute function_exported?(Reader, :insert_all, 3)
      refute function_exported?(Reader, :insert, 1)
      refute function_exported?(Reader, :update, 1)
      refute function_exported?(Reader, :delete, 1)
    end
  end

  describe "schemaless row — no schema, no changeset" do
    test "insert_all + explicit select round-trips derived columns" do
      bytes = snap_bytes()
      row = row_from(bytes)

      {1, nil} = Repo.insert_all("keeps", [row], on_conflict: :nothing, conflict_target: :id)

      got =
        from(k in "keeps",
          where: k.id == ^row.id,
          select: %{
            id: k.id,
            kind: k.kind,
            target: k.target,
            ts_t: k.ts_t,
            ts_n: k.ts_n,
            message: k.message,
            shared_at: k.shared_at,
            shared_node: k.shared_node
          }
        )
        |> Repo.one()

      assert got.id == row.id
      assert got.kind == "snap"
      assert got.target == @target
      assert got.ts_t == row.ts_t
      assert got.message == bytes
      assert got.shared_at == nil
    end

    test "ship twice is once — ON CONFLICT DO NOTHING" do
      bytes = snap_bytes()
      row = row_from(bytes)

      {1, nil} = Repo.insert_all("keeps", [row], on_conflict: :nothing, conflict_target: :id)
      {0, nil} = Repo.insert_all("keeps", [row], on_conflict: :nothing, conflict_target: :id)

      count =
        from(k in "keeps", where: k.id == ^row.id, select: count(k.id))
        |> Repo.one()

      assert count == 1
    end

    test "history order is author ts — both halves" do
      a = row_from(snap_bytes(t: 100, n: 1, title: "a"))
      b = row_from(snap_bytes(t: 200, n: 0, title: "b"))
      c = row_from(snap_bytes(t: 100, n: 2, title: "c"))

      Repo.insert_all("keeps", [a, b, c], on_conflict: :nothing, conflict_target: :id)

      ids =
        from(k in "keeps",
          where: k.root == ^@root,
          order_by: [desc: k.ts_t, desc: k.ts_n],
          select: k.id
        )
        |> Repo.all()

      assert ids == [b.id, c.id, a.id]
    end

    test "SELECT * is unrepresentable over a bare table name" do
      # planner.ex:1282 — schemaless queries need an explicit select.
      assert_raise Ecto.QueryError, fn ->
        from(k in "keeps") |> Repo.all()
      end
    end

    test "TOFU roots — primary key is the bind" do
      {1, nil} =
        Repo.insert_all(
          "roots",
          [
            %{
              root: @root,
              clan: "clan-a",
              author_id: "author-1",
              bound_at: 1
            }
          ],
          on_conflict: :nothing,
          conflict_target: :root
        )

      # Second claim of the same root is a no-op at the disk.
      {0, nil} =
        Repo.insert_all(
          "roots",
          [
            %{
              root: @root,
              clan: "clan-b",
              author_id: "author-2",
              bound_at: 2
            }
          ],
          on_conflict: :nothing,
          conflict_target: :root
        )

      bound =
        from(r in "roots",
          where: r.root == ^@root,
          select: %{clan: r.clan, author_id: r.author_id}
        )
        |> Repo.one()

      assert bound.clan == "clan-a"
      assert bound.author_id == "author-1"
    end
  end

  describe "STRICT — the disk refuses a type lie" do
    test "non-integer ts_t is refused by SQLite" do
      bytes = snap_bytes()
      row = row_from(bytes) |> Map.put(:ts_t, "banana")

      assert_raise Exqlite.Error, fn ->
        Repo.insert_all("keeps", [row])
      end
    end
  end
end
