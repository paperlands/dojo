defmodule Dojo.Class do
  use DynamicSupervisor
  alias Dojo.Table

  # takes care of all disciples across all tables

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  def join(pid, book, disciple) do
    spec = %{
      id: Table,
      start: {Table, :start_link, [%{track_pid: pid, topic: topic(book), disciple: disciple}]}
    }

    DynamicSupervisor.start_child({:via, PartitionSupervisor, {__MODULE__, self()}}, spec)
  end

  def join!(pid, book, disciple) do
    {:ok, class} = join(pid, book, disciple)
    class
  end

  ## helper fns

  def whereis(username, book) do
    Dojo.Gate.get_by_key(topic(book), username)
  end

  def list_disciples(book) do
    Dojo.Gate.list_users(topic(book))
    |> Enum.into(%{}, fn %{phx_ref: ref} = dis -> {ref, dis} end)
  end

  def listen(book) do
    Dojo.PubSub.subscribe(topic(book))
  end

  defp topic(book) do
    "class:" <> book
  end
end
