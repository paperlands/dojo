defmodule Dojo.Cluster.Discovery do
  @moduledoc "Behaviour for cluster transport adapters."

  @doc "Return the node's identity: `{name_atom, port}`."
  @callback identity() :: {atom(), non_neg_integer()}

  @doc "Return the channel specification for node_spec building (or empty map)."
  @callback channels() :: map()

  @doc "Called with a list of discovered `{name, ip, port}` tuples each cycle."
  @callback on_peers_discovered([{atom(), :inet.ip4_address(), non_neg_integer()}]) :: :ok

  @doc "Called when a peer sends a goodbye."
  @callback on_peer_departed(atom()) :: :ok

  @doc "Whether the adapter supports ERTS `Node.monitor/2` for reactive failover."
  @callback supports_node_monitor?() :: boolean()

  @doc "Return transport-layer diagnostic state (connections, views, config)."
  @callback diag() :: map()

  @optional_callbacks [supports_node_monitor?: 0, diag: 0]
end
