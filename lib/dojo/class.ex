defmodule Dojo.Class do
  use GenServer

  def join(pid, book, disciple) do
    topic = "class:" <> book
    {:ok, class} = GenServer.start_link(__MODULE__, %{room: pid, book: book, disciple: disciple})
    Dojo.Gate.track(pid, topic, %{disciple | node: class})
    {:ok, class}
  end

  def publish(pid, msg, event) do
    GenServer.cast(pid, {:publish, msg, event})
  end

  def last_animate(pid) when is_pid(pid) do
    GenServer.call(pid, :last_animate)
  end

  def last_animate(_), do: nil

  def init(%{book: book, disciple: disciple}) do
    {:ok, %{topic: topic(book), disciple: disciple, animate_msg: nil}}
  end

  def handle_cast({:publish, msg, :animate}, %{topic: topic, disciple: %{name: name}} = state) do
    Dojo.PubSub.publish({name, msg}, :animate, topic)
    {:noreply, %{state | animate_msg: msg}}
  end

  def handle_call(:last_animate, __from, %{animate_msg: msg} = state) do
    {:reply, msg, state}
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
