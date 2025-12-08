defmodule Dojo.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    
    children = [
      DojoWeb.Telemetry,
      # Dojo.Repo,
      {DNSCluster, query: Application.get_env(:dojo, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Dojo.PubSub},
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

    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    DojoWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
