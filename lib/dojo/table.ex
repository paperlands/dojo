defmodule Dojo.Table do
  # a bit like a tuplespace per learner
  use GenServer
  alias Dojo.Cache
  @ttl 10 * 60 * 1000

  def publish(pid, msg, event) do
    GenServer.cast(pid, {:publish, msg, event})
  end


  def last({pid, target_node}, event) when is_pid(pid) do
    IO.inspect(pid)
    case Cache.get({__MODULE__, :last, pid, event}) do
      # partisan_genserver client lookup or service discovery for image hosting
      nil -> if target_node == :partisan.node() do 
          GenServer.call(pid, {:last, event})
             else
               :partisan_gen_server.call(target_node, pid, event)
        end
      last -> last
    end
  end

  def last(node, event) do
    IO.inspect(node)
    nil
  end

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end

  def init(%{track_pid: pid, topic: topic, disciple: disciple}) do
    # this track_pid is the liveview pid
    {:ok, ref} = Dojo.Gate.track(pid, topic, %{disciple | node: {self(), :partisan.node()}})

    {:ok,
     %{
       track_pid: pid,
       topic: topic,
       disciple: %{disciple | phx_ref: ref},
       animate_msg: nil,
       last: %{}
     }}
  end


  def handle_cast(
    {:publish, {_source, _msg, %{state: :error} = store}, :hatch},
    %{last: %{hatch: %{commands: [_|_] = cmds}} = last, topic: _topic, disciple: %{phx_ref: _phx_ref}} = state
  ) do
    # check if previously active turtle
    hydrated_store = %{store | commands: cmds}
    
    Cache.put({__MODULE__, :last, self(), :hatch}, hydrated_store, ttl: @ttl)
    {:noreply, %{state | last: last |> Map.put(:hatch, hydrated_store)}}
  end


  # this has to publish to a shared datastore per topic instance maybe ets(?)
  def handle_cast(
    {:publish, {_source, _msg, store}, event},
    %{last: last, topic: _topic, disciple: %{phx_ref: _phx_ref}} = state
  ) do
    # Dojo.PubSub.publish({phx_ref, {source, msg}}, event, topic)
    Cache.put({__MODULE__, :last, self(), event}, store, ttl: @ttl)
    {:noreply, %{state | last: last |> Map.put(event, store)}}
  end

  def handle_call({:last, event}, __from, %{last: last} = state) do
    {:reply, Map.get(last, event, nil), state}
  end
end
