defmodule Dojo.TurtleReflectTest do
  # The reflect carries the document that arrived (D022). path nil: no frames.
  use ExUnit.Case, async: true

  @source "fw 1"
  @attend %{"line" => 1009}

  test "a success reflect publishes the forest that arrived, tail included" do
    commands = forest()

    published =
      reflect(%{
        "state" => "success",
        "source" => @source,
        "attend" => @attend,
        "path" => nil,
        "commands" => commands
      })

    assert published.state == :success
    assert published.commands === commands
    assert published.source == @source
    assert published.attend == @attend
    assert published.path == nil
    assert List.last(published.commands)["meta"]["arg"] == %{"kind" => "number", "value" => 1}
  end

  test "choices cross success and error reflects without interpretation" do
    choices = %{
      "v" => 1,
      "inputs" => [
        %{
          "route" => %{"root" => "document", "names" => ["a/b", "p.q"]},
          "action" => %{"kind" => "translation", "by" => [3, 2, 0]}
        }
      ]
    }

    for state <- ["success", "error"] do
      published =
        reflect(%{
          "state" => state,
          "source" => @source,
          "commands" => [],
          "choices" => choices
        })

      assert published.choices === choices
      assert published.source == @source
    end
  end

  test "legacy absence is not an explicit empty choice offer" do
    body = %{"state" => "success", "source" => @source, "commands" => []}
    assert reflect(body).choices == nil

    empty = %{"v" => 1, "inputs" => []}
    assert reflect(Map.put(body, "choices", empty)).choices === empty
  end

  test "an error reflect publishes the same whole forest" do
    commands = forest()

    published =
      reflect(%{
        "state" => "error",
        "source" => @source,
        "attend" => @attend,
        "path" => nil,
        "commands" => commands
      })

    assert published.state == :error
    assert published.commands === commands
    assert published.source == @source
    assert published.attend == @attend
    assert published.path == nil
  end

  test "a normal tree and an empty tree stay honest" do
    one = [call(1)]

    normal =
      reflect(%{
        "state" => "success",
        "source" => "fw 1",
        "attend" => %{"line" => 1},
        "path" => nil,
        "commands" => one
      })

    assert normal.commands === one
    assert normal.source == "fw 1"
    assert normal.attend == %{"line" => 1}

    empty =
      reflect(%{
        "state" => "success",
        "source" => "",
        "attend" => nil,
        "path" => nil,
        "commands" => []
      })

    assert empty.commands === []
    assert empty.source == ""
    assert empty.attend == nil
    assert empty.path == nil
  end

  defp reflect(body) do
    assert Dojo.Turtle.reflect(body, %{topic: :hatch, class: self(), id: "a", clan: "c"}) == :ok
    assert_receive {:"$gen_cast", {:publish, {Dojo.Turtle, nil, published}, :hatch}}
    published
  end

  # 1009 calls. The tail is not a prefix clone: nested arg, so a trim cannot hide.
  defp forest do
    prefix = for i <- 1..1008, do: call(i)

    tail =
      call(1009)
      |> put_in(["meta", "arg"], %{"kind" => "number", "value" => 1})
      |> put_in(["children"], [call(0)])

    prefix ++ [tail]
  end

  defp call(i) do
    %{
      "type" => "Call",
      "value" => "fw",
      "children" => [],
      "meta" => %{"n" => i},
      "span" => %{"line" => i, "endLine" => i}
    }
  end
end
