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
    #

    dis =
      Dojo.Gate.list_users("class:book1")
      |> Enum.into(%{}, fn %{name: name} = dis -> {name, dis} end)

    IO.inspect(socket.assigns.session)
    {:ok,
     socket
     |> assign(label: nil, sensei: true, disciples: dis)
     |> assign(focused_phx_ref: "")
     |> sync_session()
    }
  end

  defp sync_session(%{assigns: %{session: %Session{name: name} = sess}} = socket) when is_binary(name) do
    {:ok, class} = Dojo.Class.join(self(), "book1", %Dojo.Disciple{name: name, action: "active"})
    socket
    |> push_event("initSession", sess)
  end

  defp sync_session(socket) do
    socket
  end

  def handle_info(
        {:join, "class:book1", %{name: name} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    IO.inspect(disciple, label: "join")

    {:noreply,
     socket
     |> assign(:disciples, Map.put(d, name, disciple))}
  end

  def handle_info(
        {:leave, "class:book1", %{name: name, phx_ref: ref} = disciple},
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

  def handle_event(
        "name",
        %{"name" => name}, %{assigns: %{session: sess}} = socket) do
    {:noreply,
     socket
     |> assign(session: %{sess | name: name})
     |> sync_session()}
  end

  def handle_event(
        "keyboard",
        %{"ctrlKey" => true, "key" => ","},
        %{assigns: %{sensei: _bool}} = socket
      ) do
    {:noreply, assign(socket, sensei: !socket.assigns.sensei)}
  end

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
    end

  def render(assigns) do
    ~H"""
    <div class="min-h-screen overflow-hidden relative bg-black">
    <!-- Canvas background -->
    <canvas phx-update="ignore" id="canvas" class="fixed top-0 left-0 w-full h-full bg-inherit z-2"></canvas>

    <!-- Left Coder pane container -->
    <div class="min-h-screen absolute top-0 left-0 h-auto w-auto p-4" >
    <!-- Session -->
      <div :if={@session.active} id="sessionbox" class="mb-4 text-xs font-mono text-brand" phx-hook="Box">
      <div :if={!@session.name} >
        <span class="block">&gt; enter the shell</span>
        <span class="block">&gt; your name:</span>
        <form class="flex items-center" id="name" phx-submit="name" >
        <span class="-mr-2 transition-opacity animate-pulse duration-700 mr-2">&gt;</span>
        <input value={@session.name} name="name"  type="text" class="bg-transparent text-xs border-none outline-none  caret-current border-transparent focus:border-transparent focus:ring-0 flex-grow" autoFocus/>
      </form>
      </div>
        <span :if={@session.name} class="block">&gt; welcome to the shell, <%= @session.name%> </span>
      </div>

    <!-- Editor -->
    <div phx-update="ignore" id="runenv" class="mb-4 cursor-text">
    <div class="z-20 relative">
    <input id="slider" type="range"
           min="-30"
           max="30"
           step="0.1"
           value="1"
           class="absolute hidden slider appearance-none stroke-transparent w-1/2 h-1 bg-transparent rounded-lg cursor-pointer" />
</div>
    <textarea id="editor" phx-hook="Shell"
    class="bg-transparent text-white font-mono border border-gray-300
    focus:border-blue-500 transition-colors duration-300 ease-in-out p-2"></textarea>

    </div>

    <!-- Output -->
    <div phx-update="ignore" id="output"
      class="absolute bottom-4 left-4 w-80 h-[20vh] text-white font-mono border-none
      overflow-y-auto p-2">
      </div>
     </div>
 </div>
 <div class="z-10 bottom-10 flex justify-center items-center backdrop-blur-lg bg-opacity-70 opacity-70 bg-brand rounded-2xl shadow-lg absolute left-1/2 -translate-x-1/2 z-100 w-1/2 h-12  lg:h-18 p-4 md:p-6 lg:p-8">
    <div class="flex flex-wrap gap-[-20px] md:gap-0">
        <div :for={{name, dis} <- @disciples |> Enum.sort_by(&elem(&1, 1).online_at, :desc)} class={"flex-1 w-full sm:w-1/4 md:w-1/4 lg:w-1/8 z-5 p-5 rounded-lg transition duration-200 ease-in-out shadow  hover:border-blue-500" <> is_main_focus(dis.phx_ref, @focused_phx_ref)}>
        <.icon :if={@sensei} class="fill-current text-brand" name="hero-cursor-arrow-ripple"
           phx-click="toggle-focus"
           phx-value-disciple-phx_ref={dis.phx_ref} class="cursor-pointer"
           />
            <canvas class="w-full h-auto overflow-hidden object-cover border-2 border-white rounded-md transition-transform duration-200 transform hover:-translate-y-2 md:hover:-translate-y-8"></canvas>
        </div>
    </div>
</div>
<style>
  /* Custom styles for editor width */
  #editor, #output {
    width: 80ch; /* 80 characters width */
  }
</style>


    <script src="codemirror/codemirror.js"></script>
    <link rel="stylesheet" href="codemirror/codemirror.css">
    <link rel="stylesheet" href="codemirror/theme/abbott.css">
    <script src="codemirror/mode/apl/apl.js"></script>
    """
  end

  defp is_main_focus(phx_ref, focused_phx_ref) do
    case phx_ref do
      ^focused_phx_ref -> " scale-150 border-blue-600"
      _ -> " border-brand"
    end
  end
end
