defmodule Phoenix.PubSub.Partisan do
  @moduledoc """
  A Phoenix.PubSub adapter using Partisan's Plumtree backend.
  """

  @behaviour Phoenix.PubSub.Adapter
  use Supervisor
  require Logger

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
  defp config_control_channel,
    do: Application.get_env(:dojo, Phoenix.PubSub.Partisan)[:channel_control] || :default

  defp handler_name(adapter_name), do: Module.concat(adapter_name, Handler)

  @impl true
  def node_name(_adapter_name), do: :partisan.node()

  # Circuit breaker threshold: drop remote broadcasts when Plumtree is overloaded.
  # Local delivery is always preserved — remote nodes recover via windowed pull.
  @plumtree_overload_threshold 1_000

  @impl true
  def broadcast(adapter_name, topic, message, dispatcher) do
    # 1. Local delivery always happens (non-blocking send to Handler)
    pubsub_name = :persistent_term.get({adapter_name, :pubsub})
    local_handler = handler_name(pubsub_name)
    send(local_handler, {:direct, topic, message, dispatcher})

    # 2. Remote dissemination with circuit breaker
    payload = {:broadcast, pubsub_name, topic, message, dispatcher}

    if plumtree_overloaded?() do
      Logger.warning("Plumtree overloaded, dropping remote broadcast for #{topic}")
    else
      :partisan_plumtree_broadcast.broadcast(payload, Phoenix.PubSub.Partisan.Handler)
    end

    :ok
  end

  defp plumtree_overloaded? do
    case Process.whereis(:partisan_plumtree_broadcast) do
      nil ->
        false

      pid ->
        case Process.info(pid, :message_queue_len) do
          {:message_queue_len, len} -> len > @plumtree_overload_threshold
          _ -> false
        end
    end
  end

  @impl true

  def direct_broadcast(adapter_name, target_node, topic, message, dispatcher) do
    # Calculate the handler name once
    pubsub_name = :persistent_term.get({adapter_name, :pubsub})
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

  @seen_table :partisan_pubsub_seen
  @max_seen 10_000

  # ----------------------------------------------------------------------------
  # API & Init
  # ----------------------------------------------------------------------------
  def start_link({server_name, pubsub_name}) do
    GenServer.start_link(__MODULE__, pubsub_name, name: server_name)
  end

  @impl true
  def init(pubsub_name) do
    # Create ETS table for message deduplication.
    # Named + public so the stateless is_stale/1 callback can access it.
    case :ets.whereis(@seen_table) do
      :undefined ->
        :ets.new(@seen_table, [:set, :named_table, :public])

      _ref ->
        # Table already exists (e.g., after Handler restart)
        :ok
    end

    {:ok, %{pubsub_name: pubsub_name}}
  end

  # ----------------------------------------------------------------------------
  # 2. PLUMTREE CALLBACKS (The Data Plane)
  # ----------------------------------------------------------------------------

  @impl true
  def broadcast_data(msg) do
    # Include a monotonic unique_integer so identical payloads at different
    # times generate distinct IDs, while the same broadcast propagating
    # across gossip hops keeps its ID stable (generated once at origin).
    id = {:erlang.phash2(msg), :erlang.unique_integer([:monotonic])}
    # Mark seen at origin: plumtree never calls merge/2 on our own broadcasts
    # (see partisan_plumtree_broadcast.erl handle_cast({broadcast, _, _, _}))
    # so without this, a gossip loop bringing the message back would
    # produce a duplicate local delivery AND trigger re-propagation.
    mark_seen(id)
    {id, msg}
  end

  @impl true
  # Behaviour contract (partisan_plumtree_broadcast_handler:54-56):
  #   "MUST return `false' if the message has already been received,
  #    otherwise `true'"
  # Returning true for duplicates causes plumtree to re-eager-push the
  # message, turning gossip convergence into a propagation loop.
  def merge(id, {:broadcast, pubsub_name, topic, message, dispatcher}) do
    if is_stale(id) do
      # Duplicate: plumtree will send prune to upstream, stopping re-propagation.
      false
    else
      mark_seen(id)

      try do
        Phoenix.PubSub.local_broadcast(pubsub_name, topic, message, dispatcher)
      rescue
        e in ArgumentError ->
          Logger.error(
            "Partisan Delivery Failed: PubSub '#{inspect(pubsub_name)}' not running. #{inspect(e)}"
          )

        e ->
          Logger.error("Partisan Delivery Failed: #{inspect(e)}")
      end

      true
    end
  end

  # Catch-all for weird messages to prevent crashes
  def merge(id, data) do
    Logger.warning("Partisan ignored unknown payload: ID #{inspect(id)} Data: #{inspect(data)}")
    # Return false to suppress re-propagation of unknown payloads.
    false
  end

  @impl true
  def exchange(_peer), do: :ignore

  # PubSub is ephemeral — no message history to replay. Returning `:stale`
  # (not `{:error, _}`) is critical: handle_graft(stale, ...) acks the
  # outstanding entry, whereas handle_graft({error, _}, ...) logs and
  # leaves the entry in ?PLUMTREE_OUTSTANDING forever. The leaked entries
  # are re-scanned every lazy_tick (1s), producing an i_have storm that
  # never self-terminates.
  @impl true
  def graft(_message_id), do: :stale

  @impl true
  def is_stale(id) do
    # Check the ETS-backed seen set. When is_stale returns true, Plumtree
    # sends ignored_i_have → ack_outstanding removes the entry from
    # PLUMTREE_OUTSTANDING, breaking the infinite i_have/graft loop.
    try do
      :ets.member(@seen_table, id)
    catch
      :error, :badarg -> false
    end
  end

  @impl true
  def broadcast_channel, do: :data

  # -- Deduplication helpers --------------------------------------------------

  defp mark_seen(id) do
    try do
      :ets.insert(@seen_table, {id, :erlang.monotonic_time()})
      maybe_prune_seen()
    catch
      :error, :badarg -> :ok
    end
  end

  defp maybe_prune_seen do
    try do
      size = :ets.info(@seen_table, :size)

      if is_integer(size) and size > @max_seen do
        # Delete oldest half by selecting entries with smallest timestamps.
        # For simplicity, just delete the first half of entries (insertion order
        # approximates chronological order in a :set table).
        to_delete = div(size, 2)
        key = :ets.first(@seen_table)
        do_prune(key, to_delete)
      end
    catch
      :error, :badarg -> :ok
    end
  end

  defp do_prune(:"$end_of_table", _remaining), do: :ok
  defp do_prune(_key, 0), do: :ok

  defp do_prune(key, remaining) do
    next = :ets.next(@seen_table, key)
    :ets.delete(@seen_table, key)
    do_prune(next, remaining - 1)
  end

  # ----------------------------------------------------------------------------
  # 3. DIRECT UNICAST (The Control Plane)
  # ----------------------------------------------------------------------------
  # This receives messages sent via :partisan.forward_message/4.
  # Used by Phoenix.Tracker for State Transfer (CRDT sync).
  @impl true
  def handle_info({:direct, topic, message, dispatcher}, state) do
    # Inline delivery: local_broadcast is non-blocking (send/2 via Registry).
    try do
      Phoenix.PubSub.local_broadcast(state.pubsub_name, topic, message, dispatcher)
    rescue
      e -> Logger.error("Partisan direct delivery failed: #{inspect(e)}")
    end

    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end
end
