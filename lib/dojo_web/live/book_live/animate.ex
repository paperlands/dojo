defmodule DojoWeb.Animate do
  use DojoWeb, :live_component

  def mount(p, a, %{assigns: assigns} = socket) do
    IO.inspect(p, label: "p")
    IO.inspect(a, label: "a")
    {:ok, assign(socket, start: 1, finish: nil, speed_multiplier: 1, running: false)}
  end

  def update(%{name: name}, socket) do
    {:ok, assign(socket, start: 1, name: name, function: fn index -> Enum.at([1, 2, 3], index) end, finish: nil, speed_multiplier: 1, running: false)}
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
    IO.inspect(assigns, label: "render")
    ~H"""
    <div id="smart-animation" >
    <%= @name %>
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
    {:noreply, assign(socket, running: true)}
  end

  def handle_event("pause", _, socket) do
    {:noreply, assign(socket, running: false)}
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
end
