defmodule DojoWeb.Plugs.FlyReplay do
  @moduledoc """
  Fly.io dynamic request routing for cross-node static assets.

  When a request includes a `fly_instance_id` query param that doesn't
  match this machine's FLY_MACHINE_ID, responds with a `fly-replay`
  header to tell Fly's proxy to replay the request to the correct machine.

  Only active when FLY_MACHINE_ID is set (i.e. running on Fly.io).
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    conn = fetch_query_params(conn)

    with machine_id when is_binary(machine_id) <- System.get_env("FLY_MACHINE_ID"),
         %{"fly_instance_id" => target} <- conn.query_params,
         true <- target != machine_id do
      conn
      |> put_resp_header("fly-replay", "instance=#{target}")
      |> send_resp(307, "")
      |> halt()
    else
      _ -> conn
    end
  end
end
