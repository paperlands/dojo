defmodule Dojo.Cache do
  use Nebulex.Cache,
    otp_app: :dojo,
    adapter: Nebulex.Adapters.Partitioned
end
