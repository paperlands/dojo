defmodule Dojo.MixProject do
  use Mix.Project

  def project do
    [
      app: :dojo,
      version: "0.2.0",
      elixir: "~> 1.18",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() in [:prod, :local],
      aliases: aliases(),
      deps: deps(),
      listeners: [Phoenix.CodeReloader],
      compilers: [:phoenix_live_view] ++ Mix.compilers(),
      releases: releases()
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {Dojo.Application, []},
      extra_applications: [:logger, :runtime_tools, :inets]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:lazy_html, ">= 0.0.0", only: :test},
      {:phoenix, "~> 1.8"},
      {:phoenix_ecto, "~> 4.4"},
      {:ecto_sql, "~> 3.10"},
      {:postgrex, ">= 0.0.0"},
      {:phoenix_html, "~> 4.0"},
      {:phoenix_live_reload, "~> 1.5", only: :dev},
      {:phoenix_live_view, "~> 1.1.3"},
      {:phoenix_pubsub, "~> 2.1"},
      {:floki, ">= 0.30.0", only: :test},
      {:phoenix_live_dashboard, "~> 0.8.6"},
      {:esbuild, "~> 0.9", runtime: Mix.env() == :dev},
      {:tailwind, "~> 0.3", runtime: Mix.env() == :dev},
      {:heroicons,
       github: "tailwindlabs/heroicons",
       tag: "v2.1.1",
       sparse: "optimized",
       app: false,
       compile: false,
       depth: 1},
      {:swoosh, "~> 1.5"},
      {:finch, "~> 0.13"},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:gettext, "~> 0.26"},
      {:jason, "~> 1.2"},
      {:kino, "~> 0.16"},
      {:nebulex, "~> 2.6"},
      {:shards, "~> 1.1.1"},
      {:observer_cli, "~> 1.8"},
      {:kino_vega_lite, "~> 0.1.11"},
      {:dns_cluster, "~> 0.1.1"},
      {:bandit, "~> 1.2"},
      {:earmark, "1.5.0-pre1", override: true},
      {:earmark_parser, "1.4.44"},
      {:html_sanitize_ex, "~> 1.4"},
      {:makeup, "~> 1.1"},
      {:makeup_elixir, "~> 0.16"},
      {:burrito, "~> 1.5"}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "compile", "assets.setup", "assets.build", "assets.deploy"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
      "assets.setup": ["tailwind.install --if-missing", "esbuild.install --if-missing"],
      "assets.build": ["tailwind dojo", "esbuild dojo"],
      "assets.deploy": [
        "tailwind dojo --minify",
        "esbuild dojo --minify",
        "phx.digest"
      ]
    ]
  end

  def releases do
    steps = if Mix.env() == :local do
      [:assemble, &Burrito.wrap/1]
    else
      [:assemble]
    end
    
    [
      dojo: [
        steps: steps,
        burrito: [
          targets: [
            macos: [os: :darwin, cpu: :x86_64],
            macos_silicon: [os: :darwin, cpu: :aarch64],
            linux: [os: :linux, cpu: :x86_64],
            windows: [os: :windows, cpu: :x86_64]
          ]
        ]
      ]
    ]

  end
end
