defmodule Dojo.Table do
  use GenServer

  def publish(pid, msg, event) do
    GenServer.cast(pid, {:publish, msg, event})
  end

  def last_animate(pid) when is_pid(pid) do
    GenServer.call(pid, :last_animate)
  end

  def last_animate(_), do: nil

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end


  def init(%{topic: topic, disciple: disciple}) do
    {:ok, %{topic: topic, disciple: disciple, animate_msg: nil}}
  end

  def handle_cast({:publish, msg, :animate}, %{topic: topic, disciple: %{name: name}} = state) do
    Dojo.PubSub.publish({name, msg}, :animate, topic)
    {:noreply, %{state | animate_msg: msg}}
  end

  def handle_call(:last_animate, __from, %{animate_msg: msg} = state) do
    {:reply, msg, state}
  end
end
