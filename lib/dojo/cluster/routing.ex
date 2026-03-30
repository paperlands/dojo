defmodule Dojo.Cluster.Routing do
  @moduledoc """
  Behaviour for constructing routable addresses and asset URLs.

  Two strategies:
  - `Local` — mDNS discovery, direct IP:port addressing
  - `Fly`   — Fly.io proxy, dynamic request routing via fly-replay
  """

  @callback routable_addr() :: String.t()
  @callback asset_path_params() :: String.t()

  def impl do
    Application.get_env(:dojo, :routing_strategy, Dojo.Cluster.Routing.Local)
  end

  def routable_addr, do: impl().routable_addr()

  @doc """
  Extra query params to append to asset paths for routing.
  Returns empty string for local, `&fly_instance_id=...` for Fly.
  """
  def asset_path_params, do: impl().asset_path_params()
end
