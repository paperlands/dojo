# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :dojo,
  ecto_repos: [Dojo.Repo],
  generators: [timestamp_type: :utc_datetime]

# Configures the endpoint
config :dojo, DojoWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [html: DojoWeb.ErrorHTML, json: DojoWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Dojo.PubSub,
  check_origin: ["https://dojo.paperland.sg", "https://dojo.paperland.in", "https://thedojo.fly.dev"],
  live_view: [signing_salt: "ko/5Xrfn"]

# Configures the mailer
#
# By default it uses the "Local" adapter which stores the emails
# locally. You can see the emails in your browser, at "/dev/mailbox".
#
# For production it's recommended to configure a different adapter
# at the `config/runtime.exs`.
config :dojo, Dojo.Mailer, adapter: Swoosh.Adapters.Local

# Configure esbuild (the version is required)
config :esbuild,
  version: "0.17.11",
  dojo: [
    args:
      ~w(js/app.js --bundle --target=es2017 --outdir=../priv/static/assets --external:/fonts/* --external:/images/* --external:/codemirror/*),
    cd: Path.expand("../assets", __DIR__),
    env: %{"NODE_PATH" => Path.expand("../deps", __DIR__)}
  ]

# Configure tailwind (the version is required)
config :tailwind,
  version: "3.4.0",
  dojo: [
    args: ~w(
      --config=tailwind.config.js
      --input=css/app.css
      --output=../priv/static/assets/app.css
    ),
    cd: Path.expand("../assets", __DIR__)
  ]

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason


config :dojo, Dojo.Cache,
       gc_interval: :timer.minutes(5),
       backend: :shards,
       # Very short minimum cleanup timeout
       gc_cleanup_min_timeout: :timer.seconds(1),
       # Short maximum cleanup timeout
       gc_cleanup_max_timeout: :timer.seconds(30)

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
