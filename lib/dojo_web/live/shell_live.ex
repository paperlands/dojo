defmodule DojoWeb.ShellLive do
  use DojoWeb, :live_shell
  alias DojoWeb.Session

  @moduledoc """
  This LV module defines the Turtling Experience

  we break apart the problem as follows:

  turtle bridge
  turtle <--> turtle  <--- editor
    |            |
    |            |
    v            v
  [canvas]     [canvas]
  """

  def mount(_params, _session, socket) do
    Dojo.Class.listen("shell")

    dis =
      Dojo.Gate.list_users("class:shell")
      |> Enum.into(%{}, fn %{name: name} = dis -> {name, dis} end)

    {:ok,
     socket
     |> assign(label: nil, outershell: nil, sensei: false, myfunctions: [], outerfunctions: [], class: nil, disciples: dis)
     |> assign(focused_phx_ref: "")
     |> sync_session()}
  end

  defp sync_session(%{assigns: %{session: %Session{name: name} = sess}} = socket)
       when is_binary(name) do
    {:ok, class} = Dojo.Class.join(self(), "shell", %Dojo.Disciple{name: name, action: "active"})

    socket
    |> assign(:class, class)
    |> push_event("initSession", sess)
  end

  defp sync_session(socket) do
    socket
  end

  def handle_info(
        {:join, "class:shell", %{name: name} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do

    {:noreply,
     socket
     |> assign(:disciples, Map.put(d, name, disciple))}
  end

  def handle_info(
        {:leave, "class:shell", %{name: name, phx_ref: ref} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do

    if d[name][:phx_ref] == ref do
      {:noreply,
       socket
       |> assign(:disciples, Map.delete(d, name))}
    else
      {:noreply, socket}
    end
  end

  def handle_info({Dojo.PubSub, :focused_phx_ref, {focused_phx_ref}}, socket) do
    {:noreply,
     socket
     |> assign(focused_phx_ref: focused_phx_ref)}
  end

  def handle_info({Dojo.PubSub, :hatch, {name, {Dojo.Turtle, meta}}}, %{assigns: %{disciples: dis}} = socket) do
    active_dis= if Map.has_key?(dis, name) do
      put_in(dis, [name, :meta], meta)
    else
      dis
    end

    {:noreply,
     socket
     |> assign(disciples: active_dis)}
  end

  def handle_event(
        "hatchTurtle",
        %{"commands" => commands, "path" => path},
        %{assigns: %{class: class}} = socket
      ) do
    Dojo.Turtle.hatch(%{path: path, commands: commands |> Enum.take(88)}, %{class: class})
    {:noreply, socket |> assign(myfunctions: commands |> Dojo.Turtle.filter_fns())}
  end


  def handle_event("seeTurtle", %{"addr" => addr, "function" => func}, %{assigns: %{disciples: dis}} = socket) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{ast: dis[addr][:meta][:commands] |> Dojo.Turtle.find_fn(func), addr: addr, mod: "lambda", name: func})
     |> assign(:outershell,
     %{
       addr: addr,
       resp: "drawing @#{addr}'s #{func}"
     })}
  end

  def handle_event("seeTurtle", %{"addr" => addr}, %{assigns: %{disciples: dis}} = socket) when is_binary(addr) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{ast: dis[addr][:meta][:commands], addr: addr, mod: "root"})
     |> assign(:outershell,
     %{
       addr: addr,
       outerfunctions: dis[addr][:meta][:commands] |> Dojo.Turtle.filter_fns(),
       resp: "summoning @#{addr}'s code ☄"
     })}
  end

  def handle_event("seeTurtle", %{"function" => func}, %{assigns: %{myfunctions: commands}} = socket) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{ast: commands |> Dojo.Turtle.find_fn(func), addr: "my", mod: "lambda", name: func})
     |> assign(:outershell,
     %{
       addr: "my",
       resp: "drawing your #{func}"
     })}
  end

  def handle_event("seeTurtle", _ , socket) do
    {:noreply,
     socket
     |> assign(:outershell,
       nil)}
  end


  def handle_event(
        "name",
        %{"name" => name},
        %{assigns: %{session: sess}} = socket
      ) do
    {:noreply,
     socket
     |> assign(session: %{sess | name: name})
     |> sync_session()}
  end

  def handle_event("opensenseime", _, %{assigns: %{sensei: bool}} = socket) do
    {:noreply, assign(socket, sensei: !bool)}
  end

  def handle_event(
        "toggle-focus",
        %{"disciple-phx_ref" => _phx_ref},
        %{assigns: %{sensei: false}} = socket
      ),
      do: {:noreply, socket}

  def handle_event(
        "toggle-focus",
        %{"disciple-phx_ref" => phx_ref},
        %{assigns: %{sensei: true}} = socket
      ) do
    old_phx_ref = socket.assigns.focused_phx_ref

    new_phx_ref =
      case old_phx_ref do
        "" -> phx_ref
        ^phx_ref -> ""
        _ -> phx_ref
      end

    Dojo.PubSub.publish({new_phx_ref}, :focused_phx_ref, "class:shell")

    # TODO: store focused_phx_ref in presence tracking so that new liveviews know which to focus on

    {:noreply,
     socket
     |> assign(focused_phx_ref: new_phx_ref)}
  end

  defp is_main_focus(phx_ref, focused_phx_ref) do
    case phx_ref do
      ^focused_phx_ref -> " scale-150"
      _ -> " border-brand"
    end
  end
end
