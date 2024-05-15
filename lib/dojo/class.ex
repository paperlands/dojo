defmodule Dojo.Class do
  use GenServer

  def join(pid, book, disciple) do
    topic = "class:" <> book
    Dojo.Gate.track(pid, topic, disciple)
    GenServer.start_link(__MODULE__, %{room: pid, book: book, disciple: disciple})
  end

  def submit(pid, function) do
    GenServer.call(pid, {:animate, function})
  end


  def init(%{book: book, disciple: disciple}) do
    {:ok, %{topic: topic(book), disciple: disciple}}
  end


  def handle_call({:animate, func}, _from, %{topic: topic, disciple: %{name: name}}) do
    Dojo.PubSub.publish({name, func}, :animate, topic)
    {:reply, :ok}
  end


  ## helper fns

  def whereis(username, book) do
    Dojo.Gate.get_by_key("class:" <> book, username)
  end

  def listen(book) do
    Dojo.PubSub.subscribe(topic(book))
  end

  defp topic(book) do
    "class:" <> book
  end
end
