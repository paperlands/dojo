defmodule Dojo.Keep.Repo.Migrations.CreateAuthors do
  @moduledoc """
  One author, many devices (id:ki-compost-model).

  `authors` is where letters live; `roots.author_id` is the arrow. STRICT and
  add-only (id:kb-11). The pre-cut only wears it — no new callers.
  """
  use Ecto.Migration

  def up do
    execute("""
    CREATE TABLE authors (
      author_id TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      named_at  INTEGER NOT NULL
    ) STRICT
    """)
  end

  def down do
    execute("DROP TABLE IF EXISTS authors")
  end
end
