defmodule Dojo.Cluster.MDNS.Peer do
  @moduledoc """
  A peer as observed by the mDNS engine. Identity + observation lifecycle.

  A peer is born when its DNS response is first parsed, observed across
  poll cycles via POOF tracking, and eventually expires when unresponsive.

      born ──► observed ──► missed(1) ──► missed(2) ──► … ──► stale ──► evicted
                  ▲              │
                  └── refreshed ─┘
  """

  @enforce_keys [:name, :ip, :port]
  defstruct [:name, :ip, :port, seen_at: 0, missed_queries: 0]

  @type t :: %__MODULE__{
          name: atom(),
          ip: :inet.ip4_address(),
          port: non_neg_integer(),
          seen_at: integer(),
          missed_queries: non_neg_integer()
        }

  # ── Lifecycle transitions ────────────────────────────────

  @doc "Born: first observation from a DNS response."
  @spec new(atom(), :inet.ip4_address(), non_neg_integer()) :: t()
  def new(name, ip, port) do
    %__MODULE__{
      name: name,
      ip: ip,
      port: port,
      seen_at: System.monotonic_time(:second),
      missed_queries: 0
    }
  end

  @doc "Refreshed: heard from this cycle. Reset missed counter."
  @spec reset_missed(t()) :: t()
  def reset_missed(%__MODULE__{} = peer), do: %{peer | missed_queries: 0}

  @doc "Missed: a query cycle passed without hearing from this peer."
  @spec miss(t()) :: t()
  def miss(%__MODULE__{} = peer), do: %{peer | missed_queries: peer.missed_queries + 1}

  # ── Predicates ───────────────────────────────────────────

  @doc "Stale? POOF threshold reached — candidate for eviction."
  @spec stale?(t(), non_neg_integer()) :: boolean()
  def stale?(%__MODULE__{missed_queries: m}, threshold), do: m >= threshold

  @doc "Expired? Hard TTL elapsed since last observation."
  @spec expired?(t(), non_neg_integer()) :: boolean()
  def expired?(%__MODULE__{seen_at: seen_at}, ttl) do
    System.monotonic_time(:second) - seen_at >= ttl
  end

  # ── Projection ───────────────────────────────────────────

  @doc "Project to identity tuple (the Discovery boundary type)."
  @spec to_tuple(t()) :: {atom(), :inet.ip4_address(), non_neg_integer()}
  def to_tuple(%__MODULE__{name: n, ip: i, port: p}), do: {n, i, p}
end
