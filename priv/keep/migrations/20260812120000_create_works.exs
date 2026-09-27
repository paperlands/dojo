defmodule Dojo.Keep.Repo.Migrations.CreateWorks do
  @moduledoc """
  The second continuant gets its binding (id:ka-works-bind).

  `roots` binds root → clan and the primary key is the ACL (D017). `target`
  had no such table — id:kb-13-cut-3 named it "an unbound continuant" and
  left it pre-shaped. id:ka-hijack measured what that costs: `project/2`
  reads five frozen fields and judges none, `bind/4` judges `root`, and
  NOTHING checked `target` — so a clan-mate ships under another member's work
  and `head_of` hands their keep to every visitor of `?fork=<work_id>`.

  One judgement per continuant, decided by its primary key (id:ka-rule).

  ## Two columns, because there is no third fact

  A bind is a projection the wire refuses to contradict, so every column must
  be re-derivable from the log. `bound_at` was here and is gone: it had ZERO
  readers, and it was being filled from two different clocks — server time on
  the live path, the author's `ts_t` in the backfill, indistinguishable on
  disk. A column with no door is id:kb-vet7 54's law again (an index arrives
  with its door), and `roots.bound_at` was the precedent it copied rather than
  a center it extended. It is re-derivable from `min(shared_at)` the day
  anything wants it.

  ## Why no origin columns yet

  The fork keep (id:ka-fork) is a later rung. Columns with no writer are the
  same fault. When `kind: fork` lands, this table is DROPPED AND RE-PROJECTED
  from the log — the log never alters; a projection may be rebuilt
  (id:kb-vet2-rebuild).
  """
  use Ecto.Migration

  def up do
    execute("""
    CREATE TABLE works (
      work_id TEXT PRIMARY KEY,
      root    TEXT NOT NULL
    ) STRICT
    """)

    # THE REBUILD IS THE UPGRADE (id:kb-vet2-rebuild). `head_of` reads `works`,
    # so without this every keep already on disk becomes unreachable and every
    # `?fork=<work_id>` link in the wild 404s — silently.
    #
    # [⚠] AND THE BACKFILL MUST DECIDE OWNERSHIP THE WAY THE LIVE WRITER DOES.
    # A first cut ordered by `ts_t` — which is a WIRE field the client writes.
    # The live rule is TOFU (first arrival at this machine wins); ordering by
    # ts_t is "lowest self-declared clock wins", and the two disagree in
    # exactly the case this table exists to fence: a hijacker stamping ts_t: 0
    # takes the river at migration time, and the true author's every later
    # keep is then refused :work, permanently, marked shared — id:kb-vet5 40's
    # wound reborn through the other continuant. id:kb-11-derive's fence
    # ("derived from the message, never accepted from the wire") does not
    # cover it, because ts_t IS the wire.
    #
    # `rowid` is arrival order on this machine: TOFU replayed, unforgeable,
    # and it needs no tiebreak. (`shared_at` is the semantic twin but is
    # nullable, and NULL sorts first — rowid is the fact it only records.)
    execute("""
    INSERT INTO works (work_id, root)
    SELECT k.target, k.root
      FROM keeps k
     WHERE k.target IS NOT NULL
       AND k.rowid = (SELECT min(k2.rowid) FROM keeps k2 WHERE k2.target = k.target)
    """)
  end

  def down do
    execute("DROP TABLE IF EXISTS works")
  end
end
