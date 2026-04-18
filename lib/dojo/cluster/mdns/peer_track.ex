defmodule Dojo.Cluster.MDNS.PeerTrack do
  @moduledoc """
  Connection tracking for a peer. The adapter's side of the relationship.

  Tracks TCP connection health per peer and drives eviction decisions.
  Stored in ETS as tuples; this struct is the lifecycle interface.

      discovered ──► active(since, 0)
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
         connected   in_grace    failing(n+1)
         reset→0     (wait)      n ≥ max?
                                    │
                            evicted(since)
                                    │
                            cooldown elapsed?
                                    │
                               deleted → re-discoverable
  """

  defstruct [:name, :status, :since, failures: 0]

  @type status :: :active | :evicted
  @type t :: %__MODULE__{
          name: atom(),
          status: status(),
          since: integer(),
          failures: non_neg_integer()
        }

  # ── Lifecycle transitions ────────────────────────────────

  @spec new(atom()) :: t()
  def new(name) do
    %__MODULE__{name: name, status: :active, since: now(), failures: 0}
  end

  @spec reset(t()) :: t()
  def reset(%__MODULE__{} = t), do: %{t | failures: 0}

  @spec fail(t()) :: t()
  def fail(%__MODULE__{} = t), do: %{t | failures: t.failures + 1}

  @spec evict(t()) :: t()
  def evict(%__MODULE__{} = t) do
    %{t | status: :evicted, since: now(), failures: 0}
  end

  # ── Predicates ───────────────────────────────────────────

  @spec in_grace?(t(), non_neg_integer()) :: boolean()
  def in_grace?(%__MODULE__{status: :active, since: s}, grace_s), do: now() - s < grace_s
  def in_grace?(_, _), do: false

  @spec max_failures?(t(), non_neg_integer()) :: boolean()
  def max_failures?(%__MODULE__{failures: f}, max), do: f >= max

  @spec cooldown_elapsed?(t(), non_neg_integer()) :: boolean()
  def cooldown_elapsed?(%__MODULE__{status: :evicted, since: s}, cooldown_s) do
    now() - s >= cooldown_s
  end

  def cooldown_elapsed?(_, _), do: false

  # ── ETS serialization ───────────────────────────────────

  @spec to_ets(t()) :: tuple()
  def to_ets(%__MODULE__{name: n, status: :active, since: s, failures: f}), do: {n, s, f}
  def to_ets(%__MODULE__{name: n, status: :evicted, since: s}), do: {n, :evicted, s}

  @spec from_ets(tuple()) :: t()
  def from_ets({name, :evicted, since}) do
    %__MODULE__{name: name, status: :evicted, since: since}
  end

  def from_ets({name, since, failures}) do
    %__MODULE__{name: name, status: :active, since: since, failures: failures}
  end

  defp now, do: System.monotonic_time(:second)
end
