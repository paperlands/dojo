defmodule DojoWeb.BookOneLive do
  use DojoWeb, :live_view

  @moduledoc """
  This LV module defines the Game of Life Experience
  """

  def mount(_params, _session, socket) do
    Dojo.Class.listen("book1")

    dis =
      Dojo.Gate.list_users("class:book1")
      |> Enum.into(%{}, fn %{name: name} = dis -> {name, dis} end)

    {:ok,
     socket
     |> assign(label: nil, running: false, task_ref: nil, disciples: dis)}
  end

  def render(assigns) do
    ~H"""
      <div class="flex flex-col items-center">
        <h1 class="text-brand font-extrabold text-3xl tracking-tight text-center"> Dojo Book 1</h1>
        <p class="mt-6 text-lg text-sky-600 text-center max-w-3xl mx-auto">
          Run your friends model!
        </p>
        <div class="flex flex-wrap justify-around p-4">
        <div :for={{name, dis} <- @disciples |> Enum.sort_by(&(elem(&1, 1).online_at), :desc)} class="w-64 h-64 text-white bg-brand border-2 border-custom shadow cursor-pointer hover:border-red-500 transition-colors duration-200 ease-in-out">
        <.live_component id="animate" name={name} module={DojoWeb.Animate} />
        </div>
        </div>
        <form class="m-0 flex flex-col items-center space-y-2 mt-8" phx-change="noop" phx-submit="noop">
          <.kernel  id="3x3grid" height={224} width={224} />
        </form>
      </div>
    """
  end

  defp kernel(assigns) do
    ~H"""
    <div
      id={@id}
      class="inline-flex p-4 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer bg-white"
      data-height={@height}
      data-width={@width}
    >
      <input id={"#{@id}-input"} type="file" class="hidden" />
      <div
        class="h-[300px] w-[300px] flex items-center justify-center"
        id={"#{@id}-preview"}
        phx-update="ignore"
      >
        <div class="text-gray-500 text-center">
         <div class="grid grid-cols-3 gap-4">
         <button :for={n <- 1..9} class="bg-ink/10 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded">‌‌‌‌ </button>
         </div>
         <br>
          Construct a simple 3x3 starting grid
        </div>
      </div>
    </div>
    """
  end

  #send_update for animate component

  def handle_info(
        {:join, "class:book1", %{name: name} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    {:noreply,
     socket
     |> assign(:disciples, Map.put(d, name, disciple))}
  end

  def handle_info(
        {:leave, "class:book1", %{name: name}},
        %{assigns: %{disciples: d}} = socket
      ) do
    {:noreply,
     socket
     |> assign(:disciples, Map.delete(d, name))}
  end

  def handle_info({DojoWeb.Animate, action, id}, socket) do
    send_update DojoWeb.Animate, id: id, action: action
    {:noreply, socket}
  end

  def handle_info({ref, result}, %{assigns: %{task_ref: ref}} = socket) do
    Process.demonitor(ref, [:flush])
    %{predictions: [%{label: label}]} = result
    {:noreply, assign(socket, label: label, running: false)}
  end
end
