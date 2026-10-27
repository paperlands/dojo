defmodule DojoWeb.DiscipleStripCommandTest do
  use ExUnit.Case, async: true
  import Phoenix.LiveViewTest

  alias DojoWeb.ShellLive.DiscipleWindow, as: Window
  alias DojoWeb.ShellLive.OuterShell

  defp win(hand, name) do
    Window.of({hand, %{name: name, addr: hand <> ".local", online_at: 1}})
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
end
