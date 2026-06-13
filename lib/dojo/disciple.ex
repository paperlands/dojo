defmodule Dojo.Disciple do
  defstruct name: "bruce lee",
            action: "building",
            node: "@localhost",
            meta: nil,
            phx_ref: nil,
            user_id: nil,
            reg_key: nil

  @type t :: %__MODULE__{
          name: String.t(),
          action: String.t(),
          # `node`, `meta`, `user_id` cross the presence / rolling-deploy seam:
          # `node` is a display string, a partisan node atom, OR the legacy
          # `{reg_key, node}` tuple older peers embedded (see table_address/1).
          # Left wide on purpose — these are dynamic-boundary values the checker
          # cannot see across the network, and contorting them would be noise.
          node: term(),
          meta: term(),
          phx_ref: binary() | nil,
          user_id: term(),
          reg_key: String.t() | nil
        }

  @doc """
  The disciple's registry key from presence meta. Tolerant of legacy metas
  from older nodes where it rode embedded inside the node tuple (rolling
  deploys — same idiom as the hatch_version legacy clause).
  """
  def reg_key(%{reg_key: rk}) when is_binary(rk), do: rk
  def reg_key(%{node: {rk, _node}}), do: rk

  @doc """
  Where the disciple's Table lives: `{reg_key, partisan_node}` — the RPC
  address consumed by `Dojo.Table.last/2` and `last_meta/2`. One composition
  rule; call sites never assemble the pair by hand.
  """
  def table_address(%{reg_key: rk, node: node}) when is_binary(rk), do: {rk, node}
  def table_address(%{node: {rk, node}}), do: {rk, node}
end
