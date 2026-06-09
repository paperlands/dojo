defmodule Dojo.Disciple do
  defstruct name: "bruce lee",
            action: "building",
            node: "@localhost",
            meta: nil,
            phx_ref: nil,
            user_id: nil,
            reg_key: nil

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
