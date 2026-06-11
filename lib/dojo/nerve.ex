defmodule Dojo.Nerve do
  @moduledoc """
  Global signal broadcast — stateless, no process.

  The Elixir mirror of the ONE envelope (`assets/js/nerve/store.js`):

      %{msg, payload, target, source, kind, ts, received_at}

  THE CLOCK LAW (groundwork.org gw-t-clock, Phase 3): `ts` belongs to the
  SOURCE and is never overwritten at a boundary. A signal arriving from a
  client carries that client's clock; this adapter ANNOTATES `received_at`
  (the server's clock at the seam) and nothing else. A signal the server
  itself originates (system join/leave) is its own source, so the server
  clock IS `ts` there. Ordering across peers is per-source FIFO; global
  order is honestly partial.

  Channels mirror the JS vocabulary: error, system, output, chat, eval, shout.
  """

  @doc """
  Publish one envelope. `ts` is the source's clock — pass it through from
  whoever emitted the signal; `nil` means "the server is the source" and
  stamps its own clock as `ts`.
  """
  def signal(clan, msg, payload, target, source, kind, ts \\ nil) do
    now = System.monotonic_time(:millisecond)

    %{
      msg: msg,
      payload: payload,
      target: target,
      source: source,
      kind: kind,
      ts: ts || now,
      received_at: now
    }
    |> then(&Dojo.PubSub.publish(&1, :nerve, topic(clan)))
  end

  def chat(clan, source, target, body, ts \\ nil),
    do: signal(clan, body, nil, target, source, "chat", ts)

  def system(clan, msg, detail),
    do: signal(clan, msg, detail, nil, "system", "system")

  def error(clan, msg, detail),
    do: signal(clan, msg, detail, nil, "system", "error")

  def output(clan, msg, detail),
    do: signal(clan, msg, detail, nil, "system", "output")

  def shout(clan, source, msg, payload, ts \\ nil),
    do: signal(clan, msg, payload, nil, source, "shout", ts)

  def eval(clan, source, msg, payload, ts \\ nil),
    do: signal(clan, msg, payload, nil, source, "eval", ts)

  def subscribe(clan), do: Dojo.PubSub.subscribe(topic(clan))

  defp topic(clan), do: "nerve:" <> clan
end
