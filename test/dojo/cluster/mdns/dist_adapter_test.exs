defmodule Dojo.Cluster.MDNS.DistAdapterTest do
  use ExUnit.Case, async: true

  alias Dojo.Cluster.MDNS.DistAdapter

  describe "identity/0" do
    test "returns node() as the name" do
      {name, _port} = DistAdapter.identity()
      assert name == node()
    end

    test "returns an integer port" do
      {_name, port} = DistAdapter.identity()
      assert is_integer(port)
    end
  end

  describe "channels/0" do
    test "returns empty map" do
      assert DistAdapter.channels() == %{}
    end
  end

  describe "on_peers_discovered/1" do
    test "returns :ok for empty list" do
      assert :ok = DistAdapter.on_peers_discovered([])
    end
  end

  describe "on_peer_departed/1" do
    test "returns :ok" do
      assert :ok = DistAdapter.on_peer_departed(:nonexistent@node)
    end
  end
end
