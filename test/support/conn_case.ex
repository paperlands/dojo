defmodule DojoWeb.ConnCase do
  @moduledoc """
  This module defines the test case to be used by
  tests that require setting up a connection.

  Such tests rely on `Phoenix.ConnTest` and also
  import other functionality to make it easier
  to build common data structures and query the data layer.

  Finally, if the test case interacts with the database,
  we enable the SQL sandbox, so changes done to the database
  are reverted at the end of every test. If you are using
  PostgreSQL, you can even run database tests asynchronously
  by setting `use DojoWeb.ConnCase, async: true`, although
  this option is not recommended for other databases.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      # The default endpoint for testing
      @endpoint DojoWeb.Endpoint

      use DojoWeb, :verified_routes

      # Import conveniences for testing with connections
      import Plug.Conn
      import Phoenix.ConnTest
      import DojoWeb.ConnCase
    end
  end

  setup _tags do
    # [⚠] THE SANDBOX IS OFF HERE, AND THE FIRST KEEP ConnTest WILL PAY FOR IT.
    #
    # id:kb-vet7 57 predicted half of this: a controller runs in its own
    # process, so `DataCase`'s per-process `default_dynamic_repo` trick does
    # not reach it and a Reader read would see nothing. The other half is the
    # line below — with the sandbox commented out there is no containment at
    # all, so a ConnTest over `/keeps/*` writes to the real test database and
    # leaks into every suite after it.
    #
    # Closing it wants `Phoenix.Ecto.SQL.Sandbox` plus `Sandbox.allow/3` for
    # the controller's pid — shared test infrastructure, and its own change.
    # Until then the keep's HTTP doors are covered underneath: the domain in
    # `test/dojo/keep/pull_test.exs`, the cursor codec purely, and the query
    # plans in `repo_test.exs`.
    #
    # Dojo.DataCase.setup_sandbox(tags)
    {:ok, conn: Phoenix.ConnTest.build_conn()}
  end
end
