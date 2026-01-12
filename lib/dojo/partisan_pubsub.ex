defmodule Phoenix.PubSub.Partisan do
  @moduledoc """
  A Phoenix.PubSub adapter using Partisan's Plumtree backend.
  """
  
  @behaviour Phoenix.PubSub.Adapter
  use Supervisor
  def start_link(opts) do
    adapter_name = Keyword.fetch!(opts, :adapter_name)
    supervisor_name = Module.concat(adapter_name, "Supervisor")
    Supervisor.start_link(__MODULE__, opts, name: supervisor_name)
  end

  @impl true
  def init(opts) do
    pubsub_name = Keyword.fetch!(opts, :name)
    adapter_name = Keyword.fetch!(opts, :adapter_name)
    # future this can be a process broadcast group to be explored
    :persistent_term.put({adapter_name, :pubsub}, pubsub_name)

    children = [
      # The Handler receives messages from Partisan and injects them into PubSub
      {Phoenix.PubSub.Partisan.Handler, {handler_name(pubsub_name), pubsub_name}}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  # ----------------------------------------------------------------------------
  # 4. Adapter Callbacks
  # ----------------------------------------------------------------------------

  # Helper to lookup config
  defp config_data_channel, do: Application.get_env(:dojo, Phoenix.PubSub.Partisan)[:channel_data] || :default
  defp config_control_channel, do: Application.get_env(:dojo, Phoenix.PubSub.Partisan)[:channel_control] || :default
  defp handler_name(adapter_name), do: Module.concat(adapter_name, Handler)

  @impl true
  def node_name(_adapter_name), do: :partisan.node()

  @impl true
  def broadcast(adapter_name, topic, message, dispatcher) do
    # 1. Local Optimization (keep as is)
    # We still send to the local process for local dispatching
    pubsub_name= :persistent_term.get({adapter_name, :pubsub})
    local_handler = handler_name(pubsub_name)
    send(local_handler, {:direct, topic, message, dispatcher})

    # 2. Remote Dissemination
    # FIX A: Embed 'pubsub_name' in the payload so the remote node knows 
    #        which PubSub registry to target (since callbacks are stateless).
    #        WHOLE BUNCH OF NAMING TO FIX
    payload = {:broadcast, pubsub_name, topic, message, dispatcher}

    # FIX B: Pass the MODULE name (Phoenix.PubSub.Partisan.Handler), 
    #        not the Process Name (local_handler).
    :partisan_plumtree_broadcast.broadcast(payload, Phoenix.PubSub.Partisan.Handler)
    
    :ok
  end

  @impl true

  def direct_broadcast(adapter_name, target_node, topic, message, dispatcher) do
    # Calculate the handler name once
    pubsub_name= :persistent_term.get({adapter_name, :pubsub})
    local_handler = handler_name(pubsub_name)

    if target_node == :partisan.node() do
      # FIX: Send to the local Handler. 
      # The Handler holds the `pubsub_name` and will call local_broadcast correctly.
      send(local_handler, {:direct, topic, message, dispatcher})
    else
      # Remote Forwarding (Control Channel)
      payload = {:direct, topic, message, dispatcher}
      opts = %{channel: config_control_channel()}
      
      # Note: This relies on the remote handler having the same name
      :partisan.forward_message(target_node, local_handler, payload, opts)
    end
    :ok
  end
end


defmodule Phoenix.PubSub.Partisan.Handler do
  @moduledoc """
  The bridge between the Partisan Runtime and the local Phoenix Registry.
  """
  use GenServer
  
  # 1. BEHAVIOUR
  @behaviour :partisan_plumtree_broadcast_handler

  require Logger

  # ----------------------------------------------------------------------------
  # API & Init
  # ----------------------------------------------------------------------------
  def start_link({server_name , pubsub_name}) do
    GenServer.start_link(__MODULE__, pubsub_name, name: server_name)
  end

  @impl true
  def init(pubsub_name) do
    {:ok, %{pubsub_name: pubsub_name}}
  end

  # ----------------------------------------------------------------------------
  # 2. PLUMTREE CALLBACKS (The Data Plane)
  # ----------------------------------------------------------------------------

  # FIX: Add @impl to broadcast_data
  @impl true
  def broadcast_data(msg) do
    # We hash the message to create a unique ID for the tree
    {:erlang.phash2(msg), msg}
  end

  @impl true
  def merge(_id, {:broadcast, pubsub_name, topic, message, dispatcher}) do
    try do
      # Attempt to deliver to the local PubSub system
      Phoenix.PubSub.local_broadcast(pubsub_name, topic, message, dispatcher)
    rescue
      # If the PubSub system (Registry) is down or named differently, catch the crash.
      e in ArgumentError ->
        Logger.error("Partisan Delivery Failed: PubSub process '#{inspect(pubsub_name)}' is not running on this node. Error: #{inspect(e)}")
      
      e -> 
        Logger.error("Partisan Delivery Failed: Unknown error #{inspect(e)}")
    end

    # Always return true to keep the gossip tree healthy
    true
  end

  # Catch-all for weird messages to prevent crashes
  def merge(id, data) do
    Logger.warning("Partisan ignored unknown payload: ID #{inspect(id)} Data: #{inspect(data)}")
    true
  end
  # FIX: 'exchange/1' takes 1 argument (Peer), not 2.
  # We return :ignore because PubSub is ephemeral; we don't sync historical messages.
  @impl true
  def exchange(_peer), do: :ignore

  # FIX: 'graft/1' handles tree repairs.
  # Since we don't keep a history of messages, we cannot satisfy grafts.
  @impl true
  def graft(_message_id), do: :ignore

  # FIX: 'is_stale/1' checks if we've already seen this message.
  # For real-time PubSub, we assume nothing is stale to ensure propagation,
  # or rely on Partisan's internal cache.
  @impl true
  def is_stale(_id), do: false

  # FIX: 'broadcast_channel/0' is recommended to define the channel.
  @impl true
  def broadcast_channel, do: :data # or whatever channel you configured

  # ----------------------------------------------------------------------------
  # 3. DIRECT UNICAST (The Control Plane)
  # ----------------------------------------------------------------------------
  # This receives messages sent via :partisan.forward_message/4.
  # Used by Phoenix.Tracker for State Transfer (CRDT sync).
  @impl true
  def handle_info({:direct, topic, message, dispatcher}, state) do
    Phoenix.PubSub.local_broadcast(state.pubsub_name, topic, message, dispatcher)
    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end
end
