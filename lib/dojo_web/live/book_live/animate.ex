defmodule DojoWeb.Animate do
  use DojoWeb, :live_component

  def mount(socket) do
  {:ok, socket}
  end

  # already running
  def update(%{id: id, name: name}, %{assigns: %{running: run}} = socket) do
    {:ok, socket}
  end
  # init clause
  def update(%{id: id, class_id: class_id, name: name}, socket) do
    list = case Dojo.Class.last_animate(class_id) do
    {m,f,a} -> apply(m, f, a)
    _ ->
    "1"
    |> Dojo.World.create()

    end

    |> Dojo.World.print(list: true)
    |> Enum.map(&DojoWeb.Utils.DOMParser.extract_html_from_md(&1))

    # |> DojoWeb.Utils.DOMParser.extract_html_from_md()

    {:ok,
     assign(socket,
       start: 1,
        end: length(list),
       id: id,
       class_id: class_id,
       name: name,
       step: 1,
       function: fn index -> Enum.at(list, index) end,
       speed_multiplier: 1,
       running: false
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

  def update(%{function: {m, f, arg}}, %{assigns: %{running: true}} = socket) do
    list =
      apply(m, f, arg)
      |> Dojo.World.print(list: true)
      |> Enum.map(&DojoWeb.Utils.DOMParser.extract_html_from_md(&1))

    {:ok, assign(socket, end: length(list), function: fn index -> Enum.at(list, index) end)}
  end

  def update(%{id: _id, function: {m, f, arg}}, %{assigns: %{running: false}} = socket) do
    list =
      apply(m, f, arg)
      |> Dojo.World.print(list: true)
      |> Enum.map(&DojoWeb.Utils.DOMParser.extract_html_from_md(&1))

    {:ok,
     assign(socket, end: length(list), function: fn index -> Enum.at(list, index) end)
     |> increment_step()}
  end

  def render(assigns) do
    ~H"""
    <div id={@id <> "smart-animation"} class="">
      <div class="flex justify-between my-2">
        <div class="text-2xl font-bold"><%= @name %></div>
        <div class="flex">
          step:<div class="ml-1 font-bold"><%= @step %></div>
        </div>
      </div>
      <div class="px-1 py-2 overflow-x-auto bg-white rounded">
        <%= @function.(@step - 1) %>
      </div>
      <section class="flex justify-between p-2 font-medium text-gray-600 rounded-md bg-orange-100/50">
        <span class="hover:text-black hover:cursor-pointer">Reset</span>
        <div>
          <.icon name="hero-arrow-left-solid" class="hover:text-black hover:cursor-pointer" />
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
          <.icon name="hero-arrow-right-solid" class=" hover:text-black hover:cursor-pointer" />
        </div>
        <span class="px-4 hover:text-black hover:cursor-pointer">
          <%= "#{@speed_multiplier}x" %>
        </span>
      </section>
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

  def handle_event("previous", _, socket) do
    {:noreply, socket |> decrement_step()}
  end

  def handle_event("toggle_speed", _, socket) do
    speed = socket.assigns.speed_multiplier + 0.5
    next_multiplier = if speed > 10, do: 0.5, else: speed
    {:noreply, assign(socket, speed_multiplier: next_multiplier)}
  end

  defp increment_step(socket) do
    incremented_step =
      if socket.assigns.end && socket.assigns.step >= socket.assigns.end,
        do: socket.assigns.start,
        else: socket.assigns.step + 1

    assign(socket, step: incremented_step)
  end

  defp decrement_step(socket) do
    decremented_step =
      if socket.assigns.step <= socket.assigns.start,
        do: socket.assigns.end || socket.assigns.start,
        else: socket.assigns.step - 1

    assign(socket, step: decremented_step)
  end

  defp act(action, time, id) do
    Process.send_after(self(), {DojoWeb.Animate, action, id}, time)
  end
end
