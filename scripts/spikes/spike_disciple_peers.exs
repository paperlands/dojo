# Simulated peers at the disciple window.
#
# Injects at the seam the LiveView actually reads — the presence broadcast and
# the hatch signal — so the strip is exercised through its real path
# (`handle_info({:join, "class:shell" <> _, …})`, `update_visible_meta/3`),
# never faked at the template. What this cannot fake, it does not: a fake
# peer's Table is not on any node, so `pull_one_meta` answers nil exactly as it
# would for a peer whose node dropped.
#
#   elixir --sname peerspike --cookie enterthedojo scripts/spikes/spike_disciple_peers.exs \
#     <node> join  <name> <online_at>
#     <node> hatch <name> <success|error> <time>
#     <node> leave <name>
#     <node> list

defmodule PeerSpike do
  @topic "class:shell:PaperLand"

  def reg_key(name), do: @topic <> ":" <> name

  def meta(node, name, online_at) do
    %{
      action: "active",
      name: name,
      node: node,
      reg_key: reg_key(name),
      addr: "localhost:4000",
      online_at: online_at,
      topic: @topic
    }
  end

  def cast(node, msg), do: :rpc.call(node, Phoenix.PubSub, :broadcast, [Dojo.PubSub, @topic, msg])

  def run(node, ["join", name, at]),
    do: cast(node, {:join, @topic, meta(node, name, String.to_integer(at))})

  def run(node, ["leave", name]),
    do: cast(node, {:leave, @topic, Map.put(meta(node, name, 0), :phx_ref, nil)})

  def run(node, ["hatch", name, state, t]) do
    time = String.to_integer(t)

    hatch = %{
      # A real asset with a distinguishing query: the src must resolve, or the
      # template's onerror fallback rewrites it and hides the very change we measure.
      path: "images/turtlehead.png?peer=#{name}&t=#{time}",
      state: String.to_existing_atom(state),
      time: time
    }

    cast(node, {Dojo.PubSub, :hatch, {reg_key(name), {Dojo.Turtle, hatch}}})
  end

  def run(node, ["list"]),
    do: :rpc.call(node, Dojo.Class, :list_disciples, ["shell:PaperLand"])
end

[target | argv] = System.argv()
node = String.to_atom(target)
true = Node.connect(node)

IO.inspect(PeerSpike.run(node, argv), label: List.first(argv))
