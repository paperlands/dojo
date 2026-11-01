defmodule Dojo.Keep.Repo.Migrations.CreateKeepEvidence do
  @moduledoc "Root/key evidence and detached keep proofs, never keeps flags."
  use Ecto.Migration

  def up do
    execute("""
    CREATE TABLE keep_evidence (
      root TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 0),
      genesis TEXT NOT NULL,
      PRIMARY KEY (root, epoch)
    ) STRICT
    """)

    execute("""
    CREATE TABLE keep_proofs (
      id TEXT NOT NULL,
      root TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 0),
      signature TEXT NOT NULL,
      PRIMARY KEY (id, root, epoch)
    ) STRICT
    """)
  end

  def down do
    execute(fn ->
      %{rows: [[count]]} =
        repo().query!(
          "SELECT (SELECT count(*) FROM keep_evidence) + (SELECT count(*) FROM keep_proofs)"
        )

      if count > 0 do
        raise Ecto.MigrationError,
          message: "export signing evidence before dropping keep_evidence"
      end

      repo().query!("DROP TABLE keep_proofs")
      repo().query!("DROP TABLE keep_evidence")
    end)
  end
end
