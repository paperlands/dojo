defmodule Dojo.Cluster do
  use GenServer
  require Logger

  # Import the struct so we can pattern match on it
  alias Cluster.Strategy.State

  # --- Constants ---
  @seen_ttl_ms 60_000
  @task_supervisor Dojo.TaskSupervisor

  # Define our own internal state that includes the Libcluster state
  defstruct [
    :cluster_state,   # The original %Cluster.Strategy.State{}
    :seen_peers,      # Cache for debouncing: %{ "UUID" => timestamp }
    :connect_fun,     # Extracted function for joining
    :list_nodes_fun   # Extracted function for listing members
  ]

  # --- API ---

  def start_link(args) do
    # Libcluster passes [ %State{} ] as arguments
    GenServer.start_link(__MODULE__, args, name: __MODULE__)
  end

  # --- GenServer Callbacks ---

  @impl true
  def init([%State{} = state]) do
    # 1. Extract configuration from the 'config' field inside the State struct
    # These are the options you defined in application.ex
    config = state.config
    
    # 2. Extract the Partisan functions
    connect_fun = Keyword.get(config, :connect)
    list_nodes_fun = Keyword.get(config, :list_nodes)
    
    # Validation (Optional but helpful)
    if is_nil(connect_fun) or is_nil(list_nodes_fun) do
      raise "Dojo Strategy requires :connect and :list_nodes to be defined in config!"
    end


    # 4. Start Discovery Listeners (mDNS / Native)

    # 5. Schedule Cache Pruning
    schedule_prune()

    # 6. Initialize State
    new_state = %__MODULE__{
      cluster_state: state,
      seen_peers: %{},
      connect_fun: connect_fun,
      list_nodes_fun: list_nodes_fun
    }
    
    Logger.info("Dojo Strategy: Active. Strategy=#{state.topology}")
    {:ok, new_state}
  end

  # --- Discovery Handler ---

  @impl true
  def handle_info({:peer_discovered, remote_uuid, remote_ip, remote_port}, state) do
    my_uuid = System.get_env("PARTISAN_NAME")

    cond do
      #1. Ignore Self
      remote_uuid == my_uuid ->
        IO.inspect("ME")
        {:noreply, state}

      # 2. Check if already connected
      is_already_connected?(state.list_nodes_fun, remote_uuid) ->
        IO.inspect("ALREADY CONNECTED")
        {:noreply, state}

        # # 3. Debounce
        # should_throttle?(state.seen_peers, remote_uuid) ->
        # {:noreply, state}

      # 4. Punch
      true ->
        Task.Supervisor.start_child(@task_supervisor, fn -> 
          execute_punch(state.connect_fun, remote_ip, remote_port, remote_uuid) 
        end)

        new_seen = Map.put(state.seen_peers, remote_uuid, System.monotonic_time(:millisecond))
        {:noreply, %{state | seen_peers: new_seen}}
    end
  end

  # --- Housekeeping ---

  @impl true
  def handle_info(:prune_seen_cache, state) do
    now = System.monotonic_time(:millisecond)
    new_seen = :maps.filter(fn _, ts -> (now - ts) < @seen_ttl_ms end, state.seen_peers)
    schedule_prune()
    {:noreply, %{state | seen_peers: new_seen}}
  end

  # Handle library-specific messages (Libcluster sometimes sends :timeout or :load)
  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end

  # --- Helpers ---

  defp is_already_connected?(list_nodes_fn, target_uuid) do
    case list_nodes_fn.() do
      {:ok, members} -> Enum.member?(members, target_uuid)
      _ -> false
    end
  end

  defp should_throttle?(seen_peers, uuid) do
    case Map.get(seen_peers, uuid) do
      nil -> false
      ts -> (System.monotonic_time(:millisecond) - ts) < @seen_ttl_ms
    end
  end

  defp schedule_prune do
    Process.send_after(self(), :prune_seen_cache, 30_000)
  end

  defp execute_punch(connect_fn, ip, port, uuid) do
    
    # 3. Construct the Modern NodeSpec Map to resolve identity
    # Partisan uses this to route. 


    node_spec = %{
      name: String.to_atom(uuid),
      listen_addrs: [
        %{
          ip: ip,
          port: port
        }
      ],
      # Parallelism defaults to 1 if omitted, but good to be explicit if configured
      channels: %{undefined: %{parallelism: 1}, gossip: %{parallelism: 1}, data: %{parallelism: 2}, control: %{parallelism: 1}} 
    }

    Logger.info("Dojo: Punching #{uuid} at #{inspect(ip)}:#{port}")
    connect_fn.(node_spec)
  rescue
    e -> Logger.warning("Dojo: Connect Error: #{inspect(e)}")
  end
  
  
end
