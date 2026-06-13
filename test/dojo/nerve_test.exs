defmodule Dojo.NerveTest do
  # Phase 3 — one envelope + the clock law (specs/groundwork.org gw-t-clock).
  use ExUnit.Case, async: true

  test "a client's ts rides through; the server only annotates received_at" do
    Dojo.Nerve.subscribe("clock-law-test")
    Dojo.Nerve.chat("clock-law-test", "kai", "sky", "hello", 12_345)

    assert_receive {Dojo.PubSub, :nerve, signal}
    assert signal.ts == 12_345, "ts belongs to the source — never replaced"
    assert is_integer(signal.received_at), "the boundary annotates, nothing more"
    assert signal.msg == "hello" and signal.source == "kai" and signal.kind == "chat"
  end

  test "a server-originated signal is its own source — server clock IS ts" do
    Dojo.Nerve.subscribe("clock-law-test-2")
    Dojo.Nerve.system("clock-law-test-2", "join", "kai")

    assert_receive {Dojo.PubSub, :nerve, signal}
    assert signal.ts == signal.received_at, "source and seam are the same clock here"
    assert signal.source == "system"
  end
end
