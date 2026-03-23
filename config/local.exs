import Config

# Local release config — Burrito-wrapped desktop binary.
# Mirrors prod.exs: static manifest, no debug noise, no Swoosh local storage.
config :dojo, DojoWeb.Endpoint, cache_static_manifest: "priv/static/cache_manifest.json"

config :swoosh, api_client: Swoosh.ApiClient.Finch, finch_name: Dojo.Finch
config :swoosh, local: false

config :logger, level: :info
