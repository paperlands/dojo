defmodule Dojo.Cluster.Routing.Local do
  @behaviour Dojo.Cluster.Routing

  @impl true
  def routable_addr do
    "#{Dojo.Cluster.MDNS.get_routable_ipv4_addr() || "localhost"}:#{System.get_env("PORT") || 4000}"
  end

  @impl true
  def asset_path_params, do: ""
end
