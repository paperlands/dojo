import Config

# Real network, quiet web surface. Each node receives its own Keep database in
# runtime.exs; this file stays free of node-specific values so one LAN build is
# safe to share.
config :dojo, DojoWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: System.get_env("PORT") || 4000],
  check_origin: false,
  code_reloader: false,
  debug_errors: false,
  secret_key_base: "lan-e2e-only-secret-key-base-must-be-at-least-64-bytes-long-000000"

config :dojo, Dojo.Mailer, adapter: Swoosh.Adapters.Test
config :swoosh, :api_client, false
config :logger, level: :warning
