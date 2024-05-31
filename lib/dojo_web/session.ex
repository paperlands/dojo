defmodule DojoWeb.Session do
  import Phoenix.Component, only: [assign: 2]
  import Phoenix.LiveView, only: [get_connect_params: 1]

  @default_locale "en"
  @timezone "UTC"
  @timezone_offset 0

  def on_mount(:anon, _params, _sessions, socket) do
    # get_connect_params returns nil on the first (static rendering) mount call, and has the added connect params from the js LiveSocket creation on the subsequent (LiveSocket) call
    {:cont,
     socket
     |> assign(
     locale: get_connect_params(socket)["locale"] || @default_locale,
     tz: %{timezone: get_connect_params(socket)["timezone"] || @timezone,
           timezone_offset: get_connect_params(socket)["timezone_offset"] || @timezone_offset},
     session: get_connect_params(socket)["session"] |> mutate_session()
     )}
  end

  def on_mount(:sangh, _params, _sessions, socket) do
    # get_connect_params returns nil on the first (static rendering) mount call, and has the added connect params from the js LiveSocket creation on the subsequent (LiveSocket) call
    {:cont,
     socket
     |> assign(
     locale: get_connect_params(socket)["locale"] || @default_locale,
     tz: %{timezone: get_connect_params(socket)["timezone"] || @timezone,
           timezone_offset: get_connect_params(socket)["timezone_offset"] || @timezone_offset},
     session: get_connect_params(socket)["session"] |> mutate_session()
     )}
  end

  defp mutate_session(%{"id" => id} = sess) when is_binary(id), do: sess
  defp mutate_session(%{"active" => true}), do: %{"id" => :crypto.strong_rand_bytes(18) |> :base64.encode()}
  defp mutate_session(%{}), do: %{"id" => :crypto.strong_rand_bytes(18) |> :base64.encode()}
  defp mutate_session(_), do: %{"active" => false}
  end
