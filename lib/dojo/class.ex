defmodule Dojo.Class do
  use DynamicSupervisor
  alias Dojo.Table

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  def join(pid, book, disciple) do

    spec = %{id: Table, start: {Table, :start_link, [%{topic: topic(book), disciple: disciple}]}}

    {:ok, class} = DynamicSupervisor.start_child(
      {:via, PartitionSupervisor, {__MODULE__, self()}},
      spec
    )

    Dojo.Gate.track(pid, topic(book), %{disciple | node: class})

    {:ok, class}
  end


  ## helper fns

  def whereis(username, book) do
    Dojo.Gate.get_by_key(topic(book), username)
  end

  def list_disciples(book) do
    Dojo.Gate.list_users(topic(book))
    |> Enum.into(%{}, fn %{name: name} = dis -> {name, dis} end)

  end

  def listen(book) do
    Dojo.PubSub.subscribe(topic(book))
  end

  defp topic(book) do
    "class:" <> book
  end

end
