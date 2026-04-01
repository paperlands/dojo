defmodule Dojo.Table do
  # a bit like a tuplespace per learner
  use GenServer
  alias Dojo.Cache
  @ttl 10 * 60 * 1000

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
    # Check cache first (using topic instead of pid for the key)
    case Cache.get({__MODULE__, :last, topic, event}) do
      nil -> fetch_state(topic, target_node, event)
      cached_state -> cached_state
    end
  end

  defp fetch_state(topic, target_node, event) do
    if target_node == :partisan.node() do
      # It's on this node. Call it directly using the local Registry.
      local_fetch(topic, event)
    else
      # It's on a remote node. Use Partisan's RPC to execute `local_fetch/2` OVER THERE.
      case :partisan_rpc.call(target_node, __MODULE__, :local_fetch, [topic, event], 5000) do
        {:badrpc, reason} ->
          # Handle network failures, node down, or timeout cleanly
          {:error, {:rpc_failed, reason}}

        result ->
          result
      end
    end
  end

  # The Local Execution (Runs on whichever node owns the Table)
  # We make this public (@doc false) so :partisan_rpc can invoke it remotely.
  @doc false
  def local_fetch(topic, event) do
    # This automatically looks up the PID in the local Dojo.TableRegistry
    try do
      GenServer.call({:via, Registry, {Dojo.TableRegistry, topic}}, {:last, event}, 5000)
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
       last: %{}
     }}
  end

  def handle_cast(
        {:publish, {_source, _msg, %{state: :error} = store}, :hatch},
        %{
          last: %{hatch: %{commands: [_ | _] = cmds}} = last,
          reg_key: reg_key,
          topic: topic,
          disciple: %{name: name}
        } = state
      ) do
    # check if previously active turtle — hydrate error with previous commands
    hydrated_store = %{store | commands: cmds}

    Cache.put({__MODULE__, :last, reg_key, :hatch}, hydrated_store, ttl: @ttl)
    broadcast_hatch(topic, name, hydrated_store)
    {:noreply, %{state | last: last |> Map.put(:hatch, hydrated_store)}}
  end

  def handle_cast(
        {:publish, {_source, _msg, store}, event},
        %{last: last, reg_key: reg_key, topic: topic, disciple: %{name: name}} = state
      ) do
    Cache.put({__MODULE__, :last, reg_key, event}, store, ttl: @ttl)

    if event == :hatch do
      broadcast_hatch(topic, name, store)
    end

    {:noreply, %{state | last: last |> Map.put(event, store)}}
  end

  def handle_call({:last, event}, _from, %{last: last} = state) do
    {:reply, Map.get(last, event, nil), state}
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

  defp broadcast_hatch(topic, name, store) do
    meta = Map.take(store, [:path, :state, :time])
    Dojo.PubSub.publish({name, {Dojo.Turtle, meta}}, :hatch, topic)
  end
end
