defmodule DojoWeb.PaperLangControllerTest do
  use DojoWeb.ConnCase, async: true

  test "latest redirects to the first-party executable without a filename", %{conn: conn} do
    conn =
      conn
      |> put_req_header("accept", "text/javascript")
      |> put_req_header("origin", "https://example.org")
      |> get(~p"/paperlang/latest")

    assert redirected_to(conn, 302) == "https://paperland.sg/paperlang/latest.js"
    assert get_resp_header(conn, "cache-control") == ["public, max-age=60"]
    assert get_resp_header(conn, "access-control-allow-origin") == ["*"]
    assert get_resp_header(conn, "cross-origin-resource-policy") == ["cross-origin"]
    assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
    assert get_resp_header(conn, "set-cookie") == []
    assert get_resp_header(conn, "access-control-allow-credentials") == []
  end

  test "a release line floats only within that major.minor", %{conn: conn} do
    for line <- ["0.6", "0.7", "1.0", "12.34"] do
      response = get(conn, "/paperlang/#{line}")
      assert redirected_to(response, 302) == "https://paperland.sg/paperlang/#{line}.js"
      assert get_resp_header(response, "cache-control") == ["public, max-age=60"]
    end
  end

  test "query parameters cannot override the version or redirect host", %{conn: conn} do
    conn = get(conn, "/paperlang/0.6?version=latest&url=https://example.org")
    assert redirected_to(conn, 302) == "https://paperland.sg/paperlang/0.6.js"
  end

  test "HEAD preserves pointer headers without a response body", %{conn: conn} do
    conn = head(conn, ~p"/paperlang/0.6")
    assert redirected_to(conn, 302) == "https://paperland.sg/paperlang/0.6.js"
    assert response(conn, 302) == ""
    assert get_resp_header(conn, "access-control-allow-origin") == ["*"]
  end

  test "OPTIONS advertises public read-only access", %{conn: conn} do
    conn =
      conn
      |> put_req_header("origin", "https://example.org")
      |> put_req_header("access-control-request-method", "GET")
      |> options(~p"/paperlang/0.6")

    assert response(conn, 204) == ""
    assert get_resp_header(conn, "access-control-allow-origin") == ["*"]
    assert get_resp_header(conn, "access-control-allow-methods") == ["GET, HEAD, OPTIONS"]
    assert get_resp_header(conn, "access-control-max-age") == ["600"]
    assert get_resp_header(conn, "location") == []
    assert get_resp_header(conn, "set-cookie") == []
  end

  test "non-pointer versions are rejected rather than becoming CDN paths", %{conn: conn} do
    for version <- ["0", "0.6.0", "00.6", "0.06", "0.6-beta", "LATEST", "0.6@evil", "^0.6"] do
      response = get(conn, "/paperlang/#{version}")
      assert response(response, 404) == "Unknown PaperLang version pointer\n"
      assert get_resp_header(response, "cache-control") == ["no-store"]
      assert get_resp_header(response, "access-control-allow-origin") == ["*"]
      assert get_resp_header(response, "location") == []
    end
  end

  test "invalid preflight cannot turn a rejected selector into a pointer", %{conn: conn} do
    conn = options(conn, ~p"/paperlang/0.6.0")
    assert response(conn, 404) == "Unknown PaperLang version pointer\n"
    assert get_resp_header(conn, "cache-control") == ["no-store"]
    assert get_resp_header(conn, "location") == []
  end
end
