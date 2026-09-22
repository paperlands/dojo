defmodule DojoWeb.DiscipleStrip do
  @moduledoc """
  The strip of disciple windows — a pure projection of
  `DojoWeb.ShellLive.DiscipleWindow`, as `OuterShellLive` is of `OuterShell`.

  It renders and emits; it owns nothing. The hour arrives as an atom and is
  written as a class, so the template holds no `cond` and no branch on state.

  ## One seat per journal, lit by presence

  The journals are the seats, room-ordered on `shared_at`; presence lights the
  one it stands on, in place (id:ks-light). Only a hand with no journal yet
  trails as a second run on `online_at` — a cursor cannot cross a hop
  (id:ka-cursor), so the two runs are composed, never sorted together under a
  fake key.

  ## Two things here are load-bearing and look cosmetic

    * The keyed `id` on the seat wrapper. Unkeyed, morphdom matches positionally
      and a mid-strip arrival re-labels every window after it, re-fetching each
      image — the work blinks (walked 2026-08-13).
    * `phx-value-addr` on a DESCENDANT of that wrapper. The hook resolves a
      seat's identity with `querySelector("[phx-value-addr]")`; flatten the two
      levels and visibility never reports, so meta never hydrates and every
      window stays a crescent.
  """
  use DojoWeb, :html

  import DojoWeb.SVGComponents

  alias DojoWeb.ShellLive.DiscipleWindow
  alias DojoWeb.ShellLive.OuterShell

  attr :windows, :list, required: true
  attr :outershell, :any, default: nil

  def strip(assigns) do
    ~H"""
    <.window :for={w <- @windows} win={w} outershell={@outershell} />
    """
  end

  attr :win, :any, required: true
  attr :outershell, :any, default: nil

  defp window(assigns) do
    hour = DiscipleWindow.hour(assigns.win)

    assigns =
      assign(assigns,
        hour: hour,
        focus?: DiscipleWindow.focus?(assigns.win, assigns.outershell),
        # A living seat with a last keep can be peeked; a dark seat already shows it.
        peekable?: assigns.win.kept != nil and hour != :kept
      )

    ~H"""
    <div id={seat_id(@win.key)} class="pointer-events-auto">
      <div
        data-disciple
        class={[
          "win",
          to_string(@hour),
          @focus? && "focus",
          @win.depth && "d#{@win.depth}",
          @peekable? && "peekable"
        ]}
        phx-click={@hour != :kept && open_or_close(@outershell, @win.hand)}
        phx-throttle="500"
        phx-value-addr={@win.hand}
      >
        <span class="spill" aria-hidden="true"></span>
        <span class="rim" aria-hidden="true"></span>
        <span class="pass" aria-hidden="true"></span>
        <div class="pane">
          <%!-- The lamp, behind: shown by default on a dark seat, the peek on a
                living one (id:hw-takahata image center). Title and time rest on
                the sill; the name is the hand, top-right, when the journal still
                knows it (id:ks-name). --%>
          <div :if={@win.kept} class="face kept">
            <%!-- No src → no img. A missing picture is named absence, not the
                 turtlehead fallback (id:kc-e-missing-image). onerror stays for
                 a true load failure of a face the room claimed to hold. --%>
            <img
              :if={@win.kept.src}
              class="work"
              src={@win.kept.src}
              onerror="this.src='/images/turtlehead.png';"
            />
            <span :if={@win.name} class="name">{@win.name}</span>
            <span class="gleam" aria-hidden="true"></span>
            <span class="sill">
              <span>≡ {@win.kept.title}</span>
              <span class="ago">{ago(@win.kept.at)}</span>
            </span>
          </div>
          <%!-- The crescent IS the waiting — droplet as a small ember (id:hw-phases). --%>
          <div :if={@hour == :crescent} class="face waiting">
            <span class="name">{@win.name}</span>
            <.droplet_loader class="kindle" />
          </div>
          <%!-- The weather, in front — the shown face while the hand is here. --%>
          <div :if={@hour not in [:crescent, :kept]} class="face now">
            <img
              :if={@win.now.src}
              class="work"
              src={@win.now.src}
              onerror="this.src='/images/turtlehead.png';"
            />
            <span class="name">{@win.name}</span>
          </div>
        </div>
      </div>
    </div>
    """
  end

  # Time since the room last met this lamp — a snapshot at render, coarse on
  # purpose (the strip is not a clock). `at` is `shared_at`, the room's ms. The
  # vocabulary is the design's: just now · Nm · Nh · yesterday · Nd · last week.
  defp ago(at) when is_integer(at) do
    secs = div(System.system_time(:millisecond) - at, 1000)

    cond do
      secs < 60 -> "just now"
      secs < 3600 -> "#{div(secs, 60)}m"
      secs < 86_400 -> "#{div(secs, 3600)}h"
      secs < 172_800 -> "yesterday"
      secs < 604_800 -> "#{div(secs, 86_400)}d"
      secs < 1_209_600 -> "last week"
      true -> "#{div(secs, 604_800)}w"
    end
  end

  defp ago(_), do: ""

  # A reg_key carries `:` and base64; url_encode64 keeps the id selector-safe.
  defp seat_id(hand), do: "win-" <> Base.url_encode64(hand, padding: false)

  defp open_or_close(%OuterShell{addr: hand}, hand), do: DojoWeb.OuterShellLive.close_js()
  defp open_or_close(_, _), do: JS.push("seeTurtle")
end
