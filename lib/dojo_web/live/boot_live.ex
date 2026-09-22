defmodule DojoWeb.BootLive do
  use DojoWeb, :live_shell
  # import DojoWeb.SVGComponents

  def mount(params, _session, socket) do
    {:ok,
     socket
     |> assign(:params, params)
     |> boot(3600)}
  end

  def boot(socket, time \\ 200)

  def boot(%{assigns: %{session: %DojoWeb.Session{name: name}}} = socket, time)
      when is_binary(name) do
    Process.send_after(self(), :boot, time)
    socket
  end

  def boot(socket, _time) do
    socket
  end

  def handle_info(:boot, %{assigns: %{params: params}} = socket) do
    {:noreply,
     socket
     |> redirect(to: ~p"/shell?#{params}")}
  end

  def handle_event(
        "login",
        %{"username" => name},
        %{assigns: %{session: sess}} = socket
      )
      when is_binary(name) do
    # Person key is the session UUID (id:ki-mint). Keep a good existing id;
    # mint only when missing or garbage. Never rotate on rename.
    {with_id, _} = DojoWeb.Session.ensure_author_id(sess)
    login_sess = %{with_id | name: name, active: true}

    {:noreply,
     socket
     |> assign(:session, login_sess)
     |> push_event("initSession", login_sess)
     |> boot()}
  end
end
