defmodule DojoWeb.ShellLive.DiscipleWindowTest do
  use ExUnit.Case, async: true
  import Phoenix.LiveViewTest

  alias DojoWeb.ShellLive.DiscipleWindow, as: Window
  alias DojoWeb.ShellLive.OuterShell

  defp dis(over \\ %{}),
    do: Map.merge(%{name: "kai", addr: "kai.local", online_at: 1}, over)

  defp win(over \\ %{}), do: Window.of({"h1", dis(over)})

  defp drawn(state), do: %{meta: %{path: "turtle.png", state: state, time: 9}}

  defp lrow(over \\ %{}),
    do:
      Map.merge(
        %{
          id: "k1",
          root: "rootA",
          target: "workA",
          message: ~s({"title":"spirals"}),
          at: 5,
          face: true
        },
        over
      )

  describe "hour/1 — four ordered clauses, total" do
    test "a hand here with nothing drawn is the crescent — the crescent IS the waiting" do
      assert :crescent = Window.hour(win())
    end

    test "a hand here and drawn is the veil" do
      assert :veil = Window.hour(win(drawn(:success)))
    end

    test "a hand here whose world broke is blood — the moon turns, it is not a red border" do
      assert :blood = Window.hour(win(drawn(:error)))
    end

    test "no hand is the kept face" do
      assert :kept = Window.hour(%Window{hand: "h1", name: "kai", now: nil, kept: nil})
    end

    test "nothing drawn outranks broken — there is no picture to paint blood on" do
      assert :crescent = Window.hour(win(%{meta: %{path: nil, state: :error, time: 9}}))
    end
  end

  describe "the two faces never cross (id:keep-ms-api-live)" do
    test "the now face is the hand's own node, never the keep store" do
      assert %Window{now: %{src: "//kai.local/turtle.png"}} = win(drawn(:success))
    end

    test "a hand who has not drawn offers no source at all" do
      assert %Window{now: %{src: nil}} = win()
    end

    test "presence alone never mints a kept face — a hatch is not a keep" do
      assert %Window{kept: nil} = win(drawn(:success))
    end
  end

  describe "windows/1 — one run, one clock" do
    test "newest hand first" do
      strip =
        Window.windows(%{
          "old" => dis(%{name: "rex", online_at: 1}),
          "new" => dis(%{name: "lyra", online_at: 3}),
          "mid" => dis(%{name: "nim", online_at: 2})
        })

      assert [%Window{name: "lyra"}, %Window{name: "nim"}, %Window{name: "rex"}] = strip
    end

    test "the hand is the key, so the seat outlives every hour" do
      assert [%Window{hand: "h1"}] = Window.windows(%{"h1" => dis()})
    end
  end

  describe "strip/2 — live leftmost, then the room's dark keeps" do
    test "live hands lead (online clock); dark keeps trail (room clock)" do
      strip =
        Window.strip(
          %{"rk1" => dis(%{name: "kai", online_at: 2})},
          [lrow(%{root: "rootB", target: "workB"})]
        )

      # the present hand is leftmost; the departed journal's lamp trails, dimmed
      # by depth. No name on the row → nil; the sill still labels the seat.
      assert [
               %Window{key: "rk1", hand: "rk1", name: "kai", now: %{}, kept: nil, depth: nil},
               %Window{
                 key: "rootB",
                 hand: nil,
                 name: nil,
                 now: nil,
                 kept: %{title: "spirals"},
                 depth: 1
               }
             ] = strip
    end

    test "a present hand carries its own last keep — the peek face, not shown by default" do
      # kai's :root is resolved upstream (Keep.owner_of) and rides on presence;
      # it matches rootA's lantern → rootA is live (weather) leftmost, excluded
      # from the dark run, and its lamp rides along as `kept` for the peek.
      strip =
        Window.strip(
          %{"rk1" => dis(%{name: "kai", online_at: 2, root: "rootA"})},
          [lrow(%{root: "rootA", target: "workA"})]
        )

      assert [
               %Window{
                 key: "rootA",
                 hand: "rk1",
                 name: "kai",
                 now: %{},
                 kept: %{title: "spirals"},
                 depth: nil
               }
             ] = strip
    end

    test "the dark run dims by depth — latest is d1, older recede to d4" do
      lanterns =
        for i <- 1..6, do: lrow(%{id: "k#{i}", root: "root#{i}", target: "work#{i}", at: 10 - i})

      depths = Window.strip(%{}, lanterns) |> Enum.map(& &1.depth)
      assert depths == [1, 2, 3, 4, 4, 4]
    end

    test "the dark seat is keyed by root; a nameless row still has a sill" do
      assert %Window{
               key: "rootA",
               hand: nil,
               name: nil,
               now: nil,
               kept: %{src: "/keeps/k1/image", title: "spirals", at: 5}
             } = Window.lantern(lrow())
    end

    test "a dark seat wears the name the journal still knows (id:ks-name)" do
      assert %Window{name: "alice", kept: %{title: "spirals"}} =
               Window.lantern(lrow(%{name: "alice"}))
    end

    test "the kept face renders the durable name top-right" do
      html =
        render_component(&DojoWeb.DiscipleStrip.strip/1,
          windows: [Window.lantern(lrow(%{name: "alice"}))],
          outershell: nil
        )

      assert html =~ ~s(class="name">alice</span>)
      assert html =~ ~s(class="sill")
    end

    test "a keep without a picture has no src — never a URL that 404s into turtlehead" do
      # face:false is the fan's named absence (id:kc-e-missing-image). A src that
      # always GETs /keeps/:id/image made every faceless lamp flash turtlehead.
      assert %Window{kept: %{src: nil, title: "spirals"}} =
               Window.lantern(lrow(%{face: false}))
    end

    test "a dark seat's hour is kept" do
      assert :kept = Window.hour(Window.lantern(lrow()))
    end
  end

  describe "focus?/2 — the twilight rim" do
    test "the hand the author has open wears it" do
      assert Window.focus?(win(), %OuterShell{addr: "h1"})
    end

    test "another hand does not" do
      refute Window.focus?(win(), %OuterShell{addr: "h2"})
    end

    test "no open shell is no focus" do
      refute Window.focus?(win(), nil)
    end
  end
end
