defmodule Dojo.Keep.Repo.Migrations.CreateKeepsAndRoots do
  @moduledoc """
  The keep's row and the TOFU binding (id:kb-11).

  STRICT — a bug in project/2 cannot corrupt ordering; the disk refuses it.
  No ALTER, ever. Index-only doors may grow later; the table shape does not.
  image is LAST: a query that does not name it never touches the blob pages.
  """
  use Ecto.Migration

  def up do
    # STRICT needs SQLite ≥ 3.37. Bundled exqlite is well above that.
    # Raw execute: Ecto has no STRICT keyword and no partial DDL for this.
    execute("""
    CREATE TABLE keeps (
      id          TEXT PRIMARY KEY,
      clan        TEXT NOT NULL,
      root        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      target      TEXT,
      ts_t        INTEGER NOT NULL,
      ts_n        INTEGER NOT NULL,
      message     TEXT NOT NULL,
      shared_at   INTEGER,
      shared_node TEXT,
      inserted_at TEXT NOT NULL,
      image       BLOB
    ) STRICT
    """)

    execute("""
    CREATE INDEX keeps_history_idx ON keeps (root, ts_t DESC, ts_n DESC)
    """)

    execute("""
    CREATE INDEX keeps_latest_idx ON keeps (clan, ts_t DESC)
    """)

    # TOFU: primary key is the ACL (D017). First arrival binds; later
    # claimants of the same root are refused by read-back compare (id:kb-12).
    execute("""
    CREATE TABLE roots (
      root      TEXT PRIMARY KEY,
      clan      TEXT NOT NULL,
      author_id TEXT NOT NULL,
      bound_at  INTEGER NOT NULL
    ) STRICT
    """)
  end

  def down do
    execute("DROP TABLE IF EXISTS keeps")
    execute("DROP TABLE IF EXISTS roots")
  end
end
