defmodule Dojo.Test.ClusterCase do
  @moduledoc """
  ExUnit case template for multi-node mDNS tests.

  Tags tests with `:clustered` so they can be excluded from normal runs:

      mix test --exclude clustered    # skip these
      mix test --only clustered       # run only these
  """

  defmacro __using__(opts \\ []) do
    quote do
      use ExUnit.Case, unquote(opts)
      import unquote(__MODULE__)
      @moduletag :clustered
    end
  end

  @doc """
  Poll `func` every `interval` ms until it returns truthy or `timeout` expires.
  Flunks the test if the condition is never met.
  """
  def assert_eventually(func, timeout \\ 15_000, interval \\ 500) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_poll(func, deadline, interval)
  end

  defp do_poll(func, deadline, interval) do
    if func.() do
      :ok
    else
      remaining = deadline - System.monotonic_time(:millisecond)

      if remaining <= 0 do
        ExUnit.Assertions.flunk("Condition not met within timeout")
      else
        Process.sleep(min(interval, remaining))
        do_poll(func, deadline, interval)
      end
    end
  end

  @doc "Get `Node.list()` on a remote peer (by peer pid)."
  def remote_node_list(peer) do
    :peer.call(peer, Node, :list, [])
  end

  @doc "Get mDNS cached peers on a remote peer (by peer pid)."
  def remote_cached_peers(peer) do
    :peer.call(peer, Dojo.Cluster.MDNS, :cached_peers, [])
  end

  @doc "Assert that `target` node is evicted from `peer`'s cache within `timeout` ms."
  def assert_evicted(peer, target, timeout \\ 15_000) do
    assert_eventually(
      fn ->
        not Enum.any?(remote_cached_peers(peer), fn {name, _, _} -> name == target end)
      end,
      timeout
    )
  end

  @doc "Assert that `target` node is discovered in `peer`'s cache within `timeout` ms."
  def assert_discovered(peer, target, timeout \\ 15_000) do
    assert_eventually(
      fn ->
        Enum.any?(remote_cached_peers(peer), fn {name, _, _} -> name == target end)
      end,
      timeout
    )
  end
end
