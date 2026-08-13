defmodule Dojo.Keep.Repo.Migrations.DropKeepsLatestIdx do
  @moduledoc """
  The index arrived with the wrong column, and that is why its door looked shut.

  `keeps_latest_idx (clan, ts_t DESC)` was cut on the **author's** clock. A room
  is many hands, so ordering a room by `ts_t` compares clocks that must never be
  compared (id:kb-8's two orders) — which is exactly why id:ka-latest read the
  clan fold as unlawful and shut the door.

  It had the wrong subject. The lawful ordering is the ROOM's clock, `shared_at`,
  written by one writer at receive:

      the author's clock orders WITHIN a river · the room's clock orders THE RIVERS

  So the ruling blamed the door for the index's defect. `Keep.latest/2` is that
  door, built (id:ka-latest, re-argued), and its measured plan wants no
  keeps-side clan index in **either** column:

      SCAN w                                  -- rivers, not moments
      SEARCH r USING sqlite_autoindex_roots_1 -- the room scope, through the bind
      SEARCH k USING sqlite_autoindex_keeps_1 -- the head, by primary key
      CORRELATED SCALAR SUBQUERY
        SEARCH k2 USING INDEX keeps_head_idx  -- the author's clock, per river
      USE TEMP B-TREE FOR ORDER BY            -- sorts W rows, not keeps

  `works` is what made it cheap: before it, enumerating a room's rivers meant
  `SELECT DISTINCT target`, a scan that cannot name an owner.

  Measured cost of keeping it: the two orphan indexes together cost 2.3x on
  insert (95 ms against 41 ms per 10k) and 31% more disk, all on the single
  writer id:kb-vet7 59 flagged for latency. `keeps_history_idx` is NOT dropped
  here — it is held at the author's word, pending a door.

  Index-only, add-only in the sense that matters: `keeps` never alters and no
  row is rewritten (id:kb-11).
  """
  use Ecto.Migration

  def up do
    execute("DROP INDEX IF EXISTS keeps_latest_idx")
  end

  def down do
    execute("CREATE INDEX keeps_latest_idx ON keeps (clan, ts_t DESC)")
  end
end
