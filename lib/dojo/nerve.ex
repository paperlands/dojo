defmodule Dojo.Nerve do
  @moduledoc """
  Global signal broadcast — stateless, no process.

  Every signal is a map with the iconic form:
    %{msg, payload, target, source, kind, ts}

  Channels mirror the JS vocabulary:
    error, system, output, chat, eval, shout
  """

  def signal(clan, msg, payload, target, source, kind) do
    %{
      msg: msg,
      payload: payload,
      target: target,
      source: source,
      kind: kind,
      ts: System.monotonic_time(:millisecond)
    }
    |> then(&Dojo.PubSub.publish(&1, :nerve, topic(clan)))
  end

  def chat(clan, source, target, body),
    do: signal(clan, body, nil, target, source, "chat")

  def system(clan, msg, detail),
    do: signal(clan, msg, detail, nil, "system", "system")

  def error(clan, msg, detail),
    do: signal(clan, msg, detail, nil, "system", "error")

  def output(clan, msg, detail),
    do: signal(clan, msg, detail, nil, "system", "output")

  def shout(clan, source, msg, payload),
    do: signal(clan, msg, payload, nil, source, "shout")

  def eval(clan, source, msg, payload),
    do: signal(clan, msg, payload, nil, source, "eval")

  def subscribe(clan), do: Dojo.PubSub.subscribe(topic(clan))

  defp topic(clan), do: "nerve:" <> clan
end
