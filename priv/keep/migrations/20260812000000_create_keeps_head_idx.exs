defmodule Dojo.Keep.Repo.Migrations.CreateKeepsHeadIdx do
  @moduledoc """
  The by-target index — one index, three doors (id:ka-door-shape).

  `head_of` planned as `SCAN keeps` + `USE TEMP B-TREE FOR ORDER BY` on a
  public HTTP route (id:ka-ground). Same shape as keeps_history_idx, one
  column over: `target` is not "the work" but *what this keep is about*
  (id:ka-selectors), so this one index serves the head, the work's history
  range, and by-target backlinks when the walk kind is born.

  Index-only door, which id:kb-11 licenses: `keeps` never alters, and the
  count that matters is zero ALTERs, not one migration file.

  Inscribe the law it was late for (id:kb-vet7 54): an index arrives with
  its door, never before it.
  """
  use Ecto.Migration

  def up do
    execute("""
    CREATE INDEX keeps_head_idx ON keeps (target, ts_t DESC, ts_n DESC)
    """)
  end

  def down do
    execute("DROP INDEX IF EXISTS keeps_head_idx")
  end
end
