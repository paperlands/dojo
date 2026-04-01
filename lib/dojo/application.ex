defmodule Dojo.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    if Application.get_env(:dojo, :silence_partisan_logs, false) do
      :logger.set_application_level(:partisan, :warning)
    end

    adapter = Application.get_env(:dojo, :cluster_adapter, Dojo.Cluster.MDNS.PartisanAdapter)

    children = [
      DojoWeb.Telemetry,
      # 3. The Cluster Supervisor (Libcluster)
      # This starts the "Polyglot" strategy which immediately begins
      # scanning mDNS/BLE using the UUID from step 1.
      # {Cluster.Supervisor, [topologies, [name: Dojo.ClusterSupervisor]]},
      {Registry, keys: :unique, name: Dojo.TableRegistry},
      # TaskSupervisor must start before PubSub — the Partisan PubSub handler
      # dispatches local delivery via TaskSupervisor.start_child
      {Task.Supervisor, name: Dojo.TaskSupervisor},
      %{
        id: Dojo.PubSub.Supervisor,
        type: :supervisor,
        start:
          {Supervisor, :start_link,
           [
             [
               {Phoenix.PubSub, name: Dojo.PubSub, adapter: Phoenix.PubSub.Partisan},
               {Dojo.Gate,
                name: Dojo.Gate, pubsub_server: Dojo.PubSub, pool_size: System.schedulers_online()}
             ],
             [strategy: :one_for_all]
           ]}
      },
      # Dojo.Repo,
      {DNSCluster, query: Application.get_env(:dojo, :dns_cluster_query) || :ignore},
      # Start the Finch HTTP client for sending emails
      {Finch, name: Dojo.Finch},
      Dojo.Cache,
      {PartitionSupervisor, child_spec: DynamicSupervisor, name: Dojo.Class},
      # Start a worker by calling: Dojo.Worker.start_link(arg)
      # {Dojo.Worker, arg},
      # Start to serve requests, typically the last entry
      DojoWeb.Endpoint,
      {Dojo.Cluster.MDNS, adapter: adapter, poll_interval: 5_000},
      Dojo.Cluster.NetworkMonitor
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Dojo.Supervisor]

    # register the kinos
    # Kino.SmartCell.register(DojoKino.Incognito)

    # 2. Start the main supervision tree
    # This blocks until all children are started synchronously
    case Supervisor.start_link(children, opts) do
      {:ok, pid} ->
        # 3. Execute Post-Start Hook after the endpoint is bound and ready.
        # Browser open happens here so we don't race against port binding.
        Task.Supervisor.start_child(Dojo.TaskSupervisor, &post_start_hook/0)

        {:ok, pid}

      error ->
        error
    end

    # Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def prep_stop(state) do
    # Disable the discovery agent first — this synchronously waits for any
    # in-flight lookup/2 to finish, then prevents further lookups.
    # Without this, a lookup could send a TTL=120 announcement immediately
    # after our TTL=0 goodbye, undoing it.
    try do
      :partisan_peer_discovery_agent.disable()
    catch
      _, _ -> :ok
    end

    Dojo.Cluster.MDNS.goodbye()
    state
  end

  @impl true
  def config_change(changed, _new, removed) do
    DojoWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  defp post_start_hook do
    # Endpoint is bound by the time this task runs, so the browser won't race.
    DojoCLI.Boot.display()
  end
end
