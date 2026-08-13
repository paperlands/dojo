defmodule Dojo.Keep.Repo.Migrations.CreateSources do
  @moduledoc """
  The source referent's home (id:kb-vet5-referent).

  A referent is what a keep POINTS AT; the message is what a keep IS. Two
  referents, two keyings, because two cardinalities (id:kb-source-keys):

    * source — key = hash(text); SHARED across messages; fans on write;
               NEVER evicted, because it is re-derivable from nothing.
    * image  — key = the message's id; ONE per keep; rides the share;
               evictable, because re-running the turtle re-derives it. Its
               home is `keeps.image`, already last in the row on purpose.

  Add-only. `keeps` never alters (id:kb-11).
  """
  use Ecto.Migration

  def up do
    # Content-addressed, so it needs no ownership fence: hash(text) == id is
    # the proof, and the disk refuses a type lie (STRICT).
    execute("""
    CREATE TABLE sources (
      id   TEXT PRIMARY KEY,
      text TEXT NOT NULL
    ) STRICT
    """)
  end

  def down do
    execute("DROP TABLE IF EXISTS sources")
  end
end
