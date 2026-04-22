defmodule Dojo.Cluster.Discovery do
  @moduledoc "Behaviour for cluster transport adapters."

  @typedoc "Peer identity as discovered on the network: `{name, ip, port}`."
  @type peer :: {atom(), :inet.ip4_address(), non_neg_integer()}

  @typedoc "Partisan-format node specification (adapters construct these for `:partisan_peer_service`)."
  @type node_spec :: %{
          name: atom(),
          listen_addrs: [%{ip: :inet.ip4_address(), port: non_neg_integer()}],
          channels: map()
        }

  @doc "Return the node's identity: `{name_atom, port}`."
  @callback identity() :: {atom(), non_neg_integer()}

  @doc "Return the channel specification for node_spec building (or empty map)."
  @callback channels() :: map()

  @doc "Called with a list of discovered peers each cycle."
  @callback on_peers_discovered([peer()]) :: :ok

  @doc "Called when a peer sends a goodbye."
  @callback on_peer_departed(atom()) :: :ok

  @doc "Whether the adapter supports ERTS `Node.monitor/2` for reactive failover."
  @callback supports_node_monitor?() :: boolean()

  @doc "Return transport-layer diagnostic state (connections, views, config)."
  @callback diag() :: map()

  @optional_callbacks [supports_node_monitor?: 0, diag: 0]
end
