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

    grid_map = for i <- 1..3, j <- 1..3, into: %{}, do: {"#{i}#{j}", false}

    {:ok,
     socket
     |> assign(label: nil, running: false, task_ref: nil, disciples: dis)
     |> assign(grid_map: grid_map)}
  end

  defp kernel(assigns) do
    ~H"""
    <div
      id={@id}
      class="inline-flex p-4 bg-white border-2 border-gray-200 border-dashed rounded-lg cursor-pointer"
      phx-hook="ImageInput"
      data-height={@height}
      data-width={@width}
    >
      <input id={"#{@id}-input"} type="file" class="hidden" />
      <div class="flex items-center justify-center p-8" id={"#{@id}-preview"}>
        <%!-- input grid_map --%>
        <div class="text-center text-gray-500">
          <div class="">
            <%= for i <- 1..3 do %>
              <div class="flex justify-evenly">
                <%= for j <- 1..3 do %>
                  <div
                    class={"w-24 h-24 outline rounded hover:bg-slate-700 #{check_cell_status(@grid_map, i * 10 + j)}"}
                    phx-click="cell-click"
                    phx-value-cell-value={i * 10 + j}
                  >
                  </div>
                <% end %>
              </div>
            <% end %>
          </div>
          <br /> Construct a simple 3x3 starting grid
        </div>
      </div>
    </div>
    """
  end

  defp check_cell_status(grid_map, cell_value) do
    case grid_map[Integer.to_string(cell_value)] do
      true ->
        "bg-slate-800"

      false ->
        ""
    end
  end

  def handle_event("cell-click", %{"cell-value" => cell_value}, socket) do
    grid_map = socket.assigns.grid_map
    updated_grid_map = Map.replace(grid_map, cell_value, !Map.get(grid_map, cell_value))
    socket = assign(socket, grid_map: updated_grid_map)

    # TODO: send message to self

    {:noreply, socket}
  end

  # send_update for animate component

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
    send_update(DojoWeb.Animate, id: id, action: action)
    {:noreply, socket}
  end

  def handle_info({ref, result}, %{assigns: %{task_ref: ref}} = socket) do
    Process.demonitor(ref, [:flush])
    %{predictions: [%{label: label}]} = result
    {:noreply, assign(socket, label: label, running: false)}
  end
end
