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
  @supported_locales ~w(en ms ar es ko zh)
  @rtl_locales ~w(ar he fa ur)
  @timezone "UTC"
  @timezone_offset 0

  def supported_locales, do: @supported_locales
  def rtl?(locale), do: locale in @rtl_locales
  def dir(locale), do: if(rtl?(locale), do: "rtl", else: "ltr")

  @doc """
  The person key until authentication exists (id:ki-mint).

  It is the session UUID — never derived from the display name, never rotated
  on rename. BootLive keeps a good existing id; hydrate repairs a missing or
  garbage id and pushes the repair to the client.
  (specs/weave/keep-author.org; amends D007.)
  """
  @spec author_id(%__MODULE__{}) :: String.t()
  def author_id(%__MODULE__{id: id}) when is_binary(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> uuid
    end
  end

  @doc """
  Keep a good UUID; mint when missing or garbage (id:ki-mint).

  Used by BootLive login and by hydrate of an already-active session.
  """
  @spec ensure_author_id(%__MODULE__{}) :: {%__MODULE__{}, :kept | :repaired}
  def ensure_author_id(%__MODULE__{id: id} = session) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {%{session | id: uuid}, :kept}
      :error -> {%{session | id: Ecto.UUID.generate()}, :repaired}
    end
  end

  def on_mount(:anon, params, _sessions, socket) do
    connect_params = get_connect_params(socket)
    {session, repair} = connect_params["session"] |> mutate_session(params)

    locale =
      get_in(session.settings, ["locale"]) ||
        connect_params["locale"] ||
        @default_locale

    lang_code = locale |> String.split("-") |> List.first()
    Gettext.put_locale(DojoWeb.Gettext, lang_code)

    socket =
      socket
      |> assign(
        locale: lang_code,
        tz: %{
          timezone: connect_params["timezone"] || @timezone,
          timezone_offset: connect_params["timezone_offset"] || @timezone_offset
        },
        session: session
      )

    socket =
      if repair == :repaired do
        push_event(socket, "mutateSession", %{id: session.id})
      else
        socket
      end

    {:cont, socket}
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

  def apply_setting(socket, :name, name) when is_binary(name) do
    session = socket.assigns.session
    updated = %{session | name: name}

    socket
    |> assign(session: updated)
    |> push_event("mutateSession", %{name: name})
  end

  def apply_setting(socket, _, _) do
    socket
  end

  # ── Session Hydration ─────────────────────────────────────────────────

  # careful of client and server state race. id is the person key (id:ki-mint).
  defp mutate_session(%{"active" => true} = sess, _) do
    atomised_sess =
      for {key, val} <- sess, reduce: %{} do
        acc -> hydrate_session(acc, key, val)
      end

    struct(%__MODULE__{}, atomised_sess) |> ensure_author_id()
  end

  # false first load — no person key yet; BootLive mints at login.
  defp mutate_session(_, _), do: {%__MODULE__{}, :kept}

  defp hydrate_session(acc, key, val) when key in ["name", "id", "active", "last_opened"] do
    put_in(acc, [String.to_existing_atom(key)], val)
  end

  defp hydrate_session(acc, "settings", val) when is_map(val) do
    Map.put(acc, :settings, val)
  end

  defp hydrate_session(acc, _key, _val), do: acc
end
