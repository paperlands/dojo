defmodule Dojo.Gate do
  use Phoenix.Tracker

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
    for {topic, {joins, leaves}} <- diff do
      for {_key, meta} <- joins do
        Task.start(fn ->
          msg = {:join, topic, Map.put(meta, :topic, topic)}
          # each tracker takes care of its own node
          Phoenix.PubSub.direct_broadcast!(state.node_name, state.pubsub_server, topic, msg)
        end)
      end

      for {_key, meta} <- leaves do
        Task.start(fn ->
          msg = {:leave, topic, Map.put(meta, :topic, topic)}
          Phoenix.PubSub.direct_broadcast!(state.node_name, state.pubsub_server, topic, msg)
        end)
      end
    end

    {:ok, state}
  end

  def track(pid, topic, %Dojo.Disciple{name: username, action: state, node: node}) do
    case Phoenix.Tracker.track(__MODULE__, pid, topic, username, %{
           action: state,
           name: username,
           node: node,
           online_at: System.os_time(:second)
         }) do
      {:ok, _ref} = resp ->
        resp

      {:error, {:already_tracked, _, _, _}} ->
        Phoenix.Tracker.update(__MODULE__, pid, topic, username, %{
          action: state,
          name: username,
          node: node,
          online_at: System.os_time(:second)
        })
    end
  end

  def get_by_key(topic, key) do
    Phoenix.Tracker.get_by_key(__MODULE__, topic, key)
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
end
