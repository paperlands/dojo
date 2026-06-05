defmodule DojoWeb.ShellLive.OuterShellTest do
  use ExUnit.Case, async: true

  alias Dojo.Turtle
  alias DojoWeb.ShellLive.OuterShell

  defp ok(source \\ "fw 100"), do: %Turtle{state: :success, source: source, time: 1}
  defp err(source \\ "fw"), do: %Turtle{state: :error, source: source, message: "boom", time: 2}

  describe "observe/2 — one uniform clause" do
    test "success sets both origin and last_good" do
      shell = OuterShell.observe(%OuterShell{}, ok())
      assert shell.origin == ok()
      assert shell.last_good == ok()
    end

    test "error sets origin but keeps the previous last_good" do
      shell =
        %OuterShell{}
        |> OuterShell.observe(ok("good"))
        |> OuterShell.observe(err("broken"))

      assert shell.origin.state == :error
      assert shell.origin.source == "broken"
      assert shell.last_good.source == "good"
    end

    test "ignores non-turtles" do
      shell = %OuterShell{origin: ok()}
      assert OuterShell.observe(shell, :nope) == shell
    end
  end

  describe "render_intent/1 — derived, not branched per event" do
    test "watch pushes the current origin even when it is an error (#5 inversion)" do
      shell = OuterShell.observe(%OuterShell{view: :watch}, err())
      assert {:push, %Turtle{state: :error}} = OuterShell.render_intent(shell)
    end

    test "watch pushes origin on success" do
      shell = OuterShell.observe(%OuterShell{view: :watch}, ok())
      assert {:push, %Turtle{state: :success}} = OuterShell.render_intent(shell)
    end

    test "recall pushes the last good" do
      shell =
        %OuterShell{view: :recall}
        |> OuterShell.observe(ok("good"))
        |> OuterShell.observe(err("broken"))
        |> Map.put(:view, :recall)

      assert {:push, %Turtle{source: "good"}} = OuterShell.render_intent(shell)
    end

    test "draft with frozen baseline holds (does not disturb the draft)" do
      shell = OuterShell.observe(%OuterShell{view: :draft, stream: false}, ok())
      assert :hold = OuterShell.render_intent(shell)
    end

    test "draft with live baseline streams origin into the merge original" do
      shell = OuterShell.observe(%OuterShell{view: :draft, stream: true}, ok())
      assert {:push, %Turtle{state: :success}} = OuterShell.render_intent(shell)
    end

    test "holds when there is nothing to show" do
      assert :hold = OuterShell.render_intent(%OuterShell{})
    end
  end

  describe "UI actions only set the selector" do
    test "draft/1 auto-runs (live) when their code isn't in error" do
      shell = OuterShell.draft(%OuterShell{origin: ok()})
      assert shell.view == :draft
      assert shell.stream == true
    end

    test "draft/1 starts frozen when intervening on an error (toggle to run)" do
      shell = OuterShell.draft(%OuterShell{origin: err()})
      assert shell.view == :draft
      assert shell.stream == false
    end

    test "toggle_stream/1 flips the liveness switch" do
      assert OuterShell.toggle_stream(%OuterShell{stream: false}).stream == true
      assert OuterShell.toggle_stream(%OuterShell{stream: true}).stream == false
    end

    test "recall/1 only engages when there is a last good" do
      with_good = %OuterShell{last_good: ok()}
      assert OuterShell.recall(with_good).view == :recall
      assert OuterShell.recall(%OuterShell{}).view == :watch
    end

    test "watch/1 returns to live following" do
      shell = OuterShell.watch(%OuterShell{view: :recall, stream: false})
      assert shell.view == :watch
      assert shell.stream == true
    end
  end

  describe "code_changed?/2 — ignore preview/path bumps" do
    test "false when both sources are present and equal (a preview bump)" do
      refute OuterShell.code_changed?(ok("fw 100"), %Turtle{ok("fw 100") | time: 99})
    end

    test "true when the source text differs" do
      assert OuterShell.code_changed?(ok("fw 100"), ok("fw 200"))
    end

    test "true when we can't tell (nil source, or no prior turtle)" do
      assert OuterShell.code_changed?(nil, ok())
      assert OuterShell.code_changed?(%Turtle{state: :success}, %Turtle{state: :success})
    end
  end

  describe "errored?/1 — when recall is offered" do
    test "true only while watching a friend whose current code errors" do
      assert OuterShell.errored?(%OuterShell{view: :watch, origin: err()})
      refute OuterShell.errored?(%OuterShell{view: :watch, origin: ok()})
      refute OuterShell.errored?(%OuterShell{view: :draft, origin: err()})
    end
  end
end
