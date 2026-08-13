defmodule Dojo.Keep.Repo.Reader do
  @moduledoc """
  The keep's read pool (id:kb-10).

  Two pools, not one: a writer of 1 and a reader sized for load. That is the
  load-bearing reason — one pool of 1 queues every read behind a blob write;
  one shared pool of N breaks the one-writer law. WAL readers are unlimited.

  The write fence is a conjunction, not a single switch:

    * `read_only: true` omits schema write functions (`insert*`, `update*`,
      `delete*`) — a module refusal, never SQLITE_BUSY at 3 a.m.
    * `query/3` and `query!/3` are *not* gated by `read_only` (ecto_sql).
      The second term is "no ad-hoc SQL" — every keep SQL lives in
      `Dojo.Keep`, and `Reader.query` appears nowhere. The repo_test greps
      both halves.

  Every keep read (`pull`, `fact_of`, `by_id`, `head_of`, `source_of`) goes
  through here. The writer is for writes — and for the bind's read-after-write
  after the insert has committed.
  """
  use Ecto.Repo,
    otp_app: :dojo,
    adapter: Ecto.Adapters.SQLite3,
    read_only: true
end
