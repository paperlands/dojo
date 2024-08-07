defmodule DojoWeb.ShellLive do
  use DojoWeb, :live_shell

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
    Dojo.Class.listen("book1")

    dis =
      Dojo.Gate.list_users("class:shell")
      |> Enum.into(%{}, fn %{name: name} = dis -> {name, dis} end)


    {:ok,
     socket
     |> assign(label: nil, running: false, task_ref: nil, disciples: dis)
     |> assign(focused_phx_ref: "")
     |> assign(show_controls: false)}
  end

  def render(assigns) do
    ~H"""
    <div class="min-h-screen overflow-hidden relative bg-black">
    <!-- Canvas background -->
    <canvas id="canvas" class="fixed top-0 left-0 w-full h-full bg-inherit z-2"></canvas>

    <!-- Left pane container -->
    <div class="absolute top-0 left-0 h-full w-auto p-4">
    <!-- Title -->
    <h1 class="text-2xl font-bold text-brand mb-4">
    Turtles All the Way Down
    </h1>

    <!-- Editor -->
    <div id="runenv" class="mb-4 cursor-text">
    <textarea id="editor" phx-hook="Shell"
    class="w-80 h-[60vh] bg-transparent text-white font-mono border border-gray-300
    focus:border-blue-500 transition-colors duration-300 ease-in-out p-2"></textarea>
    </div>

    <!-- Output -->
    <div id="output"
      class="absolute bottom-4 left-4 w-80 h-[30vh]  text-white font-mono border-none
      overflow-y-auto p-2">
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
end
