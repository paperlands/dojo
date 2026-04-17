defmodule Dojo.Cluster.MDNS.PartisanAdapterTest do
  use ExUnit.Case, async: true

  alias Dojo.Cluster.MDNS.PartisanAdapter

  describe "identity/0" do
    test "reads PARTISAN_NAME from env" do
      name_env = System.get_env("PARTISAN_NAME")

      if is_binary(name_env) and name_env != "" do
        {name, _port} = PartisanAdapter.identity()
        assert name == String.to_atom(name_env)
      end
    end

    test "reads PARTISAN_PORT from env" do
      port_env = System.get_env("PARTISAN_PORT")

      if is_binary(port_env) do
        {_name, port} = PartisanAdapter.identity()
        {expected, ""} = Integer.parse(port_env)
        assert port == expected
      end
    end

    test "returns {atom, integer} tuple" do
      {name, port} = PartisanAdapter.identity()
      assert is_atom(name)
      assert is_integer(port)
      assert port > 0 and port < 65536
    end
  end

  describe "channels/0" do
    test "returns a map" do
      channels = PartisanAdapter.channels()
      assert is_map(channels)
    end

    test "contains gossip channel by default" do
      channels = PartisanAdapter.channels()
      assert Map.has_key?(channels, :gossip)
    end
  end

  describe "on_peers_discovered/1" do
    test "returns :ok for empty list" do
      assert :ok = PartisanAdapter.on_peers_discovered([])
    end
  end

  describe "on_peer_departed/1" do
    test "returns :ok" do
      assert :ok = PartisanAdapter.on_peer_departed(:some_node)
    end
  end
end
