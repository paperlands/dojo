defmodule DojoWeb.ShellLiveKeepOpenTest do
  @moduledoc """
  A lamp opens by id, never by hand (id:la-fork-pull).

  The strip rides the one selector door: `outerSelect` → `restoreShell` with
  the keep's room address. The room reads the keep it already holds and hands
  the document over; the surface gains no keep-specific state.
  """
  use Dojo.DataCase

  import ExUnit.CaptureLog

  alias Dojo.Keep
  alias DojoWeb.Session
  alias DojoWeb.ShellLive
  alias DojoWeb.ShellLive.OuterShell
  alias Phoenix.LiveView.Socket
  alias Phoenix.LiveView.Utils

  @clan "PaperLand"
  @source "fw 100"
  @root Dojo.KeepSigning.root(String.duplicate("e", 64))

  # The bare production shape the handlers need; no Table, no presence.
  defp sock(over \\ %{}) do
    %Socket{
      assigns:
        Map.merge(
          %{
            __changed__: %{},
            outershell: %OuterShell{},
            clan: @clan,
            follow_gen: 0,
            session: %Session{name: "wren"}
          },
          over
        )
    }
  end

  defp message(over \\ %{}) do
    Jason.encode!(
      Map.merge(
        %{
          "source_id" => Keep.hash(@source),
          "title" => "tree",
          "v" => 1,
          "kind" => "snap",
          "root" => @root,
          "signature_of" => %{@root => "lowe"},
          "ts" => %{"t" => 1_700_000_000_000, "n" => 0}
        },
        over
      )
    )
  end

  defp ship(bytes) do
    payload = %{"id" => Keep.hash(bytes), "message" => bytes, "source" => @source}
    Keep.receive(Dojo.KeepSigning.sign(payload), clan: @clan, author_id: "author-1", name: "lowe")
  end

  defp pushes(socket), do: Utils.get_push_events(socket)

  defp doc(socket) do
    Enum.find_value(pushes(socket), fn
      ["seeOuterShell", payload] -> payload
      _ -> nil
    end)
  end

  # The seat's click: a local departure carrying the keep's address.
  defp select(keep_id) do
    %{
      "addr" => OuterShell.keep_addr(keep_id),
      "view" => "watch",
      "draft_live" => true,
      "follow_peer" => false,
      "name" => "lowe"
    }
  end

  # The async read the selector door starts, settled here.
  defp read(socket, ref) do
    assert {:noreply, socket} =
             ShellLive.handle_async(:keep_open, {:ok, Keep.get(ref)}, socket)

    socket
  end

  describe "restoreShell — a keep subject" do
    test "acks the selector, then hands the document over asynchronously" do
      %{id: id, at: at} = ship(message())

      assert {:reply, selector, socket} =
               ShellLive.handle_event("restoreShell", select(id), sock())

      assert Map.take(selector, [:addr, :view, :draft_live, :follow_peer]) == %{
               addr: OuterShell.keep_addr(id),
               view: :watch,
               draft_live: true,
               follow_peer: false
             }

      # The reply carries last-known chrome for recovery, never a document.
      assert selector.name == "lowe"

      assert socket.assigns.outershell.origin == nil, "the reply is a selector, not a document"

      payload = doc(read(socket, id))
      assert payload.addr == OuterShell.keep_addr(id)
      assert payload.source == @source
      assert payload.origin_name == "lowe", "the keep signs its own letters"
      assert payload.root == @root
      assert payload.time == at
      assert payload.state == :success
    end

    test "a keep that signed no letters shows none — absence, not a guess" do
      %{id: id} = ship(message(%{"signature_of" => %{}}))

      assert {:reply, _selector, socket} =
               ShellLive.handle_event("restoreShell", select(id), sock())

      assert doc(read(socket, id)).origin_name == nil
    end

    test "a keep with no source still opens — empty, not absent" do
      bytes = message()
      payload = %{"id" => Keep.hash(bytes), "message" => bytes}

      Keep.receive(Dojo.KeepSigning.sign(payload),
        clan: @clan,
        author_id: "author-1",
        name: "lowe"
      )

      assert {:reply, _selector, socket} =
               ShellLive.handle_event("restoreShell", select(Keep.hash(bytes)), sock())

      assert doc(read(socket, Keep.hash(bytes))).source == ""
    end

    test "a newer selection retires the read: no old completion may reclaim it" do
      %{id: id} = ship(message())

      assert {:reply, _selector, socket} =
               ShellLive.handle_event("restoreShell", select(id), sock())

      # The reader moved on before the room answered.
      moved = %{
        socket
        | assigns: Map.put(socket.assigns, :outershell, %OuterShell{addr: "//kai/"})
      }

      assert {:noreply, ^moved} = ShellLive.handle_async(:keep_open, {:ok, Keep.get(id)}, moved)
      assert moved.assigns.outershell.addr == "//kai/"
    end

    test "an unreadable answer leaves the selector standing and pushes nothing" do
      %{id: id} = ship(message())

      assert {:reply, _selector, socket} =
               ShellLive.handle_event("restoreShell", select(id), sock())

      assert {:noreply, ^socket} = ShellLive.handle_async(:keep_open, {:ok, :none}, socket)

      log =
        capture_log(fn ->
          assert {:noreply, ^socket} =
                   ShellLive.handle_async(:keep_open, {:exit, :noproc}, socket)
        end)

      assert log =~ "keep read failed"
    end
  end

  describe "keep_ref/1 — the other half of the address" do
    test "reads the id back out of the room address, and nothing else" do
      id = String.duplicate("9", 64)

      assert OuterShell.keep_ref(OuterShell.keep_addr(id)) == id
      assert OuterShell.keep_ref("//kai.t/hatch.png") == nil
      assert OuterShell.keep_ref("~/page") == nil
      assert OuterShell.keep_ref("/keeps/") == nil
      assert OuterShell.keep_ref("/keeps/" <> String.duplicate("9", 63)) == nil
      assert OuterShell.keep_ref("/keeps/" <> String.duplicate("Z", 64)) == nil
    end
  end

  describe "letters/2 and root_of/1 — the bytes name the work" do
    test "letters answers one hand's signature, nil for another's" do
      bytes = message()

      assert Keep.letters(bytes, @root) == "lowe"
      assert Keep.letters(bytes, String.duplicate("b", 64)) == nil
      assert Keep.letters(bytes, nil) == nil
      assert Keep.letters("not json", @root) == nil
    end

    test "root_of reads the journal from the message, never guesses" do
      assert Keep.root_of(message()) == @root
      assert Keep.root_of("not json") == nil
      assert Keep.root_of(nil) == nil
    end
  end
end
