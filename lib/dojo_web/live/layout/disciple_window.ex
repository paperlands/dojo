defmodule DojoWeb.ShellLive.DiscipleWindow do
  @moduledoc """
  One hand's window in the strip — frame · pane · sill (id:hw-selene).

  A read-only projection of presence (D009). Nothing transitions here: every
  fact arrives from outside, so this module derives and does nothing else. It
  is not an FSM — it borrows the OuterShell's *discipline*, ordered clauses
  here and no branching in the template. The crossing between hours is CSS
  (`_window.css` id:hw-crossing); the server says only which face is true.

  ## Two faces, and one word

    * `now`  — the hand at work: their live hatch, off their own node.
    * `kept` — the room's memory: their last keep, off `/keeps/:id/image`.

  Two censuses (id:keep-ms-apis), and **they never cross**: a hatch is never
  shown as a keep, nor a keep as what a friend is drawing now
  (id:keep-ms-api-live). A hand with neither face is not a window.

  ## An hour is a fact a child can see

  Four, ordered, total — weather on the true face, never a badge and never a
  second sun (id:hw-selene: one sun, many moons). Ownership is a true fact and
  an invisible one, so it is not an hour.

  [⊗] The seam table's fifth hour, `draft` = *composing* (id:hw-selene-seam),
  is absent. It needs "their `?t=` is still moving", which decays — a server
  timer per window, or a client cooling like `--fly-wake`. Neither is walked,
  and unwalked is not shipped (id:pres-gauge).
  """

  alias DojoWeb.ShellLive.OuterShell

  # `key` is the seat's DOM identity — the ROOT for a journal-seat, the reg_key
  # for a rootless trailer. `hand` is the live click/focus id (a reg_key), nil
  # when the seat is dark. The two were one field once; splitting them is what
  # lets one seat persist dark→lit→dark under a single key (id:ks-light).
  #
  # A present hand may carry BOTH faces: `now` (weather, shown) and `kept` (its
  # last keep). They never cross — CSS shows one, peek/leave reveals the other
  # (id:keep-ms-api-live). `depth` dims a dark seat by how far back it sits.
  defstruct [:key, :hand, :name, :now, :kept, :depth]

  @type t :: %__MODULE__{
          key: String.t(),
          hand: String.t() | nil,
          name: String.t() | nil,
          now: %{src: String.t() | nil, state: atom() | nil} | nil,
          kept: %{src: String.t() | nil, title: String.t(), at: integer()} | nil,
          depth: 1..4 | nil
        }

  @doc """
  The whole strip: the living run first, then the room's dark keeps (id:ks-light).

  *Live leftmost* — every present hand, on the `online_at` clock, newest first.
  *Then the lamps* — journals no present hand stands on, in the room's order
  (`shared_at`, latest→oldest). A present hand keeps its `root` as key, so leaving
  slides the very same seat rightward from the living run into the dark run:
  morphdom moves the node, never tears it down — no image blink (id:ks-crossing).
  The two runs are composed, never sorted together (id:ka-cursor).

  Self is already gone — filtered in the fan query (id:ks-delta).
  """
  @spec strip(map(), [map()]) :: [t()]
  def strip(disciples, lanterns) when is_map(disciples) and is_list(lanterns) do
    by_root = Map.new(lanterns, &{&1.root, &1})
    present = present_roots(disciples)

    live =
      disciples
      |> Enum.sort_by(fn {_reg_key, dis} -> dis.online_at end, :desc)
      |> Enum.map(fn {reg_key, dis} -> of({reg_key, dis}, by_root[Map.get(dis, :root)]) end)

    dark =
      lanterns
      |> Enum.reject(&MapSet.member?(present, &1.root))
      |> Enum.with_index()
      |> Enum.map(fn {row, i} -> lantern(row, min(i + 1, 4)) end)

    live ++ dark
  end

  @doc """
  The living run — every present hand on the `online_at` clock, newest first.

  A hand with a resolved journal is keyed by its `root` so the seat survives the
  crossing to the dark run; a hand with none is keyed by `reg_key` (id:ks-light).
  A cursor cannot cross a hop (id:ka-cursor), so this run is never sorted into
  the room's.
  """
  @spec windows(map()) :: [t()]
  def windows(disciples) when is_map(disciples) do
    disciples
    |> Enum.sort_by(fn {_reg_key, dis} -> dis.online_at end, :desc)
    |> Enum.map(&of/1)
  end

  # The roots present hands stand on — the dark run excludes these, so a live
  # hand is never also a lamp. `:root` is resolved upstream from the work_id
  # presence carries (`Keep.owner_of`, the works bind id:ka-works-bind),
  # authoritative for *any* river. This module reads it, never resolves it
  # (D009). An unshared hand has no `:root` and dims nothing.
  defp present_roots(disciples) do
    for {_reg_key, dis} <- disciples,
        r = Map.get(dis, :root),
        is_binary(r),
        into: MapSet.new(),
        do: r
  end

  @doc """
  One presence entry → one living window. A hand with a resolved journal is keyed
  by its `root` (the seat persists into the dark run when it leaves); a hand with
  none is keyed by `reg_key`. `hand` is always the reg_key — the click/focus id.

  `now` is the shown face (weather). `kept` — the hand's own last keep, if the
  room has one — is carried too but never shown by default: it is the peek, and
  the face the seat cross-fades to when the hand leaves (id:keep-ms-api-live).
  """
  @spec of({String.t(), map()}, map() | nil) :: t()
  def of({reg_key, dis}, lantern \\ nil) do
    root = Map.get(dis, :root)

    %__MODULE__{
      # Keying by root cannot collide: reg_key is `topic:author_id` (class.ex),
      # so tabs collapse to one entry; a root has one author at a time after
      # attach (id:ki-bind) — two entries never share a root, no dedupe needed.
      key: if(is_binary(root), do: root, else: reg_key),
      hand: reg_key,
      name: Map.get(dis, :name),
      now: now_of(dis),
      kept: kept_of(lantern),
      depth: nil
    }
  end

  @doc """
  One room-memory row → one dark seat (the lamp). `now: nil` is the dark face.
  The seat is *keyed* by `root`; `depth` (1..4) dims it by how far back it sits.
  `name` is the living letters the journal still knows (id:ks-name) — not presence,
  which is gone. Absent is nil; the sill still carries title + time (id:hw-selene).
  """
  @spec lantern(map(), 1..4 | nil) :: t()
  def lantern(%{root: root} = row, depth \\ nil) do
    %__MODULE__{
      key: root,
      hand: nil,
      name: name_of(row),
      now: nil,
      kept: kept_of(row),
      depth: depth
    }
  end

  defp name_of(%{name: name}) when is_binary(name) and name != "", do: name
  defp name_of(_), do: nil

  # A keep row → the lamp face: the immutable image only when the room holds
  # one (`face`, id:ka-seat). Absent picture is a named state — never a URL
  # that 404s into turtlehead (id:kc-e-missing-image). Title + room clock still.
  # `nil` when the hand has kept nothing.
  defp kept_of(%{id: id, at: at, face: true} = row),
    do: %{src: "/keeps/#{id}/image", title: title_of(Map.get(row, :message)), at: at}

  defp kept_of(%{id: _id, at: at} = row),
    do: %{src: nil, title: title_of(Map.get(row, :message)), at: at}

  defp kept_of(_), do: nil

  # The title rides inside the message bytes; a keep with none is "untitled".
  defp title_of(message) when is_binary(message) do
    case Jason.decode(message) do
      {:ok, %{"title" => t}} when is_binary(t) and t != "" -> t
      _ -> "untitled"
    end
  end

  defp title_of(_), do: "untitled"

  # A hand that is here always has a now; what may be unknown is what they drew.
  defp now_of(%{meta: %{path: path, state: state}} = dis) when is_binary(path),
    do: %{src: "//#{Map.get(dis, :addr)}/#{path}", state: state}

  defp now_of(_dis), do: %{src: nil, state: nil}

  @doc "Which face is true, and the weather on it."
  @spec hour(t()) :: :kept | :crescent | :blood | :veil
  def hour(%__MODULE__{now: nil}), do: :kept
  def hour(%__MODULE__{now: %{src: nil}}), do: :crescent
  def hour(%__MODULE__{now: %{state: :error}}), do: :blood
  def hour(%__MODULE__{now: %{}}), do: :veil

  @doc """
  The author is looking at this hand — the twilight rim (id:hw-twilight).

  Violet is someone else, chartreuse is you; never `accent-content`.
  """
  @spec focus?(t(), OuterShell.t() | nil) :: boolean()
  def focus?(%__MODULE__{hand: hand}, %OuterShell{addr: hand}) when is_binary(hand), do: true
  def focus?(%__MODULE__{}, _), do: false
end
