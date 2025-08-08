defmodule Dojo.Room do
  alias Dojo.Cache

  @ttl 6
  def get_leaderboard!(topic) do
    case Cache.get({__MODULE__, :leaderboard, topic}) do
      nil ->
        Cache.put({__MODULE__, :leaderboard, topic}, %{}, ttl: :timer.hours(@ttl))
        %{}

      leaderboard ->
        leaderboard
    end
  end

  def add_leaderboard!(topic, name) do
    case Cache.get({__MODULE__, :leaderboard, topic}) do
      nil ->
        map = Map.new([{name, %{count: 1, history: [{time_now(), 1}]}}])
        Cache.put({__MODULE__, :leaderboard, topic}, map, ttl: :timer.hours(@ttl))
        map

      %{^name => %{count: c, history: ts}} = leaderboard when is_list(ts) ->
        map = Map.put(leaderboard, name, %{count: c + 1, history: [{time_now(), 1} | ts]})
        Cache.put({__MODULE__, :leaderboard, topic}, map, ttl: :timer.hours(@ttl))
        map

      leaderboard when is_map(leaderboard) ->
        map = Map.put(leaderboard, name, %{count: 1, history: [{time_now(), 1}]})
        Cache.put({__MODULE__, :leaderboard, topic}, map, ttl: :timer.hours(@ttl))
        map
    end
  end

  defp time_now() do
    (System.os_time() / 1_000_000_000) |> floor
  end
end
