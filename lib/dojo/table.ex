defmodule Dojo.Table do
  # a bit like a tuplespace per learner
  use GenServer
  alias Dojo.Cache
  @ttl 10 * 60 * 1000

  def publish(pid, msg, event) do
    GenServer.cast(pid, {:publish, msg, event})
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

  # 4. The Local Execution (Runs on whichever node owns the Table)
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

  def via_tuple(topic) do
    {:via, Registry, {Dojo.TableRegistry, topic}}
  end

  def start_link(args) do
    # 2. Register using the deterministic topic string via the Registry
    # This assumes `args` has a `:topic` key (e.g., "bbc2cb5a-9267-4124-99ff-27655771c0d1")
    args = Map.put(args, :reg_id, Ecto.UUID.generate())
    GenServer.start_link(__MODULE__, args, name: via_tuple(args.reg_id))
  end

  def init(%{track_pid: pid, topic: topic, disciple: disciple, reg_id: reg_id}) do
    # this track_pid is the liveview pid
    Process.monitor(pid)
    {:ok, ref} = Dojo.Gate.track(pid, topic, %{disciple | node: {reg_id, :partisan.node()}})

    {:ok,
     %{
       track_pid: pid,
       topic: topic,
       reg_id: reg_id,
       disciple: %{disciple | phx_ref: ref},
       animate_msg: nil,
       last: %{}
     }}
  end

  def handle_cast(
        {:publish, {_source, _msg, %{state: :error} = store}, :hatch},
        %{
          last: %{hatch: %{commands: [_ | _] = cmds}} = last,
          reg_id: reg_id,
          topic: topic,
          disciple: %{name: name}
        } = state
      ) do
    # check if previously active turtle — hydrate error with previous commands
    hydrated_store = %{store | commands: cmds}

    Cache.put({__MODULE__, :last, reg_id, :hatch}, hydrated_store, ttl: @ttl)
    broadcast_hatch(topic, name, hydrated_store)
    {:noreply, %{state | last: last |> Map.put(:hatch, hydrated_store)}}
  end

  def handle_cast(
        {:publish, {_source, _msg, store}, event},
        %{last: last, reg_id: reg_id, topic: topic, disciple: %{name: name}} = state
      ) do
    Cache.put({__MODULE__, :last, reg_id, event}, store, ttl: @ttl)

    if event == :hatch do
      broadcast_hatch(topic, name, store)
    end

    {:noreply, %{state | last: last |> Map.put(event, store)}}
  end

  def handle_call({:last, event}, _from, %{last: last} = state) do
    {:reply, Map.get(last, event, nil), state}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, %{track_pid: pid} = state) do
    {:stop, :normal, state}
  end

  def terminate(_reason, %{reg_id: reg_id}) do
    Cache.delete({__MODULE__, :last, reg_id, :hatch})
    :ok
  end

  defp broadcast_hatch(topic, name, store) do
    meta = Map.take(store, [:path, :state, :time])
    Dojo.PubSub.publish({name, {Dojo.Turtle, meta}}, :hatch, topic)
  end
end
