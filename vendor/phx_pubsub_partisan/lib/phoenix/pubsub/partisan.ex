defmodule Phoenix.PubSub.Partisan do
  @moduledoc """
  A Phoenix.PubSub adapter using Partisan's Plumtree backend.

  Its own OTP app because the host's compiler deletes the beam and unloads every
  module it is about to recompile (`Mix.Compilers.Elixir`), while
  `Phoenix.Tracker.Shard` keeps resolving this module by atom from Registry meta
  — a heartbeat in that window was `UndefinedFunctionError`, one dead shard per
  rebuild. A host-only recompile cannot unload this app; rebuilding `:partisan`
  or this app itself still can.
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

  # Helper to lookup config — this app's own key, never the host's: a vendored
  # module reading `:dojo` is a coupling that outlives the reason for the move.
  defp config_control_channel,
    do: Application.get_env(:phx_pubsub_partisan, __MODULE__)[:channel_control] || :default

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

  # Health is read from *this handler's* group, not the legacy broadcast server
  # (D070.3). In v6 each handler owns its own group process; the old global name
  # can be healthy while our group is absent, and then the cast lands nowhere and
  # still returns `ok`.
  defp plumtree_overloaded? do
    case group_queue_len() do
      :unknown -> false
      :missing -> true
      len -> len > @plumtree_overload_threshold
    end
  end

  @doc false
  # Health is read from *this handler's* group, not the legacy broadcast server
  # (D070.3). D070.3 sets where health comes from; this sets that reading it may
  # never kill the caller — it runs inside Phoenix.Tracker.Shard, where one
  # exception takes presence down on every heartbeat.
  def group_queue_len(fetch \\ &plumtree_group_name/0) do
    case Process.whereis(fetch.()) do
      nil -> warn_group_missing()
      pid -> queue_len(pid)
    end
  rescue
    e in UndefinedFunctionError -> warn_probe_unavailable(e)
  end

  # Static call, on purpose: `mix compile` warns when the running dep lacks the
  # API, which is how a stale or mismatched partisan build gets diagnosed.
  defp plumtree_group_name do
    :partisan_plumtree_broadcast.group_name(Phoenix.PubSub.Partisan.Handler)
  end

  defp queue_len(pid) do
    case Process.info(pid, :message_queue_len) do
      {:message_queue_len, len} -> len
      _ -> 0
    end
  end

  # Warn once per node, not once per broadcast: a missing group is a
  # configuration fact, and a per-message warning would flood the very log that
  # should reveal it (D070.3).
  defp warn_group_missing do
    unless :persistent_term.get({__MODULE__, :group_missing_warned}, false) do
      :persistent_term.put({__MODULE__, :group_missing_warned}, true)

      Logger.warning(
        "No broadcast group for #{inspect(__MODULE__)}: remote PubSub is not " <>
          "disseminating. Declare the handler in :partisan, :broadcast_mods (D070.3)."
      )
    end

    :missing
  end

  # The dep is wrong, not the group: say it once, naming what actually broke.
  defp warn_probe_unavailable(%UndefinedFunctionError{module: mod, function: fun}) do
    unless :persistent_term.get({__MODULE__, :probe_unavailable_warned}, false) do
      :persistent_term.put({__MODULE__, :probe_unavailable_warned}, true)

      Logger.error(
        "#{inspect(mod)}.#{fun} is missing — the loaded Partisan is not the one this " <>
          "code was built against. Remote dissemination is attempted without this check; " <>
          "handler-group health is unknown until the dep is rebuilt " <>
          "(mix deps.clean partisan --build)."
      )
    end

    :unknown
  end

  @impl true

  def direct_broadcast(adapter_name, target_node, topic, message, dispatcher) do
    # Calculate the handler name once
    pubsub_name = :persistent_term.get({adapter_name, :pubsub})
    local_handler = handler_name(pubsub_name)

    if target_node == :partisan.node() do
      # Send to the local Handler: it holds the pubsub_name and will call
      # local_broadcast correctly.
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
          # The message is lost for this callback, though `true` still suppresses
          # re-propagation — log enough to tell loss from delivery (D070).
          Logger.error(
            "Partisan Delivery Failed: PubSub '#{inspect(pubsub_name)}' not running. " <>
              Exception.format(:error, e, __STACKTRACE__)
          )

        e ->
          Logger.error(
            "Partisan Delivery Failed: " <> Exception.format(:error, e, __STACKTRACE__)
          )
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
    :ets.member(@seen_table, id)
  catch
    :error, :badarg -> false
  end

  @impl true
  def broadcast_channel, do: :data

  # -- Deduplication helpers --------------------------------------------------

  defp mark_seen(id) do
    :ets.insert(@seen_table, {id, :erlang.monotonic_time()})
    maybe_prune_seen()
  catch
    :error, :badarg -> :ok
  end

  defp maybe_prune_seen do
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
      e ->
        Logger.error(
          "Partisan direct delivery failed: " <> Exception.format(:error, e, __STACKTRACE__)
        )
    end

    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end
end
