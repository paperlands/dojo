defmodule DojoWeb.KeepController do
  use DojoWeb, :controller

  # The room's read door for the fork word (id:la-fork-pull) — sibling of the
  # walk's GET /keeps/:id/image (id:kb-13). The reader verifies the name; this
  # answer carries no authority.
  def pull(conn, %{"ref" => ref}) do
    case Dojo.Keep.pull(ref) do
      {:ok, keep} -> json(conn, keep)
      :none -> send_resp(conn, 404, "")
    end
  end
end
