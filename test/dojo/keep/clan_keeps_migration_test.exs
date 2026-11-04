defmodule Dojo.Keep.ClanKeepsMigrationTest.Repo do
  @moduledoc false
  use Ecto.Repo, otp_app: :dojo, adapter: Ecto.Adapters.SQLite3
end

defmodule Dojo.Keep.ClanKeepsMigrationTest do
  @moduledoc """
  The `clan_keeps` migration on a throwaway SQLite file: backfill from the only
  known receipt, first-destination conflict behaviour, and a rollback that
  drops the incidence without touching keeps.

  No dev/prod database is opened. The fixture database is created under the
  system temp dir and removed on exit, so this is a control, not a claim about
  rolling back a live node.
  """
  # One named repo module; two async cases would race to start it.
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Dojo.Keep.ClanKeepsMigrationTest.Repo

  @migrations Path.expand("../../../priv/keep/migrations", __DIR__)
  @before 20_260_817_000_000
  @at 1_700_000_000_000

  setup do
    dir = Path.join(System.tmp_dir!(), "keep-migration-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    db = Path.join(dir, "keep.db")

    start_supervised!({Repo, database: db, pool_size: 1, log: false})
    on_exit(fn -> File.rm_rf!(dir) end)

    %{db: db}
  end

  defp keep(id, shared_at, shared_node) do
    %{
      id: id,
      clan: "room-a",
      root: "r1",
      kind: "snap",
      target: nil,
      ts_t: @at,
      ts_n: 0,
      message: ~s({"v":1}),
      shared_at: shared_at,
      shared_node: shared_node,
      inserted_at: "2026-10-28T00:00:00Z",
      image: nil
    }
  end

  defp up_to_previous!, do: Ecto.Migrator.run(Repo, @migrations, :up, to: @before, log: false)
  defp up!, do: Ecto.Migrator.run(Repo, @migrations, :up, to: 20_261_028_130_000, log: false)

  test "backfills first facts from acknowledged keeps only", %{db: db} do
    assert %{rows: [[_, "main", ^db]]} = Repo.query!("PRAGMA database_list")
    refute String.contains?(db, "priv/")

    up_to_previous!()

    Repo.insert_all("roots", [
      %{root: "r1", clan: "room-a", author_id: "a1", bound_at: @at}
    ])

    Repo.insert_all("keeps", [keep("k1", @at, "node-a"), keep("k2", nil, nil)])

    up!()

    assert Repo.all(
             from(ck in "clan_keeps",
               order_by: ck.id,
               select: {ck.clan, ck.id, ck.at, ck.node}
             )
           ) == [{"room-a", "k1", @at, "node-a"}],
           "only the keep with a known archive receipt is backfilled"

    assert Repo.one(from(k in "keeps", select: count(k.id))) == 2,
           "backfill adds evidence, never rewrites keeps"
  end

  test "duplicate incidences keep the first destination receipt; a second room is its own" do
    up!()

    insert = fn clan, at, node ->
      Repo.insert_all("clan_keeps", [%{clan: clan, id: "k1", at: at, node: node}],
        on_conflict: :nothing,
        conflict_target: [:clan, :id]
      )
    end

    insert.("room-a", 100, "node-1")
    insert.("room-a", 999, "node-late")
    insert.("room-b", 200, "node-b")

    assert Repo.all(
             from(ck in "clan_keeps",
               order_by: [asc: ck.clan],
               select: {ck.clan, ck.at, ck.node}
             )
           ) == [{"room-a", 100, "node-1"}, {"room-b", 200, "node-b"}],
           "a later receipt never overwrites the first; a second room is not a duplicate"
  end

  test "rollback before a second destination preserves keeps and drops the incidence" do
    up!()

    Repo.insert_all("roots", [
      %{root: "r1", clan: "room-a", author_id: "a1", bound_at: @at}
    ])

    Repo.insert_all("keeps", [keep("k1", @at, "node-a")])

    # Exactly reconstructible from keeps: same clan, same (shared_at, shared_node).
    Repo.insert_all("clan_keeps", [
      %{clan: "room-a", id: "k1", at: @at, node: "node-a"}
    ])

    Ecto.Migrator.run(Repo, @migrations, :down, step: 1, log: false)

    assert Repo.one(from(k in "keeps", select: count(k.id))) == 1,
           "down does not touch kept bytes"

    assert Repo.one(
             from(t in "sqlite_master",
               where: t.name == "clan_keeps",
               select: count(t.name)
             )
           ) == 0

    refute 20_261_028_130_000 in Repo.all(from(sm in "schema_migrations", select: sm.version)),
           "the pre-write control rolls back cleanly"
  end

  test "rollback after a second destination raises and leaves table, rows and version intact" do
    up!()

    Repo.insert_all("roots", [
      %{root: "r1", clan: "room-a", author_id: "a1", bound_at: @at}
    ])

    Repo.insert_all("keeps", [keep("k1", @at, "node-a")])

    # The second room cannot be rebuilt from keeps.clan, so this is canonical
    # evidence that only export can preserve.
    Repo.insert_all("clan_keeps", [
      %{clan: "room-a", id: "k1", at: @at, node: "node-a"},
      %{clan: "room-b", id: "k1", at: @at + 1, node: "node-b"}
    ])

    assert_raise Ecto.MigrationError, ~r/cannot be reconstructed/, fn ->
      Ecto.Migrator.run(Repo, @migrations, :down, step: 1, log: false)
    end

    assert Repo.one(from(ck in "clan_keeps", select: count(ck.clan))) == 2,
           "the refused rollback rolls back nothing"

    assert Repo.one(
             from(t in "sqlite_master",
               where: t.name == "clan_keeps",
               select: count(t.name)
             )
           ) == 1

    assert 20_261_028_130_000 in Repo.all(from(sm in "schema_migrations", select: sm.version)),
           "the migration version stays applied"
  end
end
