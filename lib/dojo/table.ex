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

  # def last({pid, target_node}, event) when is_pid(pid) do
  #   IO.inspect(pid)
  #   case Cache.get({__MODULE__, :last, pid, event}) do
  #     # partisan_genserver client lookup or service discovery for image hosting
  #     nil -> if target_node == :partisan.node() do 
  #         GenServer.call(pid, {:last, event})
  #            else
  #              :partisan_gen_server.call(target_node, pid, event)
  #       end
  #     last -> last
  #   end
  # end

  # def last(node, event) do
  #   IO.inspect(node)
  #   nil
  # end

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
    {:ok, ref} = Dojo.Gate.track(pid, topic, %{disciple | node: {reg_id, :partisan.node()}})

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
        %{
          last: %{hatch: %{commands: [_ | _] = cmds}} = last,
          topic: _topic,
          disciple: %{phx_ref: _phx_ref}
        } = state
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
