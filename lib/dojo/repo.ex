defmodule Dojo.Repo do
  use Ecto.Repo,
    otp_app: :dojo,
    adapter: Ecto.Adapters.Postgres
end
