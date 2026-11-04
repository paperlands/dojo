defmodule Dojo.Keep.Repo.Migrations.CreateClanKeeps do
  @moduledoc """
  Independent destination evidence: which room received which exact keep.

  `clan_keeps` is an incidence receipt, not reach. It answers "this room was
  handed these bytes" — the fact a single `keeps.clan` column cannot carry when
  the same keep is shipped to a second room. Membership and authorship stay on
  `keeps`; withdrawal and current rights are not derivable from a receipt.

  `at`/`node` are the first destination receipt for that (room, keep), stamped
  by the receiving node. Backfill uses the only known archive receipt
  (`shared_at`, `shared_node`) and invents no forgotten destinations.
  """
  use Ecto.Migration

  def up do
    execute("""
    CREATE TABLE clan_keeps (
      clan TEXT NOT NULL,
      id   TEXT NOT NULL,
      at   INTEGER NOT NULL,
      node TEXT NOT NULL,
      PRIMARY KEY (clan, id)
    ) STRICT
    """)

    execute("""
    INSERT OR IGNORE INTO clan_keeps (clan, id, at, node)
    SELECT clan, id, shared_at, shared_node
    FROM keeps
    WHERE shared_at IS NOT NULL AND shared_node IS NOT NULL
    """)
  end

  def down do
    # Preservation fence: a receipt is reconstructible only when keeps still
    # carries the same clan and (shared_at, shared_node); otherwise refuse.
    # Runs in the migration transaction, so a raise leaves table/rows/version.
    execute(fn ->
      %{rows: [[unreconstructible]]} =
        repo().query!("""
        SELECT count(*)
        FROM clan_keeps ck
        LEFT JOIN keeps k ON k.id = ck.id
        WHERE k.id IS NULL
           OR k.clan IS NOT ck.clan
           OR k.shared_at IS NULL
           OR k.shared_node IS NULL
           OR k.shared_at IS NOT ck.at
           OR k.shared_node IS NOT ck.node
        """)

      if unreconstructible > 0 do
        raise Ecto.MigrationError,
          message:
            "refusing to drop clan_keeps: #{unreconstructible} receipt(s) cannot be " <>
              "reconstructed from keeps(clan, id, shared_at, shared_node); " <>
              "export second-destination evidence first"
      end

      repo().query!("DROP TABLE clan_keeps")
    end)
  end
end
