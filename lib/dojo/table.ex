defmodule Dojo.Table do
  # a bit like a tuplespace per learner
  use GenServer
  alias Dojo.Cache
  @ttl 10 * 60 * 1000
  @debounce_ms 100

  def publish(pid, msg, event) do
    GenServer.cast(pid, {:publish, msg, event})
  end

  # Public APIs for watcher management and metadata changes

  def add_watcher(table_pid, liveview_pid) do
    GenServer.call(table_pid, {:add_watcher, liveview_pid})
  end

  def change_meta(table_pid, {_key, _value} = delta) do
    GenServer.call(table_pid, {:change_meta, delta})
  end

  def last({topic, target_node}, event) do
    case Cache.get({__MODULE__, :last, topic, event}) do
      nil -> fetch_state(topic, target_node, event, :last)
      cached_state -> cached_state
    end
  end

  def last_meta({topic, target_node}, event) do
    case Cache.get({__MODULE__, :last, topic, event}) do
      nil -> fetch_state(topic, target_node, event, :last_meta)
      cached -> Map.take(cached, [:path, :state, :time])
    end
  end

  defp fetch_state(topic, target_node, event, call_type) do
    if target_node == :partisan.node() do
      local_fetch(topic, event, call_type)
    else
      case :partisan_rpc.call(
             target_node,
             __MODULE__,
             :local_fetch,
             [topic, event, call_type],
             5000
           ) do
        {:badrpc, reason} ->
          {:error, {:rpc_failed, reason}}

        result ->
          result
      end
    end
  end

  @doc false
  def local_fetch(topic, event, call_type \\ :last) do
    try do
      GenServer.call({:via, Registry, {Dojo.TableRegistry, topic}}, {call_type, event}, 5000)
    catch
      :exit, {:noproc, _} ->
        {:error, :table_not_found_on_node}
    end
  end

  def via_tuple(reg_key) do
    {:via, Registry, {Dojo.TableRegistry, reg_key}}
  end

  def start_link(args) do
    # Register using deterministic reg_key: "#{topic}:#{user_id}"
    # This ensures singleton per user+clan with stable cache/presence keys
    GenServer.start_link(__MODULE__, args, name: via_tuple(args.reg_key))
  end

  def init(%{track_pid: lv_pid, topic: topic, disciple: disciple, reg_key: reg_key}) do
    # Monitor the initial LiveView PID as a watcher
    Process.monitor(lv_pid)

    # Track presence with Table's own PID (self), not the LiveView PID
    # This allows presence to survive as long as ANY tab is connected
    {:ok, ref} = Dojo.Gate.track(self(), topic, %{disciple | node: {reg_key, :partisan.node()}})

    {:ok,
     %{
       watchers: MapSet.new([lv_pid]),
       topic: topic,
       reg_key: reg_key,
       disciple: %{disciple | phx_ref: ref},
       animate_msg: nil,
       last: %{},
       broadcast_timer: nil,
       pending_broadcast: nil
     }}
  end

  def handle_cast(
        {:publish, {_source, _msg, %{state: :error} = store}, :hatch},
        %{
          last: %{hatch: %{commands: [_ | _] = cmds}} = last,
          reg_key: reg_key
        } = state
      ) do
    # check if previously active turtle — hydrate error with previous commands
    hydrated_store = %{store | commands: cmds}

    async_cache_put(reg_key, :hatch, hydrated_store)
    new_last = Map.put(last, :hatch, hydrated_store)
    {:noreply, state |> Map.put(:last, new_last) |> schedule_hatch_broadcast(hydrated_store)}
  end

  def handle_cast(
        {:publish, {_source, _msg, store}, event},
        %{last: last, reg_key: reg_key} = state
      ) do
    async_cache_put(reg_key, event, store)
    new_last = Map.put(last, event, store)

    state = %{state | last: new_last}

    if event == :hatch do
      {:noreply, schedule_hatch_broadcast(state, store)}
    else
      {:noreply, state}
    end
  end

  def handle_call({:last, event}, _from, %{last: last} = state) do
    {:reply, Map.get(last, event, nil), state}
  end

  def handle_call({:last_meta, event}, _from, %{last: last} = state) do
    meta =
      case Map.get(last, event) do
        nil -> nil
        store -> Map.take(store, [:path, :state, :time])
      end

    {:reply, meta, state}
  end

  def handle_call(
        {:add_watcher, lv_pid},
        _from,
        %{watchers: watchers} = state
      ) do
    # Idempotent: if already watching this PID, don't monitor again
    if MapSet.member?(watchers, lv_pid) do
      {:reply, :ok, state}
    else
      Process.monitor(lv_pid)
      {:reply, :ok, %{state | watchers: MapSet.put(watchers, lv_pid)}}
    end
  end

  def handle_call(
        {:change_meta, {_key, _value} = delta},
        _from,
        %{topic: topic, disciple: %{name: name}} = state
      ) do
    # Route Gate.change through Table PID (which owns the presence entry)
    Dojo.Gate.change(self(), topic, name, delta)
    {:reply, :ok, state}
  end

  def handle_info(:flush_broadcast, %{pending_broadcast: nil} = state) do
    {:noreply, %{state | broadcast_timer: nil}}
  end

  def handle_info(
        :flush_broadcast,
        %{pending_broadcast: store, topic: topic, reg_key: reg_key} = state
      ) do
    broadcast_hatch(topic, reg_key, store)
    {:noreply, %{state | broadcast_timer: nil, pending_broadcast: nil}}
  end

  def handle_info(
        {:DOWN, _ref, :process, pid, _reason},
        %{watchers: watchers} = state
      ) do
    watchers = MapSet.delete(watchers, pid)

    if MapSet.size(watchers) == 0 do
      {:stop, :normal, state}
    else
      {:noreply, %{state | watchers: watchers}}
    end
  end

  def terminate(_reason, %{reg_key: reg_key}) do
    Cache.delete({__MODULE__, :last, reg_key, :hatch})
    :ok
  end

  defp async_cache_put(reg_key, event, store) do
    Task.Supervisor.start_child(Dojo.TaskSupervisor, fn ->
      Cache.put({__MODULE__, :last, reg_key, event}, store, ttl: @ttl)
    end)
  end

  defp schedule_hatch_broadcast(%{broadcast_timer: nil} = state, store) do
    timer = Process.send_after(self(), :flush_broadcast, @debounce_ms)
    %{state | broadcast_timer: timer, pending_broadcast: store}
  end

  defp schedule_hatch_broadcast(state, store) do
    # Timer already running — just update pending to latest state
    %{state | pending_broadcast: store}
  end

  defp broadcast_hatch(topic, reg_key, store) do
    meta = Map.take(store, [:path, :state, :time])

    # Layer 2a: full payload to local subscribers (instant render, no Plumtree)
    Phoenix.PubSub.local_broadcast(
      Dojo.PubSub,
      topic,
      {Dojo.PubSub, :hatch, {reg_key, {Dojo.Turtle, meta}}}
    )

    # Layer 2b: lightweight version signal to remote nodes via Plumtree
    # Map payload — extensible across rolling deploys without breaking receivers.
    # Older nodes sending 3-tuples are handled by the legacy clause in ShellLive.
    Dojo.PubSub.publish(
      %{reg_key: reg_key, time: meta[:time], state: meta[:state]},
      :hatch_version,
      topic
    )
  end
end
