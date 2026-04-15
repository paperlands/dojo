defmodule DojoWeb.Session do
  import Phoenix.Component, only: [assign: 2]
  import Phoenix.LiveView, only: [get_connect_params: 1, push_event: 3]

  @derive Jason.Encoder
  defstruct name: nil,
            id: nil,
            active: false,
            last_opened: DateTime.now!("Etc/UTC"),
            settings: %{}

  @default_locale "en"
  @supported_locales ~w(en ar ko zh)
  @timezone "UTC"
  @timezone_offset 0

  def supported_locales, do: @supported_locales

  def on_mount(:anon, params, _sessions, socket) do
    connect_params = get_connect_params(socket)
    session = connect_params["session"] |> mutate_session(params)

    locale =
      get_in(session.settings, ["locale"]) ||
        connect_params["locale"] ||
        @default_locale

    lang_code = locale |> String.split("-") |> List.first()
    Gettext.put_locale(DojoWeb.Gettext, lang_code)

    {:cont,
     socket
     |> assign(
       locale: lang_code,
       tz: %{
         timezone: connect_params["timezone"] || @timezone,
         timezone_offset: connect_params["timezone_offset"] || @timezone_offset
       },
       session: session
     )}
  end

  # ── Locale-aware gettext ──────────────────────────────────────────────
  # Referencing @locale in templates creates a change-tracking dependency,
  # so LiveView re-evaluates these expressions when the locale assign changes.
  # The actual translation reads from the process dictionary (set by put_locale).

  def t(_locale, msgid) do
    Gettext.gettext(DojoWeb.Gettext, msgid)
  end

  def t(_locale, msgid, bindings) do
    Gettext.gettext(DojoWeb.Gettext, msgid, bindings)
  end

  # ── Settings API ──────────────────────────────────────────────────────

  def apply_setting(socket, :locale, locale) when locale in @supported_locales do
    Gettext.put_locale(DojoWeb.Gettext, locale)
    session = socket.assigns.session
    updated = %{session | settings: Map.put(session.settings, "locale", locale)}

    socket
    |> assign(session: updated, locale: locale)
    |> push_event("mutateSession", %{settings: %{locale: locale}})
  end

  # ── Session Hydration ─────────────────────────────────────────────────

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

  defp hydrate_session(acc, "settings", val) when is_map(val) do
    Map.put(acc, :settings, val)
  end

  defp hydrate_session(acc, _key, _val), do: acc
end
