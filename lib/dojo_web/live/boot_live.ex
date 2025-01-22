defmodule DojoWeb.BootLive do
  use DojoWeb, :live_shell
  import DojoWeb.SVGComponents

  def mount(_params, _session, socket) do
    {:ok, socket |> boot(3600)}
  end

  def boot(%{assigns: %{session: %DojoWeb.Session{name: name} = sess}} = socket, time \\ 200) when is_binary(name) do
    Process.send_after(self(), :boot, time)
    socket
  end

  def boot(socket, time) do
    socket
  end


  def handle_info(:boot, socket) do
    {:noreply, socket
      |> redirect(to: ~p"/shell")
     }
  end

  def handle_event(
        "login",
        %{"username" => name},
        %{assigns: %{session: sess}} = socket
      ) when is_binary(name) do
    login_sess = %{sess | name: name}

    {:noreply,
     socket
     |> assign(:session, login_sess)
     |> push_event("initSession", login_sess)
     |> boot()
    }
  end
end
