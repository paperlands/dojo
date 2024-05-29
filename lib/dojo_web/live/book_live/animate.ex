defmodule DojoWeb.Animate do
  use DojoWeb, :live_component

  def mount(socket) do
    {:ok, socket}
  end

  # already running
  def update(
        %{id: _id, name: _name, show_controls: show_controls},
        %{assigns: %{running: _run}} = socket
      ) do
    {:ok, socket |> assign(show_controls: show_controls)}
  end

  # init clause
  def update(%{id: id, class_id: class_id, name: name, show_controls: show_controls}, socket) do
    {list, source} =
      case Dojo.Class.last_animate(class_id) do
        {m, f, a} ->
          {apply(m, f, a), to_source({m,f,a})}
        _ ->
          {Dojo.World.create("1"), "Dojo.World.create(\"1\")"}

      end

    list = list
      |> Dojo.World.print(list: true)
      |> Enum.map(&DojoWeb.Utils.DOMParser.extract_html_from_md(&1))

    # |> DojoWeb.Utils.DOMParser.extract_html_from_md()

    {:ok,
     assign(socket,
       start: 1,
       last: length(list),
       id: id,
       class_id: class_id,
       name: name,
       source: source,
       step: 1,
       function: fn index -> Enum.at(list, index) end,
       speed_multiplier: 1,
       running: false,
       show_controls: show_controls
     )}
  end

  #
  def update(%{action: :inc}, socket) do
    if socket.assigns.running do
      speed = round(1000 / socket.assigns.speed_multiplier)
      act(:inc, speed, socket.assigns.id)
      {:ok, socket |> increment_step()}
    else
      {:ok, socket}
    end
  end

  def update(%{id: _id, function: {m, f, a}}, socket) do
    list =
      apply(m, f, a)
      |> Dojo.World.print(list: true)
      |> Enum.map(&DojoWeb.Utils.DOMParser.extract_html_from_md(&1))

    {:ok,
     assign(socket, last: length(list),
       source: to_source({m, f, a}),
       function: fn index -> Enum.at(list, index) end
     )
     |> increment_step_if_static()}
  end

  def update(%{id: _id, function: {list, {m,f,a}}}, socket) when is_list(list) do
    list =
      [
        safe: "<p>" <> Dojo.World.print(list, view: true) <> "</p>"
        # |> DojoWeb.Utils.DOMParser.extract_html_from_md() #! this DOMparser fn is faulty. Doesnt do <br> well
      ]

    {:ok, assign(socket, last: length(list), function: fn index -> Enum.at(list, index) end, source: to_source({m, f, a}))}
  end

  def render(assigns) do
    ~H"""
    <div id={@id <> "smart-animation"} class="">
      <div class="flex justify-between m-4">
        <div class="text-2xl font-bold"><%= @name %></div>
        <div class="flex">
          step:<div class="ml-1 font-bold"><%= @step %>/<%= @last %></div>
        </div>
      </div>
      <div class="px-1 py-2 overflow-auto text-sm bg-white rounded max-h-60">
        <%= @function.(@step - 1) %>
      </div>
      <section class={"flex justify-between p-2 font-medium text-gray-600 rounded-md bg-orange-100/40" <> show_controls(@show_controls)}>
        <span class="hover:text-black hover:cursor-pointer" phx-click="reset" phx-target={@myself} >Reset</span>
        <div>
          <.icon name="hero-arrow-left-solid" phx-click="prev" phx-target={@myself} class="hover:text-black hover:cursor-pointer" />
          <a href="#" phx-click="play" phx-target={@myself}>
            <.icon
              :if={@running == false}
              name="hero-play-solid"
              class=" hover:text-black hover:cursor-pointer"
            />
          </a>
          <a href="#" phx-click="pause" phx-target={@myself}>
            <.icon
              :if={@running == true}
              name="hero-stop-solid"
              class=" hover:text-black hover:cursor-pointer"
            />
          </a>
          <.icon name="hero-arrow-right-solid" phx-click="next" phx-target={@myself} class="hover:text-black hover:cursor-pointer" />
        </div>
        <span phx-click="gobrrr" phx-target={@myself} class="px-4 hover:text-black hover:cursor-pointer">
          <%= "#{@speed_multiplier}x" %>
        </span>
      </section>
      <div class={"py-1 rounded-lg"}/>
      <div class={"bg-black rounded-lg"}>
      <.icon name="hero-clipboard" class="w-3 h-3 ml-2 active:bg-brand active:animate-spin hover:cursor-copy" phx-click={JS.dispatch("dojo:yoink", to: "##{@id}-source")}/>
          <div id={@id <>"-source"} class="hidden"><%=@source%></div>
          <div class="px-8 overflow-x-auto">
          <%= [safe: Makeup.highlight(@source)] %>
       <div class="max-w-2xl w-full animate-pulse">
        <div class="flex-1 space-y-4">
          <div class="h-4"></div>
          <div class="bg-gray-500 h-4 rounded-lg"></div>
          <div class="bg-gray-500 h-4 rounded-lg w-5/6"></div>
        </div>
      </div>
          </div>
      </div>
    </div>
    """
  end

  def handle_event("play", _, socket) do
    act(:inc, 1000, socket.assigns.id)
    {:noreply, assign(socket, running: true)}
  end

  def handle_event("pause", _, socket) do
    {:noreply, assign(socket, running: false)}
  end

  def handle_event("reset", _, socket) do
    {:noreply, assign(socket, step: 1, speed_multiplier: 1, running: false)}
  end

  def handle_event("next", _, socket) do
    {:noreply, socket |> increment_step()}
  end

  def handle_event("prev", _, socket) do
    {:noreply, socket |> decrement_step()}
  end

  def handle_event("gobrrr", _, socket) do
    speed = socket.assigns.speed_multiplier + 0.5
    next_multiplier = if speed > 10, do: 0.5, else: speed
    {:noreply, assign(socket, speed_multiplier: next_multiplier)}
  end

  defp show_controls(bool) do
    case bool do
      true -> ""
      false -> " hidden"
    end
  end

  defp increment_step_if_static(%{assigns: %{running: false}} = socket) do
    incremented_step =
      if socket.assigns.last && socket.assigns.step >= socket.assigns.last,
        do: socket.assigns.start,
        else: socket.assigns.step + 1

    act(:inc, 1000, socket.assigns.id)

    assign(socket, step: incremented_step, running: true)
  end

  defp increment_step_if_static(socket) do
    socket
  end

  defp increment_step(socket) do
    incremented_step =
      if socket.assigns.last && socket.assigns.step >= socket.assigns.last,
        do: socket.assigns.start,
        else: socket.assigns.step + 1

    assign(socket, step: incremented_step)
  end

  defp decrement_step(socket) do
    decremented_step =
      if socket.assigns.step <= socket.assigns.start,
        do: socket.assigns.last || socket.assigns.start,
        else: socket.assigns.step - 1

    assign(socket, step: decremented_step)
  end

  defp act(action, time, id) do
    Process.send_after(self(), {DojoWeb.Animate, action, id}, time)
  end

  defp to_source({mod, fun, arity}) do
    args = arity |> Enum.map(&"#{inspect(&1)}")|> Enum.join(", ")
    "#{inspect(mod)}.#{fun}(#{args})"
  end

end
