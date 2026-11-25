defmodule Dojo.Build.PubSubAdapterBoundaryTest do
  # The PubSub adapter is its own app so a host recompile cannot unload it
  # (`Mix.Compilers.Elixir` deletes and purges what the host rebuilds, while
  # Phoenix.Tracker.Shard keeps resolving the adapter by atom). The runtime half
  # of that invariant is in test/dojo/cluster/full_recompile_test.exs; this is the
  # build half: one partisan requirement, one absolute path, two owners.
  use ExUnit.Case, async: false

  @vendor "vendor/phx_pubsub_partisan"

  defp dep!(config, app) do
    Enum.find_value(config[:deps], fn
      {^app, opts} -> opts
      ^app -> []
      _ -> nil
    end) || flunk("#{inspect(app)} is not a dependency")
  end

  test "the host and the vendored adapter declare the same partisan" do
    vendor =
      Mix.Project.in_project(:phx_pubsub_partisan, @vendor, fn _ ->
        Mix.Project.config()
      end)

    assert dep!(Mix.Project.config(), :partisan) == dep!(vendor, :partisan),
           "the two partisan requirements no longer converge into one lock entry"
  end

  test "PARTISAN_PATH is absolute or the build fails" do
    # Mix expands `path:` against the project that declares it, and two projects
    # declare this one: a relative path would name two directories.
    for file <- ["mix.exs", Path.join(@vendor, "mix.exs")] do
      source = File.read!(file)

      assert source =~ ~r/PARTISAN_PATH/,
             "#{file} no longer reads PARTISAN_PATH — update this guard"

      assert source =~ ~r/Path\.type\(path\) == :absolute/,
             "#{file} accepts a relative PARTISAN_PATH"
    end
  end

  test "the adapter modules belong here, not to the app a compile empties" do
    owned = Application.spec(:phx_pubsub_partisan, :modules)

    for mod <- [Phoenix.PubSub.Partisan, Phoenix.PubSub.Partisan.Handler] do
      assert mod in owned
      refute mod in Application.spec(:dojo, :modules)
    end
  end
end
