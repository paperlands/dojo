defmodule Dojo.Keep.Repo do
  @moduledoc """
  The keep's one writer (id:kb-10).

  SQLite admits one writer; pool_size is 1. Do not touch Dojo.Repo —
  this is a greenfield beside it, never an adapter swap.
  """
  use Ecto.Repo, otp_app: :dojo, adapter: Ecto.Adapters.SQLite3
end
