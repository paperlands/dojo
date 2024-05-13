defmodule DojoWeb.BookOneLive do
  use DojoWeb, :live_view

  def mount(_params, _session, socket) do
    Dojo.Class.listen("book1")

    dis =
      Dojo.Gate.list_users("class:book1")
      |> Enum.into(%{}, fn %{name: name} = dis -> {name, dis} end)

    {:ok,
     socket
     |> assign(label: nil, running: false, task_ref: nil, disciples: dis)
     |> allow_upload(:image,
       accept: :any,
       max_entries: 1,
       max_file_size: 300_000,
       progress: &handle_progress/3,
       auto_upload: true
     )}
  end

  def render(assigns) do
    ~H"""
      <div class="flex flex-col items-center">
        <h1 class="text-brand font-extrabold text-3xl tracking-tight text-center"> Dojo Book 1</h1>
        <p class="mt-6 text-lg text-sky-600 text-center max-w-3xl mx-auto">
          Run your friends model!
        </p>
        <div class="flex flex-wrap justify-around p-4">
        <div :for={{name, dis} <- @disciples |> Enum.sort_by(&(elem(&1, 1).online_at), :desc)} class="w-64 h-64 text-white bg-sky-700 border-2 border-custom shadow cursor-pointer hover:border-red-500 transition-colors duration-200 ease-in-out inline-block mb-4 flex items-center justify-center">
        <%= name %>
        <br>
        <%= dis.node %>
        </div>
        </div>
        <form class="m-0 flex flex-col items-center space-y-2 mt-8" phx-change="noop" phx-submit="noop">
          <.image_input id="image" upload={@uploads.image} height={224} width={224} />
        </form>
        <div class="mt-6 flex space-x-1.5 items-center text-gray-600 text-xl">
          <%= if @running do %>
            <.spinner />
          <% else %>
            <span>Output:</span>
            <span class="text-gray-900 font-medium"><%= @label || "Not running" %></span>
          <% end %>
        </div>
        <p class="text-lg text-center max-w-3xl mx-auto fixed top-2 right-2">
          <a  class="ml-6 text-sky-500 hover:text-sky-700 font-mono font-medium">
            The Dojo ⛩️
            <span class="sr-only">view source on GitHub</span>
          </a>
        </p>
      </div>
    """
  end

  defp image_input(assigns) do
    ~H"""
    <div
      id={@id}
      class="inline-flex p-4 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer bg-white"
      phx-hook="ImageInput"
      data-height={@height}
      data-width={@width}
    >
      <.live_file_input upload={@upload} class="hidden" />
      <input id={"#{@id}-input"} type="file" class="hidden" />
      <div
        class="h-[300px] w-[300px] flex items-center justify-center"
        id={"#{@id}-preview"}
        phx-update="ignore"
      >
        <div class="text-gray-500 text-center">
          Drag an image file here or click to open file browser
        </div>
      </div>
    </div>
    """
  end

  defp spinner(assigns) do
    ~H"""
    <svg phx-no-format class="inline mr-2 w-4 h-4 text-gray-200 animate-spin fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" />
      <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill" />
    </svg>
    """
  end

  def handle_progress(:image, entry, socket) do
    if entry.done? do
      socket
      |> consume_uploaded_entries(:image, fn meta, _ -> {:ok, File.read!(meta.path)} end)
      |> case do
        [binary] ->
          image = decode_as_tensor(binary)

          task =
            Task.async(fn ->
              # run thru student kernels
              Nx.Serving.batched_run(PhoenixDemo.Serving, image)
            end)

          {:noreply, assign(socket, running: true, task_ref: task.ref)}

        [] ->
          {:noreply, socket}
      end
    else
      {:noreply, socket}
    end
  end

  defp decode_as_tensor(<<height::32-integer, width::32-integer, data::binary>>) do
    data |> Nx.from_binary(:u8) |> Nx.reshape({height, width, 3})
  end

  # We need phx-change and phx-submit on the form for live uploads
  def handle_event("noop", %{}, socket) do
    {:noreply, socket}
  end

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

  def handle_info({ref, result}, %{assigns: %{task_ref: ref}} = socket) do
    Process.demonitor(ref, [:flush])
    %{predictions: [%{label: label}]} = result
    {:noreply, assign(socket, label: label, running: false)}
  end
end
