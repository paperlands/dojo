# The default suite is a single-process proof. These tags need their own
# process or a real network; including them here makes test order observable.
ExUnit.start(exclude: [clustered: true, lan: true, reload_sim: true, full_recompile: true])
Ecto.Adapters.SQL.Sandbox.mode(Dojo.Keep.Repo, :manual)
