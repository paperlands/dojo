defmodule Dojo.Cluster.MDNS.DistAdapter do
  @moduledoc """
  Standard Erlang distribution adapter for mDNS discovery.

  Uses `Node.connect/1` instead of Partisan, enabling testing
  of the mDNS engine without the Partisan dependency. Employs
  `Node.list/0` diffing (à la libcluster) to avoid redundant connects.
  """
  @behaviour Dojo.Cluster.Discovery
  require Logger

  @impl true
  def identity do
    {node(), Application.get_env(:dojo, :dist_port, 9090)}
  end

  @impl true
  def channels, do: %{}

  @impl true
  def on_peers_discovered(peers) do
    connected = MapSet.new(Node.list())

    Enum.each(peers, fn {name, _ip, _port} ->
      unless MapSet.member?(connected, name) do
        case Node.connect(name) do
          true -> :ok
          false -> Logger.debug("[DistAdapter] connect failed: #{name}")
          :ignored -> :ok
        end
      end
    end)

    :ok
  end

  @impl true
  def on_peer_departed(name) do
    Node.disconnect(name)
    :ok
  end

  @impl Dojo.Cluster.Discovery
  def supports_node_monitor?, do: true

  @impl Dojo.Cluster.Discovery
  def diag do
    %{
      identity: identity(),
      node: node(),
      alive: Node.alive?(),
      connected_nodes: Node.list(),
      hidden_nodes: Node.list(:hidden),
      cookie: Node.get_cookie(),
      net_kernel: net_kernel_info(),
      epmd: epmd_info()
    }
  end

  defp net_kernel_info do
    case Process.whereis(:net_kernel) do
      nil ->
        %{status: :not_running}

      pid ->
        %{
          status: :running,
          pid: pid,
          dist_listen: safe(fn -> :net_kernel.get_state() end)
        }
    end
  end

  defp epmd_info do
    safe(fn ->
      {:ok, hostname} = :inet.gethostname()

      case :erl_epmd.names(hostname) do
        {:ok, names} ->
          Enum.map(names, fn {name, port} -> %{name: to_string(name), port: port} end)

        {:error, reason} ->
          {:error, reason}
      end
    end)
  end

  defp safe(fun) do
    fun.()
  rescue
    e -> {:error, Exception.message(e)}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end
end
