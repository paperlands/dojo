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
    # Same builder put_keep uses — no second hand-written map (id:kb-11).
    Keep.row(cols, clan, nil, nil)
  end

  describe "adapters" do
    test "grep of Ecto.Adapters names SQLite3 for the keep" do
      assert Repo.__adapter__() == Ecto.Adapters.SQLite3
      assert Reader.__adapter__() == Ecto.Adapters.SQLite3
    end

    test "schema half: read_only omits insert/update/delete" do
      # Half the fence — read_only: true (id:kb-10). query/3 is not gated;
      # the other half is the module-boundary grep below.
      refute function_exported?(Reader, :insert_all, 2)
      refute function_exported?(Reader, :insert_all, 3)
      refute function_exported?(Reader, :insert, 1)
      refute function_exported?(Reader, :update, 1)
      refute function_exported?(Reader, :delete, 1)
      refute function_exported?(Reader, :update_all, 2)
      refute function_exported?(Reader, :delete_all, 1)
      # And the hole: query! is still there. Ad-hoc SQL is the second term.
      assert function_exported?(Reader, :query!, 1) or function_exported?(Reader, :query!, 2) or
               function_exported?(Reader, :query!, 3)
    end

    test "ad-hoc half: only Dojo.Keep names Repo/Reader; query is nowhere" do
      # Completes the fence: no path past Keep to the pools, and no
      # Reader.query anywhere (the hole read_only does not close).
      lib = Path.expand("../../../lib", __DIR__)

      {repo_hits, reader_hits, query_hits} =
        Path.wildcard(Path.join(lib, "**/*.{ex,exs}"))
        |> Enum.reduce({[], [], []}, fn path, {rs, rds, qs} ->
          # application.ex starts the children; the repos define themselves.
          base = Path.basename(path)

          if base in ~w(application.ex repo.ex reader.ex) do
            {rs, rds, qs}
          else
            src = File.read!(path)
            rel = Path.relative_to(path, lib)

            rs =
              if src =~ ~r/Dojo\.Keep\.Repo(?!\.Reader)/ or
                   src =~ ~r/\bRepo\.(insert|update|delete|one|all|transact|query)/,
                 do: [rel | rs],
                 else: rs

            # Who aliases or names the Reader?
            rds =
              if src =~ "Dojo.Keep.Repo.Reader" or src =~ ~r/\bReader\.(one|all|query)/,
                do: [rel | rds],
                else: rds

            qs =
              if src =~ ~r/\bReader\.query!?/ or src =~ ~r/\bRepo\.query!?/,
                do: [rel | qs],
                else: qs

            {rs, rds, qs}
          end
        end)

      # keep.ex is the only lib module that may name either pool.
      assert repo_hits == ["dojo/keep.ex"],
             "Repo must stay inside Dojo.Keep, got #{inspect(repo_hits)}"

      assert reader_hits == ["dojo/keep.ex"],
             "Reader must stay inside Dojo.Keep, got #{inspect(reader_hits)}"

      assert query_hits == [],
             "no ad-hoc SQL (Repo/Reader.query); got #{inspect(query_hits)}"
    end

    test "the by-target door has its index — plan, not wall clock (id:ka-door-shape)" do
      # Was SCAN + TEMP B-TREE on a public route (id:ka-ground). Assert the PLAN —
      # a timing test passes on a fast machine with no index.
      {sql, params} =
        Ecto.Adapters.SQL.to_sql(
          :all,
          Repo,
          from(k in "keeps",
            where: k.target == ^@target,
            order_by: [desc: k.ts_t, desc: k.ts_n],
            limit: 1,
            select: %{id: k.id}
          )
        )

      %{rows: rows} = Repo.query!("EXPLAIN QUERY PLAN " <> sql, params)
      plan = rows |> Enum.map_join(" ", &List.last/1)

      assert plan =~ "keeps_head_idx", "by-target must SEARCH the index; got: #{plan}"
      refute plan =~ "SCAN keeps", "by-target must not scan; got: #{plan}"

      refute plan =~ "TEMP B-TREE",
             "the index carries the order; no sort should remain: #{plan}"
    end

    test "the ownership fence keeps that index — a subquery, never a join" do
      # THE REGRESSION THIS EXISTS FOR: rung 2's first cut fenced head_of with
      # `join: w in "works"`, which drives from works and then walks
      # keeps_history_idx (root=?) — the author's whole journal filtering
      # target — silently discarding the index rung 1 shipped to kill a SCAN
      # on this very route. Measured, both shapes:
      #
      #   join     → SEARCH w ...works_1 | SEARCH k USING keeps_history_idx (root=?)
      #   subquery → SEARCH k USING keeps_head_idx (target=?) | SCALAR SUBQUERY
      owner = from(w in "works", where: w.work_id == ^@target, select: w.root)

      {sql, params} =
        Ecto.Adapters.SQL.to_sql(
          :all,
          Repo,
          from(k in "keeps",
            where: k.target == ^@target and k.root == subquery(owner),
            order_by: [desc: k.ts_t, desc: k.ts_n],
            limit: 1,
            select: %{id: k.id}
          )
        )

      %{rows: rows} = Repo.query!("EXPLAIN QUERY PLAN " <> sql, params)
      plan = rows |> Enum.map_join(" | ", &List.last/1)

      assert plan =~ "keeps_head_idx", "the fence must keep the head index; got: #{plan}"

      refute plan =~ "keeps_history_idx",
             "driving from root is the join's plan, not the door's: #{plan}"
    end

    test "the room's memory scales with RIVERS, not moments (id:ka-latest)" do
      # SCAN w over W rivers, PK seeks for the rest, keeps_head_idx for each
      # head, and a temp sort of W rows — never a walk of the room's keeps.
      # The keep join is on the head id (PK), not on target: joining the
      # selector column is the wound id:ka-vet 65 named.
      head =
        from(k2 in "keeps",
          where: k2.target == parent_as(:work).work_id and k2.root == parent_as(:work).root,
          order_by: [desc: k2.ts_t, desc: k2.ts_n],
          limit: 1,
          select: k2.id
        )

      {sql, params} =
        Ecto.Adapters.SQL.to_sql(
          :all,
          Repo,
          from(w in "works",
            as: :work,
            join: r in "roots",
            on: r.root == w.root,
            join: k in "keeps",
            on: true,
            where: r.clan == ^"c" and k.id == subquery(head),
            order_by: [desc: k.shared_at, desc: k.id],
            limit: 12,
            select: %{id: k.id}
          )
        )

      %{rows: rows} = Repo.query!("EXPLAIN QUERY PLAN " <> sql, params)
      plan = rows |> Enum.map_join(" | ", &List.last/1)

      assert plan =~ "SCAN w", "the walk starts at the rivers: #{plan}"
      assert plan =~ "keeps_head_idx", "each head rides the author's-clock index: #{plan}"

      refute plan =~ "keeps_history_idx",
             "the room must not be read by walking one author's journal: #{plan}"

      refute plan =~ "SCAN k", "the room's keeps are never scanned: #{plan}"
    end

    test "the root fan seeks keeps_history_idx, never scans keeps" do
      head =
        from(k2 in "keeps",
          where: k2.root == parent_as(:author).root,
          order_by: [desc: k2.ts_t, desc: k2.ts_n],
          limit: 1,
          select: k2.id
        )

      {sql, params} =
        Ecto.Adapters.SQL.to_sql(
          :all,
          Repo,
          from(r in "roots",
            as: :author,
            join: k in "keeps",
            on: true,
            where: r.clan == ^"c" and k.id == subquery(head),
            order_by: [desc: k.shared_at, desc: k.id],
            limit: 12,
            select: %{id: k.id}
          )
        )

      %{rows: rows} = Repo.query!("EXPLAIN QUERY PLAN " <> sql, params)
      plan = rows |> Enum.map_join(" | ", &List.last/1)

      assert plan =~ "keeps_history_idx", "last word per journal rides the root index: #{plan}"
      refute plan =~ "SCAN k", "the journals are never scanned: #{plan}"
    end

    test "root depth is a range on keeps_history_idx" do
      {sql, params} =
        Ecto.Adapters.SQL.to_sql(
          :all,
          Repo,
          from(k in "keeps",
            where: k.root == ^@root,
            order_by: [desc: k.ts_t, desc: k.ts_n],
            limit: 12,
            select: %{id: k.id}
          )
        )

      %{rows: rows} = Repo.query!("EXPLAIN QUERY PLAN " <> sql, params)
      plan = rows |> Enum.map_join(" | ", &List.last/1)

      assert plan =~ "keeps_history_idx", "one journal is a range seek: #{plan}"
      refute plan =~ "SCAN keeps", "root depth must not scan: #{plan}"
    end

    test "[structural] head_of fences ownership without losing its index" do
      # The plan tests hand-build their queries, so they drift the same way the
      # implementation did. This watches the implementation itself.
      #
      # [⚠] AND IT USED TO REFUSE `join:` OUTRIGHT — which then convicted
      # `latest/2`, whose joins are against BINDING tables (works, roots) and
      # whose plan is measured correct. A proxy that convicts the innocent is
      # worse than the plan test it stood in for, so the shape-grep is gone and
      # the positive one remains: it is the actual drift guard, because
      # rewriting head_of as a join is exactly what makes this string vanish.
      src =
        Path.expand("../../../lib/dojo/keep.ex", __DIR__)
        |> File.read!()
        |> String.replace(~r/^\s*#.*$/m, "")

      # owner_of is the target fence — head_of and depth(:target) — never root.
      # A join here is the wound id:ka-vet 65 named.
      assert length(Regex.scan(~r/subquery\(owner_of\(/, src)) == 2,
             "owner_of fences the two target reads, and only those"

      # TWO CLOCKS, EACH DECLARED ONCE (id:ka-latest). The author's is a named
      # function every one-hand door composes; the room's is the other.
      assert src =~ "defp by_author",
             "the author's clock is declared once and composed, never inlined"

      assert src =~ "defp by_room",
             "the room's clock is declared once and composed, never inlined"

      assert length(Regex.scan(~r/desc: k\.shared_at/, src)) == 1,
             "the room's clock orders the fan in exactly one place"

      refute src =~ ~r/order_by:.*ts_t.*\n.*clan|clan.*order_by:.*ts_t/,
             "a room must never be ordered by an author's clock"

      assert Keep.selectors() == [:target, :root],
             "the declared table is the of: match, not a grep"
    end

    test "sandbox path: reader (pointed at Repo) sees the writer's uncommitted row" do
      # DataCase points Reader at Repo so the sandbox write is visible (id:kb-10).
      # This is NOT the two-pool seam — see the committed test below.
      bytes = snap_bytes()
      row = row_from(bytes)

      {1, nil} = Repo.insert_all("keeps", [row], on_conflict: :nothing, conflict_target: :id)

      got =
        from(k in "keeps",
          where: k.id == ^row.id,
          select: %{id: k.id, message: k.message}
        )
        |> Reader.one()

      assert got.id == row.id
      assert got.message == bytes
    end

    @tag :two_pool
    test "two-pool seam: a committed write is visible on the real read pool" do
      # The design's load-bearing seam (id:kb-10): writer commits, a fresh
      # autocommit read on the *other* pool sees it. :two_pool leaves both
      # pools real (DataCase); we own the row's cleanup.
      bytes = snap_bytes()
      row = row_from(bytes)
      id = row.id

      try do
        {1, nil} =
          Repo.insert_all("keeps", [row], on_conflict: :nothing, conflict_target: :id)

        got =
          from(k in "keeps",
            where: k.id == ^id,
            select: %{id: k.id, message: k.message}
          )
          |> Reader.one()

        assert got != nil, "real Reader pool must see the committed row"
        assert got.id == id
        assert got.message == bytes
      after
        Repo.query!("DELETE FROM keeps WHERE id = ?", [id])
      end
    end
  end

  describe "schemaless row — no schema, no changeset" do
    test "row/4 keys are exactly the STRICT keeps columns — one list" do
      cols = %{
        id: String.duplicate("a", 64),
        root: @root,
        kind: "snap",
        target: @target,
        ts_t: 1,
        ts_n: 0,
        message: "{}"
      }

      row = Keep.row(cols, "clan", 1, "node@host")
      assert Enum.sort(Map.keys(row)) == Enum.sort(Keep.keep_cols())

      # Migration is the schema; the list names every column it creates.
      mig = File.read!("priv/keep/migrations/20260811000000_create_keeps_and_roots.exs")

      for col <- Keep.keep_cols() do
        assert mig =~ Atom.to_string(col),
               "keep_cols has #{col}; migration must name it"
      end
    end

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
