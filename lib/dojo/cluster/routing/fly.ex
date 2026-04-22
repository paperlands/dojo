defmodule Dojo.Cluster.Routing.Fly do
  @behaviour Dojo.Cluster.Routing

  @impl true
  def routable_addr do
    System.get_env("FLY_APP_NAME", "localhost") <> ".fly.dev"
  end

  @impl true
  def asset_path_params do
    case System.get_env("FLY_MACHINE_ID") do
      nil -> ""
      id -> "&fly_instance_id=#{id}"
    end
  end
end
