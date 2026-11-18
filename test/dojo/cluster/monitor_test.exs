defmodule Dojo.Cluster.MonitorTest do
  @moduledoc """
  The network monitor's change policy, tested as a pure decision.

  Two facts can change independently: the set of routable IPs that the Partisan
  listeners bind to, and the HTTP endpoint the node advertises to peers. A set
  comparison alone misses the second — interface order can flip
  `Routing.routable_addr/0` while the set is identical, and then no event fires
  and presence keeps advertising the old endpoint forever.
  """
  use ExUnit.Case, async: true

  alias Dojo.Cluster.NetworkMonitor

  @a {192, 168, 1, 12}
  @b {10, 0, 0, 7}
  @addr_a "192.168.1.12:4000"
  @addr_b "10.0.0.7:4000"

  describe "transition/4" do
    test "same set, same address is no change" do
      assert NetworkMonitor.transition([@a], @addr_a, [@a], @addr_a) == :none
    end

    test "a reordered set with an unchanged address is no change" do
      # MapSet semantics: order carries no information on its own.
      assert NetworkMonitor.transition([@a, @b], @addr_a, [@b, @a], @addr_a) == :none
    end

    test "a reordered set that flips the selected address is an address-only change" do
      # The hole: identical IPs, different first element, so routable_addr/0 moves.
      assert NetworkMonitor.transition([@a, @b], @addr_a, [@b, @a], @addr_b) == :addr_only
    end

    test "a changed address with the same sockets never rebinds" do
      assert NetworkMonitor.transition([@a], @addr_a, [@a], @addr_b) == :addr_only
    end

    test "an address becoming known for the first time is an address-only change" do
      assert NetworkMonitor.transition([@a], nil, [@a], @addr_a) == :addr_only
    end

    test "a different set with a different address is a rebind" do
      assert NetworkMonitor.transition([@a], @addr_a, [@b], @addr_b) == :rebind
    end

    test "a different set is a rebind even when the address coincidentally matches" do
      assert NetworkMonitor.transition([@a], @addr_a, [@a, @b], @addr_a) == :rebind
    end

    test "an empty reading is held, never a transition" do
      # Unbinding on a transient would leave the node advertising localhost.
      assert NetworkMonitor.transition([@a], @addr_a, [], "localhost:4000") == :hold
      assert NetworkMonitor.transition([@a, @b], @addr_a, [], "localhost:4000") == :hold
    end

    test "two empty readings are no change" do
      assert NetworkMonitor.transition([], "localhost:4000", [], "localhost:4000") == :none
    end
  end
end
