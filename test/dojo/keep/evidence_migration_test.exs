defmodule Dojo.Keep.EvidenceMigrationTest.Repo do
  use Ecto.Repo, otp_app: :dojo, adapter: Ecto.Adapters.SQLite3
end

defmodule Dojo.Keep.EvidenceMigrationTest do
  use ExUnit.Case, async: false

  alias Dojo.Keep.EvidenceMigrationTest.Repo

  @migrations Path.expand("../../../priv/keep/migrations", __DIR__)
  @version 20_261_028_140_000

  setup do
    dir = Path.join(System.tmp_dir!(), "keep-evidence-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    start_supervised!({Repo, database: Path.join(dir, "keep.db"), pool_size: 1, log: false})
    on_exit(fn -> File.rm_rf!(dir) end)
    Ecto.Migrator.run(Repo, @migrations, :up, to: @version, log: false)
    :ok
  end

  test "empty evidence relations roll back without changing keeps" do
    assert Ecto.Migrator.run(Repo, @migrations, :down, step: 1, log: false) == [@version]
    assert %{rows: [[0]]} = Repo.query!("SELECT count(*) FROM keeps")

    assert %{rows: [[0]]} =
             Repo.query!(
               "SELECT count(*) FROM sqlite_master WHERE name IN ('keep_evidence', 'keep_proofs')"
             )
  end

  test "either retained genesis or a detached proof prevents destructive rollback" do
    for table <- ["keep_evidence", "keep_proofs"] do
      case table do
        "keep_evidence" ->
          Repo.insert_all(table, [%{root: "r", epoch: 0, genesis: "exact birth"}])

        "keep_proofs" ->
          Repo.insert_all(table, [%{id: "k", root: "r", epoch: 0, signature: "original proof"}])
      end

      assert_raise Ecto.MigrationError, ~r/export signing evidence/, fn ->
        Ecto.Migrator.run(Repo, @migrations, :down, step: 1, log: false)
      end

      assert %{rows: [[1]]} = Repo.query!("SELECT count(*) FROM #{table}")

      assert %{rows: [[1]]} =
               Repo.query!("SELECT count(*) FROM schema_migrations WHERE version = ?", [@version])

      Repo.delete_all(table)
    end
  end
end
