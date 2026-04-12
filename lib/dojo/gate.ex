defmodule Dojo.Gate do
  use Phoenix.Tracker
  require Logger

  # disciple tracker ::: quis custodiet ipsos custodes

  def start_link(opts) do
    opts = Keyword.merge([name: __MODULE__], opts)
    Phoenix.Tracker.start_link(__MODULE__, opts, opts)
  end

  def init(opts) do
    server = Keyword.fetch!(opts, :pubsub_server)
    {:ok, %{pubsub_server: server, node_name: Phoenix.PubSub.node_name(server)}}
  end

  def handle_diff(diff, state) do
    # Inline delivery: direct_broadcast! sends to local Handler via send/2, non-blocking.
    # Previous Task.Supervisor wrapper removed backpressure — under load, unbounded
    # tasks accumulated. Inline gives natural backpressure to the Tracker shard.
    for {topic, {joins, leaves}} <- diff do
      for {key, meta} <- joins do
        Logger.info(
          "[LC] Gate.handle_diff JOIN topic=#{topic} key=#{key} " <>
            "node=#{inspect(meta[:node])} name=#{meta[:name]}"
        )

        Phoenix.PubSub.direct_broadcast!(
          state.node_name,
          state.pubsub_server,
          topic,
          {:join, topic, Map.put(meta, :topic, topic)}
        )
      end

      for {key, meta} <- leaves do
        Logger.info(
          "[LC] Gate.handle_diff LEAVE topic=#{topic} key=#{key} " <>
            "node=#{inspect(meta[:node])} name=#{meta[:name]}"
        )

        Phoenix.PubSub.direct_broadcast!(
          state.node_name,
          state.pubsub_server,
          topic,
          {:leave, topic, Map.put(meta, :topic, topic)}
        )
      end
    end

    {:ok, state}
  end

  def track(pid, topic, %Dojo.Disciple{name: username, action: state, node: node}) do
    addr = routable_addr()

    case Phoenix.Tracker.track(__MODULE__, pid, topic, username, %{
           action: state,
           name: username,
           node: node,
           addr: addr,
           online_at: System.os_time(:second)
         }) do
      {:ok, _ref} = resp ->
        resp

      {:error, {:already_tracked, _, _, _}} ->
        Phoenix.Tracker.update(__MODULE__, pid, topic, username, %{
          action: state,
          name: username,
          node: node,
          addr: addr,
          online_at: System.os_time(:second)
        })
    end
  end

  def get_by_key(topic, key) do
    Phoenix.Tracker.get_by_key(__MODULE__, topic, key)
  end

  def change(pid, topic, username, {key, value}) do
    Phoenix.Tracker.update(__MODULE__, pid, topic, username, fn meta ->
      Map.put(meta, key, value)
    end)
  end

  def list(topic, timeout \\ 5000) do
    __MODULE__
    |> Phoenix.Tracker.Shard.name_for_topic(topic, pool_size())
    |> GenServer.call({:list, topic}, timeout)
    |> Phoenix.Tracker.State.get_by_topic(topic)
  end

  def list_users(topic),
    do: Enum.map(list(topic), fn {_k, meta} -> Map.put(meta, :topic, topic) end)

  defp pool_size() do
    [{:pool_size, size}] = :ets.lookup(__MODULE__, :pool_size)
    size
  end

  @doc """
  Diagnostic: dump Tracker state for a topic.
  Call from iex: `Dojo.Gate.lc_dump("class:shell:PaperLand")`
  """
  def lc_dump(topic \\ "class:shell:PaperLand") do
    entries = list(topic)

    Logger.info(
      "[LC] Gate.lc_dump topic=#{topic} count=#{length(entries)} " <>
        "entries=#{inspect(Enum.map(entries, fn {key, meta} -> {key, meta[:name], meta[:node], meta[:addr]} end))}"
    )

    entries
  end

  defp routable_addr do
    :persistent_term.get({__MODULE__, :addr}, Dojo.Cluster.Routing.routable_addr())
  end
end
