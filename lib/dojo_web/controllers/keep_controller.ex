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

  @doc """
  One river, cursored (id:ka-door-shape).

  The page and its next cursor arrive together from the domain, which owns the
  bound — a caller never builds a cursor and never counts rows to guess the end.

  Revalidate, never immutable: this address names a continuant and its head
  moves (id:ka-seat).
  """
  def history(conn, %{"ref" => ref} = params) do
    {keeps, next} = Dojo.Keep.history(ref, depth_opts(params))

    conn
    |> put_resp_header("cache-control", "no-cache")
    |> json(%{keeps: keeps, next: next})
  end

  @doc """
  The fan — each continuant's head (id:ka-latest).

  Here and not on the socket: the room name is a URL fact already
  (`shell_live.ex:46`, id:la-law), and reads are open, so a connection buys this
  door nothing. `clan` selects a room; it does not fence one.

  The caller names the room — it was served one — so there is no default here
  to drift from the one the shell already holds. Unnamed is no room, not a
  guess at which.

  Prehydration is an address, not bytes: rows carry `face`, and the picture is
  one immutable GET away (id:ka-seat), so a second visit is free.
  """
  def latest(conn, params) do
    {keeps, next} = Dojo.Keep.latest(params["clan"], fan_opts(params))

    conn
    |> put_resp_header("cache-control", "no-cache")
    |> json(%{keeps: keeps, next: next})
  end

  defp fan_opts(params) do
    []
    |> put_int(:n, params["n"])
    |> put_of(params["of"])
    |> put_decoded(:after, params["after"], &Dojo.Keep.after_room/1)
  end

  defp depth_opts(params) do
    []
    |> put_int(:n, params["n"])
    |> put_of(params["of"])
    |> put_decoded(:after, params["after"], &Dojo.Keep.after_cursor/1)
  end

  defp put_int(opts, key, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> Keyword.put(opts, key, n)
      _ -> opts
    end
  end

  defp put_int(opts, _, _), do: opts

  defp put_of(opts, of) when of in ~w(target root), do: Keyword.put(opts, :of, of)
  defp put_of(opts, _), do: opts

  # The codec is the domain's (id:ka-cursor). Two clocks, so two decoders —
  # the door picks; garbage is no cursor.
  defp put_decoded(opts, key, raw, decode) do
    case decode.(raw) do
      nil -> opts
      cur -> Keyword.put(opts, key, cur)
    end
  end

  @doc """
  The picture, on the walk (id:kb-13, id:ka-seat).

  Immutable forever: the id IS the hash of the message this picture belongs to,
  so these bytes can never change under this URL (id:kc-p-naming reaching HTTP).
  """
  def image(conn, %{"id" => id}) do
    case Dojo.Keep.image_of(id) do
      {:ok, bytes} ->
        conn
        |> put_resp_content_type("image/png")
        |> put_resp_header("cache-control", "public, max-age=31536000, immutable")
        |> send_resp(200, bytes)

      :none ->
        # Absent is a NAMED state, never an error (id:kc-e-missing-image): the
        # keep may be whole and its picture simply not here yet.
        send_resp(conn, 404, "")
    end
  end
end
