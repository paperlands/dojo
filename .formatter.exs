[
  import_deps: [:ecto, :ecto_sql, :phoenix],
  subdirectories: ["priv/*/migrations"],
  plugins: [Phoenix.LiveView.HTMLFormatter],
  # vendor/*/ is a path dep: it is not part of this app's compile, but it is
  # part of this repo, so `mix format --check-formatted` must still see it.
  inputs: [
    "*.{heex,ex,exs}",
    "{config,lib,test}/**/*.{heex,ex,exs}",
    "priv/*/seeds.exs",
    "vendor/*/mix.exs",
    "vendor/*/lib/**/*.ex"
  ]
]
