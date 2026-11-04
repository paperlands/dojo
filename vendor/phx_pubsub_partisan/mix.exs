defmodule PhxPubSubPartisan.MixProject do
  use Mix.Project

  # Own app on purpose: a host-only recompile deletes and unloads every beam it
  # rebuilds (Mix.Compilers.Elixir.remove_and_purge/2), and Phoenix.Tracker.Shard
  # calls this adapter by atom. Not purged by that compile; see its moduledoc.
  def project do
    [
      app: :phx_pubsub_partisan,
      version: "0.1.0",
      # The floor the code needs, not the version we happen to run: `Logger.warning/1`
      # landed in 1.15 and `phoenix_pubsub` itself asks only for 1.13. Raise this
      # only with a syntax or API that demands it.
      elixir: "~> 1.15",
      deps: deps()
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  defp deps do
    [
      # 2.2 is the floor for a reason, not habit: it is where shards stop
      # restarting on normal termination, which the restart arithmetic around
      # this adapter's callers assumes.
      {:phoenix_pubsub, "~> 2.2"},
      {:partisan, partisan_dep()}
    ]
  end

  # Same spec as the host's mix.exs (byte-identical, or the two requirements
  # stop converging). PARTISAN_PATH must be absolute: Mix expands a relative
  # path against the project that declared it — here that is a second directory.
  defp partisan_dep do
    case System.get_env("PARTISAN_PATH") do
      nil ->
        [github: "paperlands/partisan", ref: "bf16654c0c9bec4aac999e38cd43167ad2ae17d1"]

      path ->
        Path.type(path) == :absolute ||
          Mix.raise("PARTISAN_PATH must be absolute, got: #{path}")

        [path: path]
    end
  end
end
