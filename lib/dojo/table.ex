defmodule Dojo.Table do
  # a bit like a tuplespace per learner
  use GenServer
  alias Dojo.Cache
  @ttl 10*60*1000

  def publish(pid, msg, event) do
    GenServer.cast(pid, {:publish, msg, event})
  end

  def last(pid, event) when is_pid(pid) do
    case Cache.get({__MODULE__, :last, pid, event}) do
      nil -> GenServer.call(pid, {:last, event})
      last -> last
    end
  end

  def last(_, _event), do: nil

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end


  def init(%{track_pid: pid, topic: topic, disciple: disciple}) do
    {:ok, ref} = Dojo.Gate.track(pid, topic, %{disciple | node: self()})
    {:ok, %{track_pid: pid, topic: topic, disciple: %{disciple | phx_ref: ref}, animate_msg: nil, last: %{}}}
  end

  # this has to publish to a shared datastore per topic instance maybe ets(?)
  def handle_cast({:publish, {_source, _msg ,store}, event}, %{last: last, track_pid: pid, topic: _topic, disciple: %{phx_ref: _phx_ref}} = state) do
    #Dojo.PubSub.publish({phx_ref, {source, msg}}, event, topic)
    Cache.put({__MODULE__, :last, pid, event}, store, ttl: @ttl)
    {:noreply, %{state | last: last |> Map.put(event, store)}}
  end

  def handle_call({:last, event}, __from, %{last: last} = state) do
    {:reply, Map.get(last, event, nil), state}
  end

end
