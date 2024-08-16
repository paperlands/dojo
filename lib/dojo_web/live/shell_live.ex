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

    IO.inspect(dis)

    {:ok,
     socket
     |> assign(label: nil, sensei: false, class: nil, disciples: dis)
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
    IO.inspect(disciple, label: "join")

    {:noreply,
     socket
     |> assign(:disciples, Map.put(d, name, disciple))}
  end

  def handle_info(
        {:leave, "class:shell", %{name: name, phx_ref: ref} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    IO.inspect(disciple, label: "leave")

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

  def handle_info(
        {Dojo.PubSub, :hatch, {name, {Dojo.Turtle, img}}},
        %{assigns: %{disciples: dis}} = socket
      ) do
    {:noreply,
     socket
     |> assign(disciples: put_in(dis, [name, :meta], img))}
  end

  def handle_event(
        "hatchTurtle",
        %{"commands" => _command, "path" => img},
        %{assigns: %{class: class}} = socket
      ) do
    Dojo.Turtle.hatch(img, %{class: class})
    {:noreply, socket}
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

  def render(assigns) do
    ~H"""
    <div class="relative min-h-screen overflow-hidden bg-black">
      <!-- Canvas background -->
      <canvas phx-update="ignore" id="canvas" class="fixed top-0 left-0 w-full h-full bg-inherit z-2">
      </canvas>
      <!-- Left Coder pane container -->
      <div class="absolute top-0 left-0 w-auto h-auto min-h-screen p-4">
        <!-- Session -->
        <div
          :if={@session.active}
          id="sessionbox"
          class="mb-4 font-mono text-xs text-brand"
          phx-hook="Box"
        >
          <div :if={!@session.name}>
            <span class="block">&gt; enter the shell</span>
            <span class="block">&gt; your name:</span>
            <form class="flex items-center" id="name" phx-submit="name">
              <span class="mr-2 -mr-2 transition-opacity duration-700 animate-pulse">&gt;</span>
              <input
                value={@session.name}
                name="name"
                type="text"
                class="flex-grow text-xs bg-transparent border-transparent border-none outline-none caret-current focus:border-transparent focus:ring-0"
                autoFocus
              />
            </form>
          </div>
          <span :if={@session.name} class="block">
            &gt; welcome to the shell, <%= @session.name %>
          </span>
        </div>
        <!-- Editor -->
        <div phx-update="ignore" id="runenv" class="mb-4 cursor-text">
          <div class="relative z-20">
            <input
              id="slider"
              type="range"
              min="-30"
              max="30"
              step="0.1"
              value="1"
              class="absolute hidden w-1/2 h-1 bg-transparent rounded-lg appearance-none cursor-pointer slider stroke-transparent"
            />
          </div>
          <textarea
            id="editor"
            phx-hook="Shell"
            class="p-2 font-mono text-white transition-colors duration-300 ease-in-out bg-transparent border border-gray-300 focus:border-blue-500"
          ></textarea>
        </div>
        <!-- Output -->
        <div
          phx-update="ignore"
          id="output"
          class="absolute bottom-4 left-4 w-80 h-[20vh] text-white font-mono border-none
      overflow-y-auto p-2"
        >
        </div>
      </div>
    </div>
    <div class="absolute z-10 flex items-center justify-center w-1/2 h-12 p-4 -translate-x-1/2 shadow-lg bottom-10 backdrop-blur-lg bg-opacity-70 opacity-70 bg-brand rounded-2xl left-1/2 z-100 lg:h-18 md:p-6 lg:p-8">
      <div class="flex flex-wrap gap-[-20px] md:gap-0">
        <div
          :for={{name, dis} <- @disciples |> Enum.sort_by(&elem(&1, 1).online_at, :desc)}
          :if={Map.has_key?(dis, :meta)}
          class={"flex-1 w-full sm:w-1/4 md:w-1/4 lg:w-1/8 z-5 p-5 rounded-lg transition duration-200 ease-in-out shadow  hover:border-blue-500" <> is_main_focus(dis.phx_ref, @focused_phx_ref)}
        >
          <.icon
            :if={@sensei}
            name="hero-cursor-arrow-ripple"
            phx-click="toggle-focus"
            phx-value-disciple-phx_ref={dis.phx_ref}
            class="cursor-pointer text-brand"
          />
          <img
            src={dis.meta}
            class="object-cover w-full h-auto overflow-hidden transition-transform duration-200 transform border-2 border-white rounded-md hover:-translate-y-2 md:hover:-translate-y-8"
          />
        </div>
      </div>
    </div>
    <style>
      /* Custom styles for editor width */
      #editor, #output {
      width: 80ch; /* 80 characters width */
      }
    </style>

    <script src="codemirror/codemirror.js">
    </script>
    <link rel="stylesheet" href="codemirror/codemirror.css" />
    <link rel="stylesheet" href="codemirror/theme/abbott.css" />
    <script src="codemirror/mode/apl/apl.js">
    </script>
    """
  end

  defp is_main_focus(phx_ref, focused_phx_ref) do
    case phx_ref do
      ^focused_phx_ref -> " scale-150 border-blue-600"
      _ -> " border-brand"
    end
  end
end
