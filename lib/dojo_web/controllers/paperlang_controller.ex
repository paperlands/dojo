defmodule DojoWeb.PaperLangController do
  use DojoWeb, :controller

  # Extensionless compatibility pointer. The public executable URLs are
  # first-party raw ESM at paperland.sg; npm is an independent channel.
  @site "https://paperland.sg/paperlang/"
  @line ~r/\A(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\z/

  def show(conn, %{"version" => version}) do
    conn = pointer_headers(conn)

    if supported?(version) do
      redirect(conn, external: @site <> version <> ".js")
    else
      not_found(conn)
    end
  end

  def options(conn, %{"version" => version}) do
    conn = pointer_headers(conn)

    if supported?(version) do
      conn
      |> put_resp_header("access-control-max-age", "600")
      |> send_resp(:no_content, "")
    else
      not_found(conn)
    end
  end

  defp supported?(version), do: version == "latest" or Regex.match?(@line, version)

  defp pointer_headers(conn) do
    conn
    |> put_resp_header("access-control-allow-origin", "*")
    |> put_resp_header("access-control-allow-methods", "GET, HEAD, OPTIONS")
    |> put_resp_header("cross-origin-resource-policy", "cross-origin")
    |> put_resp_header("cache-control", "public, max-age=60")
    |> put_resp_header("x-content-type-options", "nosniff")
  end

  defp not_found(conn) do
    conn
    |> put_resp_header("cache-control", "no-store")
    |> put_resp_content_type("text/plain")
    |> send_resp(:not_found, "Unknown PaperLang version pointer\n")
  end
end
