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

  ## The seat is a button

  It is a `<button>` and not a `<div>` with a click handler, so a hand without
  a mouse can knock: Enter and Space are the door by the browser's own law, and
  `:focus-visible` paints a ring the template never branches on. Its cursor is
  inherited from the bar (grab · grabbing), because the press belongs to the
  pan's gesture and a click is the refinement. A seat whose shown face names no
  subject keeps the element but leaves the tab order.
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
    click = seat_click(hour, assigns.win)

    assigns =
      assign(assigns,
        hour: hour,
        click: click,
        label: seat_label(hour, assigns.win),
        focus?: DiscipleWindow.focus?(assigns.win, assigns.outershell),
        # A living seat with a last keep can be peeked; a dark seat already shows it.
        peekable?: assigns.win.kept != nil and hour != :kept
      )

    ~H"""
    <div id={seat_id(@win.key)} class="pointer-events-auto">
      <%!-- A DOOR IS A BUTTON. The seat was a div with a click handler: a hand
            without a mouse could not knock, and there was no focus to see. The
            native element gives Enter and Space their own law, a focus ring, and
            the cursor — nothing about the window's paint changes. A seat whose
            shown face names no subject stays out of the tab order. --%>
      <button
        type="button"
        data-disciple
        aria-label={@label}
        aria-disabled={if @click, do: nil, else: "true"}
        tabindex={if @click, do: "0", else: "-1"}
        class={[
          "win",
          to_string(@hour),
          @focus? && "focus",
          @win.depth && "d#{@win.depth}",
          @peekable? && "peekable"
        ]}
        phx-click={@click}
        phx-value-addr={@win.hand}
      >
        <span class="spill" aria-hidden="true"></span>
        <span class="rim" aria-hidden="true"></span>
        <span class="pass" aria-hidden="true"></span>
        <div class="pane">
          <%!-- The lamp, behind: shown by default on a dark seat, the peek on a
                living one (id:hw-takahata image center). Title and time rest on
                the sill; the name is the hand, top-right, when the keep signed
                its own root (id:kc-sign, id:ks-name). --%>
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
      </button>
    </div>
    """
  end

  # What a hand that cannot see the picture hears. A lamp is opened by its
  # work, so the door says the work's name — and whose it is, when its keep
  # signed letters (id:kc-sign, id:ks-name). Absence is named, never guessed.
  defp seat_label(:kept, %{kept: %{title: title}, name: name}) do
    if is_binary(name) and name != "" do
      "open #{title}, kept by #{name}"
    else
      "open #{title}"
    end
  end

  defp seat_label(_hour, %{name: name}) when is_binary(name) and name != "",
    do: "open #{name}'s window"

  defp seat_label(_hour, _win), do: "open window"

  # One seat, one command, one door: the subject the shown face can NAME. A
  # living hand is selected by addr; a lamp by the keep's room address, read
  # once and never followed (id:la-fork-pull). A keepless lamp names nothing.
  defp seat_click(:kept, %{kept: %{id: id}, name: name}) when is_binary(id),
    do: select(OuterShell.keep_addr(id), name, false)

  defp seat_click(:kept, _win), do: nil

  defp seat_click(_hour, win), do: select(win.hand, win.name, true)

  # A local departure at raw arrival — the client owns open vs close, never us.
  defp select(addr, name, follow_peer) do
    JS.dispatch("phx:outerSelect",
      to: "body",
      detail: %{
        addr: addr,
        view: "watch",
        draft_live: true,
        follow_peer: follow_peer,
        name: name
      }
    )
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
end
