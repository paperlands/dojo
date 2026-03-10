defmodule Cluster.Strategy.MDNS.Partisan do
  @moduledoc """
  libcluster callback adapter for Partisan, tuned for the HyParView topology
  manager and UUID-based node identity.

  ## Identity model

  Partisan names in this deployment are `admin@<uuid>` — not `basename@ip`.
  They are generated once at boot, written to `PARTISAN_NAME` env, and must
  remain stable for the lifetime of the OS process (roaming changes IP, not
  the UUID identity).

   Identity model uses UUIDs, not IPs. The mDNS layer is the IP-discovery plane. Partisan's TCP acceptor just needs to accept from anywhere.
   ```
   UUID identity:  admin@550e8400-...        ← stable, survives roaming
   mDNS:           announces current IP      ← dynamic, per-interface
   Partisan TCP:   binds 0.0.0.0:PORT        ← accepts on whatever IP arrives
   ```


  ## HyParView semantics

  With `peer_service_manager: :partisan_hyparview_peer_service_manager`:

  - `:partisan.join/1` introduces a *contact node* that bootstraps the join
    protocol. HyParView then fills the smaller active view and passive view autonomously via shuffle rounds.
  - We must NOT aggressively `leave/1` nodes based on mDNS TTL expiry alone.
    HyParView's phi-accrual detector (threshold 12.0, gossip every 1 s) will
    handle real failures far more accurately. We only explicitly disconnect
    on goodbye packets (TTL = 0) or full interface roam.
  - `nodes/0` reads from `partisan_peer_service` to return the actual
    HyParView membership, not just "things we tried to join".

  ## Return-value normalisation

  libcluster's `connect_nodes/4` case-matches only `true | false | :ignored`.
  Partisan returns `:ok | {:error, reason}`. We normalise here.

  | Partisan return                  | Adapter returns | Rationale                        |
  |----------------------------------|-----------------|----------------------------------|
  | `:ok`                            | `true`          | Connected                        |
  | `{:error, :already_connected}`   | `true`          | Idempotent — already up          |
  | `{:error, :not_yet_connected}`   | `:ignored`      | Handshake in flight              |
  | `{:error, :self}`                | `:ignored`      | Self-join, should not reach here |
  | `{:error, :unknown_peer}`        | `:ignored`      | HyParView hasn't seen it yet     |
  | `{:error, _other}`               | `false`         | Hard failure                     |
  """

  require Logger

  ##############################################################################
  # libcluster callbacks
  ##############################################################################

  @doc """
  Introduce `node_spec` to Partisan. Returns `true | false | :ignored`.

  With HyParView, `:ok` means the join protocol was *initiated*, not that the
  node is immediately in the active view. Subsequent polls will find it via
  `nodes/0` once HyParView completes the handshake.
  """
  @spec connect(map() | atom()) :: true | false | :ignored
  def connect(%{name: name, listen_addrs: _} = node_spec) do
    case :partisan.join(node_spec) do
      :ok                           -> true
      {:error, :already_connected}  -> true
      {:error, :not_yet_connected}  -> :ignored
      {:error, :self}               -> :ignored
      # HyParView fires this during view churn — not a real error
      {:error, :unknown_peer}       -> :ignored
      {:error, reason} ->
        Logger.warning(
          "[mDNS/Partisan] join failed for #{inspect(name)}: #{inspect(reason)}"
        )
        false
    end
  end

  # Fallback for plain Erlang dist (no Partisan)
  def connect(node) when is_atom(node) do
    case :net_kernel.connect_node(node) do
      true     -> true
      false    -> false
      :ignored -> :ignored
    end
  end

  @doc """
  Remove `node_spec` from Partisan membership.

  With HyParView we check whether the node is currently in the *active view*
  before calling `leave`. If it is, we skip — HyParView's phi-accrual will
  evict it on its own timeline. We only force-leave nodes that are already in
  the passive view or not known at all (i.e. safe to drop).
  """
  @spec disconnect(map() | atom()) :: true | false | :ignored
  def disconnect(%{name: name} = node_spec) do
    if in_active_view?(name) do
      # Let HyParView handle it — phi threshold 12.0 with 1 s gossip
      Logger.debug(
        "[mDNS/Partisan] skipping disconnect for #{inspect(name)} — in HyParView active view"
      )
      :ignored
    else
      do_leave(node_spec)
    end
  end

  def disconnect(node) when is_atom(node) do
    :erlang.disconnect_node(node)
    true
  end

  @doc """
  Return the current HyParView membership as a list of node name atoms.

  Uses `partisan_peer_service.members/0` which returns the authoritative
  membership set from whichever peer_service_manager is configured.
  Falls back to `partisan.nodes/0` if the peer service call fails.
  """
  @spec nodes() :: [atom()]
  def nodes() do
    case :partisan_peer_service.members() do
      {:ok, members} ->
        members
        |> Enum.map(fn
          %{name: n} -> n
          n when is_atom(n) -> n
        end)
        |> Enum.reject(&(&1 == own_name()))

      _ ->
        :partisan.nodes()
    end
  rescue
    _ -> []
  end

  ##############################################################################
  # node_spec builder
  ##############################################################################

  @doc """
  Build a Partisan `node_spec` for a discovered peer.

  The `ip` MUST be the mDNS-discovered routable address. Do NOT use the peer's
  own `listen_addrs` config — that is bound to loopback (`{127,0,0,1}`) in
  this deployment. The port comes from the peer's `partisan_port` TXT record.

  iex> build_node_spec(:"admin@some-uuid", {192,168,1,5}, 53580)
  %{
  name:         :"admin@some-uuid",
  listen_addrs: [%{ip: {192, 168, 1, 5}, port: 53580}],
  channels:     [:gossip, :undefined, :data, :control]
  }
  """
  @spec build_node_spec(atom(), :inet.ip4_address(), non_neg_integer()) :: map()
  def build_node_spec(name, ip, port) do
    %{
      name:         name,
      listen_addrs: [%{ip: ip, port: port}],
      channels:     channels_spec()        # ← map, not list
    }
  end
  @doc """
  Our own Partisan node name atom.

  Resolution order:
  1. `PARTISAN_NAME` environment variable (set at boot alongside port derivation)
  2. `Application.get_env(:partisan, :name)`
  3. `node()` (Erlang distribution fallback)
  """
  @spec own_name() :: atom()
  def own_name do
    case System.get_env("PARTISAN_NAME") do
      s when is_binary(s) and s != "" -> String.to_atom(s)
      _                               -> Application.get_env(:partisan, :name, node())
    end
  end

  @doc """
  The Partisan peer port for THIS node.

  Resolution order:
  1. `PARTISAN_PORT` environment variable (`53627 - :rand.uniform(100)` at boot)
  2. `:partisan_config.get(:peer_port)` (if Partisan already started)
  3. `default`
  """
  @spec own_port(non_neg_integer()) :: non_neg_integer()
  def own_port(default \\ 9090) do
    env_port() || partisan_config_port() || default
  end

  ##############################################################################
  # Private
  ##############################################################################

  defp do_leave(node_spec) do
    case :partisan.leave() do
      :ok                          -> true
      {:error, :not_connected}     -> true
      {:error, :not_yet_connected} -> :ignored
      {:error, reason} ->
        Logger.warning(
          "[mDNS/Partisan] leave failed for #{inspect(node_spec.name)}: #{inspect(reason)}"
        )
        false
    end
  end

  # True if `name` is in HyParView's active view.
  # Active view = the peers Partisan is currently maintaining heartbeats with.
  # Default to true on error — safer to skip a disconnect than force one.
  defp in_active_view?(name) do
    case :partisan_peer_service.members() do
      {:ok, members} ->
        Enum.any?(members, fn
          %{name: n} -> n == name
          n          -> n == name
        end)

      _ ->
        true
    end
  rescue
    _ -> true
  end

  @doc """
  Returns the full channels map suitable for a Partisan node_spec.

  Partisan 5.x peer_service_manager expects:
  %{channel_atom => %{monotonic: bool, parallelism: pos_integer, ...}}

  We read directly from Application config (which IS that map) and guarantee
  :gossip is always present — HyParView bootstraps over it.
  """
  @spec channels_spec() :: %{atom() => map()}
  def channels_spec do
    base =
      case Application.get_env(:partisan, :channels) do
        map when is_map(map) and map_size(map) > 0 ->
          map

        list when is_list(list) and length(list) > 0 ->
          # Legacy list form — promote to minimal opts maps
          Map.new(list, fn ch -> {ch, %{monotonic: false, parallelism: 1, compression: false}} end)

        _ ->
          %{}
      end

    # Guarantee :gossip is always present — required by HyParView
    Map.put_new(base, :gossip, %{monotonic: false, parallelism: 1, compression: false})
  end

  defp env_port do
    case System.get_env("PARTISAN_PORT") do
      s when is_binary(s) ->
        case Integer.parse(s) do
          {n, ""} when n > 0 and n < 65536 -> n
          _                                -> nil
        end
      _ -> nil
    end
  end

  defp partisan_config_port do
    case :partisan_config.get(:peer_port) do
      n when is_integer(n) and n > 0 -> n
      _                              -> nil
    end
  rescue
    _ -> nil
  end
end
