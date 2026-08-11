defmodule Dojo.Keep.Repo.Reader do
  @moduledoc """
  The keep's read pool (id:kb-10).

  `read_only: true` is the fence: a write is a module refusal, never a
  SQLITE_BUSY at 3 a.m. WAL readers are unlimited; the pool is sized for load.
  """
  use Ecto.Repo,
    otp_app: :dojo,
    adapter: Ecto.Adapters.SQLite3,
    read_only: true
end
