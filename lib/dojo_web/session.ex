defmodule DojoWeb.Session do
  import Phoenix.Component, only: [assign: 2]
  import Phoenix.LiveView, only: [get_connect_params: 1]

  @derive Jason.Encoder
  defstruct name: nil, id: nil, active: false, last_opened: DateTime.now!("Etc/UTC")

  @default_locale "en"
  @timezone "UTC"
  @timezone_offset 0

  def on_mount(:anon, params, _sessions, socket) do
    # get_connect_params returns nil on the first (static rendering) mount call, and has the added connect params from the js LiveSocket creation on the subsequent (LiveSocket) call
    # locale to langcode
    locale = get_connect_params(socket)["locale"] || @default_locale
    lang_code = String.split(locale, "-") |> List.first()
    Gettext.put_locale(DojoWeb.Gettext, lang_code)

    {:cont,
     socket
     |> assign(
       locale: get_connect_params(socket)["locale"] || @default_locale,
       tz: %{
         timezone: get_connect_params(socket)["timezone"] || @timezone,
         timezone_offset: get_connect_params(socket)["timezone_offset"] || @timezone_offset
       },
       session: get_connect_params(socket)["session"] |> mutate_session(params)
     )}
  end

  # careful of client and server state race. id here is not SOT
  defp mutate_session(%{"active" => true} = sess, _) do
    atomised_sess =
      for {key, val} <- sess, reduce: %{} do
        acc -> hydrate_session(acc, key, val)
      end

    struct(%__MODULE__{}, atomised_sess)
  end

  # false first load
  defp mutate_session(_, _), do: %__MODULE__{}

  defp hydrate_session(acc, key, val) when key in ["name", "id", "active", "last_opened"] do
    put_in(acc, [String.to_existing_atom(key)], val)
  end

  defp hydrate_session(acc, _key, _val), do: acc
end
