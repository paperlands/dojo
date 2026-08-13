defmodule Dojo.DataCase do
  @moduledoc """
  Setup for tests that touch the keep's data layer (id:kb-10).

  ## Two pools, one sandbox

  The writer and the reader are different pools. A sandbox transaction on
  `Dojo.Keep.Repo` is invisible to `Dojo.Keep.Repo.Reader`. So this case
  points Reader at Repo *for the test process only* — most tests exercise
  the query shape, not the pool boundary. The two-pool seam (committed
  write → real reader) is a separate test that uses
  `Ecto.Adapters.SQL.Sandbox.unboxed_run/2`.

  ## ConnTest trap

  `Phoenix.ConnTest` runs the endpoint in another process. That process
  does not inherit `put_dynamic_repo`, so `Keep.pull/1` hits the *real*
  Reader pool and cannot see an uncommitted sandbox write — 404 that looks
  like a storage bug. Before a conn that touches the keep:

    * keep Reader pointed at Repo for that process too, **or**
    * share ownership (`shared: true` / `Sandbox.allow/3`) and still
      route Reader through Repo, **or**
    * commit outside the sandbox (`unboxed_run`).

  The sandbox also does not reach an external process (D004's Table owns
  its connection for life). Name both seams in the first test that
  crosses them, not the tenth.
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

  Reader is pointed at Repo for the test process so sandbox writes are
  visible on the read path (id:kb-10) — two pools do not share a transaction.

  Tag `:two_pool` to leave both pools real (committed writes, real Reader).
  Those tests own cleanup.
  """
  def setup_sandbox(tags) do
    if tags[:two_pool] do
      # Real writer connection (no sandbox transaction) + real read pool.
      # pool_size is 1: unboxed_run cannot steal the owner connection.
      :ok = Ecto.Adapters.SQL.Sandbox.checkout(Dojo.Keep.Repo, sandbox: false)
      Dojo.Keep.Repo.Reader.put_dynamic_repo(Dojo.Keep.Repo.Reader)
      on_exit(fn -> Ecto.Adapters.SQL.Sandbox.checkin(Dojo.Keep.Repo) end)
    else
      pid =
        Ecto.Adapters.SQL.Sandbox.start_owner!(Dojo.Keep.Repo, shared: not tags[:async])

      Dojo.Keep.Repo.Reader.put_dynamic_repo(Dojo.Keep.Repo)
      on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
    end
  end
end
