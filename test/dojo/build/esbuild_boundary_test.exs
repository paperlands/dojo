defmodule Dojo.Build.EsbuildBoundaryTest do
  # id:assets-bundle-boundary — a path-like --external is matched against resolved
  # filesystem paths after resolution, so its meaning moves with the OS: a leading
  # / is root-absolute on Linux and volume-relative on Windows. That is how
  # `/vendor/*` externalized every assets/vendor/* import on a Windows checkout and
  # shipped __require calls a browser cannot honour. The browser build therefore
  # carries no external at all; a runtime-loaded module earns a non-analyzable
  # import instead (assets/js/hooks/shell/core.js, the CM6 line).
  #
  # This is the cheap half of the guard: it runs on every `mix test`, on any OS,
  # without a build. The artifact half is `mix verify.assets` (deploy).
  use ExUnit.Case, async: true

  # Adding a pattern here is a decision, not a fix: name it, say why it cannot be
  # bundled, and prove the consumer tolerates the runtime require.
  @approved_externals []

  defp args, do: Application.fetch_env!(:esbuild, :dojo) |> Keyword.fetch!(:args)

  test "the browser build externalizes nothing it has not approved" do
    externals =
      args()
      |> Enum.filter(&String.starts_with?(&1, "--external:"))
      |> Enum.map(&String.replace_prefix(&1, "--external:", ""))

    assert externals -- @approved_externals == [],
           "unapproved --external: #{inspect(externals -- @approved_externals)}"
  end

  test "both browser entries are named, so the guard cannot pass vacuously" do
    assert "js/app.js" in args()
    assert "js/keep/journal.worker.js" in args()
  end
end
