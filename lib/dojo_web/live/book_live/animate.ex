defmodule DojoWeb.Animate do
  use DojoWeb, :live_component


  def update(%{id: id, name: name}, socket) do
    {:ok, assign(socket, start: 1, id: id, name: name, step: 0, function: fn index -> Enum.at([1, 2, 3], index) end, finish: nil, speed_multiplier: 1, running: false)}
  end

  def update(%{id: id, action: :inc}, socket) do
    if socket.assigns.running do
      speed = round(1000 / socket.assigns.speed_multiplier)
      act(:inc, speed, socket.assigns.id)
      {:ok, socket |> increment_step()}
    else
      {:ok, socket}
    end
  end

  # def update(%{assigns: %{list: list}} = socket) do
  #   IO.inspect(socket, label: "update")
  #   {:ok, assign(socket, start: 1, function: fn index -> Enum.at(list, index) end, finish: nil, speed_multiplier: 1, running: false)}
  # end

  # def update(%{assigns: assigns} = socket) do
  #   IO.inspect(socket, label: "update")
  #   {:ok, socket}
  # end



  def render(assigns) do
    ~H"""
    <div id="smart-animation" >
    <%= @step %>
    <section class="p-4 bg-orange-100/20 rounded-md font-medium text-gray-600 flex justify-center items-center w-full">
    <span id="reset" class="px-2 hover:text-black hover:cursor-pointer">Reset</span>
    <.icon  name="hero-arrow-left-solid" class="hover:text-black hover:cursor-pointer"/>
    <a href="#" phx-click="play" phx-target={@myself}>
    <.icon :if={@running == false}  name="hero-play-solid" class=" hover:text-black hover:cursor-pointer"/>
    </a>
    <a href="#" phx-click="pause" phx-target={@myself}>
    <.icon :if={@running == true}  name="hero-stop-solid" class=" hover:text-black hover:cursor-pointer"/>
    </a>
    <.icon  name="hero-arrow-right-solid" class=" hover:text-black hover:cursor-pointer"/>
    <span id="speed_multiplier" class="px-4 hover:text-black hover:cursor-pointer">
        <%= "#{@speed_multiplier} x" %>
    </span>
    </section>
      <!-- UI elements will be defined here -->
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

  def handle_info(:increment, socket) do

  end

  def handle_event("reset", _, socket) do
    {:noreply, assign(socket, step: 1, speed_multiplier: 1, running: false)}
  end

  def handle_event("next", _, socket) do
    {:noreply, assign(socket, step: socket.assigns.step + 1)}
  end

  def handle_event("previous", _, socket) do
    {:noreply, assign(socket, step: socket.assigns.step - 1)}
  end

  def handle_event("toggle_speed", _, socket) do
    speed = socket.assigns.speed_multiplier + 0.5
    next_multiplier = if speed > 10, do: 0.5, else: speed
    {:noreply, assign(socket, speed_multiplier: next_multiplier)}
  end

  defp increment_step(socket) do
    incremented_step =
      if socket.assigns.finish && socket.assigns.step >= socket.assigns.finish,
        do: socket.assigns.start,
        else: socket.assigns.step + 1

    assign(socket, step: incremented_step)
  end

  defp decrement_step(socket) do
    decremented_step =
      if socket.assigns.step <= socket.assigns.start,
        do: socket.assigns.finish || socket.assigns.start,
        else: socket.assigns.step - 1

    assign(socket, step: decremented_step)
  end

  defp act(action, time, id) do
    Process.send_after(self(), {DojoWeb.Animate, action, id}, time)
  end
end
