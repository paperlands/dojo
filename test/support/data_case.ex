defmodule Dojo.DataCase do
  @moduledoc """
  Setup for tests that touch the keep's data layer (id:kb-10).

  The sandbox does not reach an external process (D004's Table owns its
  connection for life). Name it in the first test that crosses that seam,
  not the tenth.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      alias Dojo.Keep.Repo

      import Ecto
      import Ecto.Query
      import Dojo.DataCase
    end
  end

  setup tags do
    Dojo.DataCase.setup_sandbox(tags)
    :ok
  end

  @doc """
  Own the writer's sandbox connection for this test process.
  """
  def setup_sandbox(tags) do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Dojo.Keep.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
  end
end
