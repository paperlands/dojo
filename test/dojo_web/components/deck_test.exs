defmodule DojoWeb.Components.DeckTest do
  @moduledoc """
  Parameter widths are the browser's: content-sized, clamped, never measured by
  us. A width we compute is a second authority, and a second authority was the
  jump — the box landing at its max and snapping to its placeholder after paint.
  """
  use ExUnit.Case, async: true

  import Phoenix.LiveViewTest

  setup do
    %{html: render_component(DojoWeb.DeckLive, %{id: "command-deck", locale: "en"})}
  end

  test "every text parameter is content-sized", %{html: html} do
    fields = ~r/<input[^>]*id="cmdparam-[^"]+"[^>]*/ |> Regex.scan(html) |> List.flatten()

    assert length(fields) > 30, "the deck lost its parameter fields"

    assert Enum.all?(fields, &(&1 =~ "field-sizing-content")),
           "a parameter would not fit its text"
  end

  test "every text parameter is a finger-wide slot", %{html: html} do
    fields = ~r/<input[^>]*id="cmdparam-[^"]+"[^>]*/ |> Regex.scan(html) |> List.flatten()

    assert Enum.all?(fields, &(&1 =~ "min-w-6")),
           "a glyph-wide box is not a tap target for a child"

    # Height is NOT floored on purpose: an input centres its line box, so extra
    # height lands between the digits and the bottom rule — the rule is the
    # affordance, and it must stay under the writing.
    refute Enum.any?(fields, &(&1 =~ ~r/min-h-/)),
           "a height floor detaches the rule from the text it underlines"
  end

  test "no parameter carries a measured width", %{html: html} do
    fields = ~r/<input[^>]*id="cmdparam-[^"]+"[^>]*/ |> Regex.scan(html) |> List.flatten()

    refute Enum.any?(fields, &(&1 =~ ~r/style="[^"]*width/)),
           "an inline width is the second authority this test exists to prevent"
  end

  test "the dropdown keeps a fixed width, never a content one", %{html: html} do
    [select] = Regex.scan(~r/<select[^>]*cmdparam-let-attr[^>]*/, html) |> List.flatten()

    assert select =~ "w-[8ch]"
    refute select =~ "field-sizing"
  end
end
