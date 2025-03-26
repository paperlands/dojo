defmodule Dojo.Table do
  use GenServer
  # a bit like a tuplespace per learner

  def publish(pid, msg, event) do
    GenServer.cast(pid, {:publish, msg, event})
  end

  def last(pid, event) when is_pid(pid) do
    GenServer.call(pid, {:last, event})
  end

  def last(_, _event), do: nil

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end


  def init(%{track_pid: pid, topic: topic, disciple: disciple}) do
    {:ok, ref} = Dojo.Gate.track(pid, topic, %{disciple | node: self()})
    {:ok, %{track_pid: pid, topic: topic, disciple: %{disciple | phx_ref: ref}, animate_msg: nil, last: %{}}}
  end

  def handle_cast({:publish, {source, msg ,store}, event}, %{last: last, topic: topic, disciple: %{phx_ref: phx_ref}} = state) do
    Dojo.PubSub.publish({phx_ref, {source, msg}}, event, topic)
    {:noreply, %{state | last: last |> Map.put(event, store)}}
  end

  def handle_call({:last, event}, __from, %{last: last} = state) do
    {:reply, Map.get(last, event, nil), state}
  end

end
