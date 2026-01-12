defmodule Dojo.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    
    topologies = [
      dojo_mesh: [
        strategy: Dojo.Cluster,
        config: [
          # Pass the Partisan functions so the strategy can call them
          connect: &:partisan_peer_service.join/1,
          list_nodes: &:partisan_peer_service.members/0,
          # Custom mDNS Service Name to avoid collisions
          service_name: "dojo_cluster" 
        ]
      ]
    ]
        
    children = [
      DojoWeb.Telemetry,
      # 3. The Cluster Supervisor (Libcluster)
      # This starts the "Polyglot" strategy which immediately begins
      # scanning mDNS/BLE using the UUID from step 1.
      {Cluster.Supervisor, [topologies, [name: Dojo.ClusterSupervisor]]},
      {Phoenix.PubSub, name: Dojo.PubSub, adapter: Phoenix.PubSub.Partisan},
      # Dojo.Repo,
      {DNSCluster, query: Application.get_env(:dojo, :dns_cluster_query) || :ignore},
      {Dojo.Gate,
       [
         name: Dojo.Gate,
         pubsub_server: Dojo.PubSub,
         pool_size: :erlang.system_info(:schedulers_online)
       ]},
      # Start the Finch HTTP client for sending emails
      {Finch, name: Dojo.Finch},
      Dojo.Cache,
      {Task.Supervisor, name: Dojo.TaskSupervisor},
      {PartitionSupervisor, child_spec: DynamicSupervisor, name: Dojo.Class},
      Dojo.Discovery.Scanner,
      # Start a worker by calling: Dojo.Worker.start_link(arg)
      # {Dojo.Worker, arg},
      # Start to serve requests, typically the last entry
      DojoWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Dojo.Supervisor]

    # register the kinos
    # Kino.SmartCell.register(DojoKino.Incognito)
    #
    DojoCLI.Boot.display()

    # 2. Start the main supervision tree
    # This blocks until all children are started synchronously
    case Supervisor.start_link(children, opts) do
      {:ok, pid} ->
        # 3. Execute Post-Start Hook
        # We use start_child (fire-and-forget) so we don't block.
        # It is supervised, so we get better error logging if it crashes.
        Task.Supervisor.start_child(Dojo.TaskSupervisor, &post_start_hook/0)

        {:ok, pid}

      error ->
        error
    end

    #Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    DojoWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  # Encapsulate the logic in a private function for cleanliness
  defp post_start_hook do
    # You might want a small sleep if you need to wait for external systems,
    # but usually, since the Supervisor started the children, they are ready.
    uuid = System.get_env("PARTISAN_NAME")
      
    # Add the real service with dynamic UUID
    MdnsLite.add_mdns_service(%{
      id: :dojo_cluster,
      protocol: "dojo_cluster",
      transport: "tcp",
      port: String.to_integer(System.get_env("PARTISAN_PORT")), 
      txt_payload: %{uuid: uuid}
    })
    
    # Optional: Log that the hook completed
    require Logger
    Logger.info("Post-start hook completed: MDNS service updated for UUID #{uuid}")
  end
end
