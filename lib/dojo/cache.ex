defmodule Dojo.Cache do
  use Nebulex.Cache,
    otp_app: :dojo,
    adapter: Nebulex.Adapters.Partitioned,
    partitions: System.schedulers_online(),
    gc_interval: :timer.minutes(60)
end
