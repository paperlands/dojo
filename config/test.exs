import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
# config :dojo, Dojo.Repo,
#   username: "postgres",
#   password: "postgres",
#   hostname: "localhost",
#   database: "dojo_test#{System.get_env("MIX_TEST_PARTITION")}",
#   pool: Ecto.Adapters.SQL.Sandbox,
#   pool_size: System.schedulers_online() * 2

# Keep journal — one file per partition, never :memory: (each connection
# would otherwise get its own database) (id:keep-ms-sqlite-path, id:kb-10).
# Reader points at the same file; default_dynamic_repo in DataCase makes
# sandbox writes visible to the read pool.
keep_test =
  Path.expand(
    "../priv/keep/keep_test#{System.get_env("MIX_TEST_PARTITION")}.db",
    __DIR__
  )

config :dojo, Dojo.Keep.Repo,
  database: keep_test,
  priv: "priv/keep",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2,
  journal_mode: :wal,
  busy_timeout: 5_000

config :dojo, Dojo.Keep.Repo.Reader,
  database: keep_test,
  priv: "priv/keep",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2,
  journal_mode: :wal,
  busy_timeout: 5_000

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :dojo, DojoWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "dxdbdsM9CJ3h26ZS60WvP1wgXEB01fs3bEXCHv4/wifR6C36RpjSdsvIj5Zi06JB",
  server: false

# In test we don't send emails.
config :dojo, Dojo.Mailer, adapter: Swoosh.Adapters.Test

# Disable swoosh api client as it is only required for production adapters.
config :swoosh, :api_client, false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

config :phoenix_live_view,
  # Enable helpful, but potentially expensive runtime checks
  enable_expensive_runtime_checks: true

config :dojo, :cluster_adapter, Dojo.Cluster.MDNS.DistAdapter
