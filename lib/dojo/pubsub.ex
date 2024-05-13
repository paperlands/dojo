defmodule Dojo.PubSub do
  @moduledoc """
    Publish Subscriber Pattern
  """
  alias Phoenix.PubSub

  def subscribe(topic, opts \\ []) do
    PubSub.subscribe(Dojo.PubSub, topic, opts)
  end

  def unsubscribe(topic) do
    PubSub.unsubscribe(Dojo.PubSub, topic)
  end

  def publish({:ok, message}, event, topics) when is_list(topics) do
    topics
    |> Enum.map(fn topic -> publish(message, event, topic) end)

    {:ok, message}
  end

  def publish({:ok, message}, event, topic) do
    PubSub.broadcast(Dojo.PubSub, topic, {__MODULE__, event, message})
    {:ok, message}
  end

  def publish(message, event, topics) when is_list(topics) do
    topics |> Enum.map(fn topic -> publish(message, event, topic) end)
    message
  end

  def publish(message, event, topic) when not is_nil(topic) do
    PubSub.broadcast(Dojo.PubSub, topic, {__MODULE__, event, message})
    message
  end
end
