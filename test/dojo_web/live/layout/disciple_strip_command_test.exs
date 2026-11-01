defmodule DojoWeb.DiscipleStripCommandTest do
  use ExUnit.Case, async: true
  import Phoenix.LiveViewTest

  alias DojoWeb.ShellLive.DiscipleWindow, as: Window
  alias DojoWeb.ShellLive.OuterShell

  defp win(hand, name) do
    Window.of({hand, %{name: name, addr: hand <> ".local", online_at: 1}})
  end

  # A room row the strip turns into a lamp: the work's name, its bytes, a room
  # clock — nothing about a hand, because the hand is gone.
  defp lamp(over \\ %{}) do
    Window.lantern(
      Map.merge(
        %{
          id: "k1",
          root: "rootA",
          target: "workA",
          message: ~s({"title":"tree","root":"rootA","signature_of":{"rootA":"lowe"}}),
          at: 5,
          face: true
        },
        over
      )
    )
  end

  test "every living hand sends the same local selector command" do
    html =
      render_component(&DojoWeb.DiscipleStrip.strip/1,
        windows: [win("h1", "wren"), win("h2", "fox")],
        outershell: %OuterShell{addr: "h1"}
      )

    assert length(Regex.scan(~r/phx:outerSelect/, html)) == 2,
           "both hands must dispatch the one local peer command"

    refute html =~ "seeTurtle",
           "the server-selected branch must not decide open vs close"

    refute html =~ "phx:outerClose",
           "a hand click is a selector command, never a pre-decided close"
  end

  test "a lamp selects its keep by the room's address, never followed (id:la-fork-pull)" do
    html = render_component(&DojoWeb.DiscipleStrip.strip/1, windows: [lamp()], outershell: nil)

    # One command for every seat: the same local departure a peer click makes.
    assert html =~ "phx:outerSelect"
    assert html =~ "/keeps/k1", "the subject is the door the keep came from"
    assert html =~ "&quot;follow_peer&quot;:false", "a memory is read once, never followed"
    refute html =~ "&quot;follow_peer&quot;:true", "no peer semantics leak onto a lamp"
    assert html =~ "&quot;name&quot;:&quot;lowe&quot;", "the keep signs the letters it shows"
  end

  test "a keepless lamp names nothing and stays still" do
    nameless = %Window{key: "rootA", hand: nil, name: nil, now: nil, kept: nil}

    html =
      render_component(&DojoWeb.DiscipleStrip.strip/1, windows: [nameless], outershell: nil)

    refute html =~ "phx-click", "no subject, no door"
  end
end
