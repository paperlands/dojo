defmodule DojoWeb.ShellLive.OuterShell do
  @moduledoc """
  Server-owned selection and cached peer snapshots for the outer code-review surface.

  The selector is `addr`, `view`, `follow_peer`, and `draft_live`:
    * `addr` names the selected subject, even before its first document arrives.
    * `view` chooses `:watch` (current peer), `:recall` (last good), or `:draft`.
    * `follow_peer` permits peer updates outside a draft. Drafts always read updates.
    * `draft_live` couples local draft execution and peer-baseline updates.
      It has no effect outside `:draft`; false freezes both, not the draft text.

  `origin` caches the latest peer turtle; `last_good` caches its latest success.
  `active` routes outer actions; it is not evidence that a peer is present.
  Presence supplies the display name and device root.

  This is not the whole client state machine. CM6 owns the editable draft;
  the outer hook owns local execution and `watch.user_attention` (`peer` or
  `reader`). Attention ownership never changes `follow_peer`. Recovery restores
  selector metadata, not a document, and preserves a matching local draft.

  `observe/2` updates the cached snapshots uniformly. `render_intent/1` decides
  which snapshot to deliver, or holds the current editor island.
  Ownership and transitions: specs/weave/outer-shell.org.
  """

  alias Dojo.Turtle

  defstruct addr: nil,
            name: "friend",
            # Device root of the hand being watched — letters' peer key (id:kc-sign).
            root: nil,
            follow_peer: true,
            active: false,
            origin: nil,
            last_good: nil,
            view: :watch,
            draft_live: true

  # --- Observation: one clause, no branching on view ---

  def observe(%__MODULE__{} = shell, %Turtle{state: :success} = turtle) do
    %{shell | origin: turtle, last_good: turtle}
  end

  def observe(%__MODULE__{} = shell, %Turtle{} = turtle) do
    # error (or any non-success): keep the last good for look-back / baseline
    %{shell | origin: turtle}
  end

  def observe(shell, _), do: shell

  # --- Render intent: what (if anything) to push, derived from the selector ---
  #
  # Returns {:push, turtle} | :hold. The view/draft_live the JS needs to render the
  # right diff travel on the seeOuterShell payload itself, not here.

  # :recall — look back at the last good.
  def render_intent(%__MODULE__{view: :recall, last_good: %Turtle{} = good}), do: {:push, good}

  # A new LV has no last_good yet. Keep the recall intent and HOLD — the
  # client island stays until a known success can become the baseline.
  def render_intent(%__MODULE__{view: :recall}), do: :hold

  # :draft, frozen baseline — don't disturb the draft the user is editing.
  def render_intent(%__MODULE__{view: :draft, draft_live: false}), do: :hold

  # A live draft receives the peer's latest code in its merge baseline.
  def render_intent(%__MODULE__{view: :draft, origin: %Turtle{} = origin}), do: {:push, origin}

  # :watch — show origin live, whatever its state (error shows live, #5).
  def render_intent(%__MODULE__{origin: %Turtle{} = origin}), do: {:push, origin}

  def render_intent(_), do: :hold

  # --- UI actions: just set the selector ---

  # Drafts start running, including when the peer's code is broken.
  def draft(%__MODULE__{} = shell), do: %{shell | view: :draft, draft_live: true}

  def toggle_draft_live(%__MODULE__{draft_live: draft_live} = shell),
    do: %{shell | draft_live: !draft_live}

  def recall(%__MODULE__{last_good: %Turtle{}} = shell), do: %{shell | view: :recall}
  def recall(shell), do: shell

  def watch(%__MODULE__{} = shell), do: %{shell | view: :watch, draft_live: true}

  # --- Queries ---

  def last_time(%__MODULE__{last_good: %Turtle{time: t}}) when is_integer(t), do: t
  def last_time(_), do: 0

  @doc "True when watching and the friend's current code is in error (recall is offered)."
  def errored?(%__MODULE__{view: :watch, origin: %Turtle{state: :error}}), do: true
  def errored?(_), do: false

  @doc """
  Whether to read the peer's latest turtle: peer updates enabled, or any draft.
  A frozen draft still updates the server cache, but holds the visible baseline.
  This does not control whose position guides local attention.
  """
  def wants_updates?(%__MODULE__{follow_peer: true}), do: true
  def wants_updates?(%__MODULE__{view: :draft}), do: true
  def wants_updates?(_), do: false

  # seeOuterShell envelope keys — Turtle fields + shell overlay. Client dual:
  # OUTER_SHELL_KEYS / outerShellPayload in hooks/shell/outer-shell-payload.js.
  # Keep both lists in lockstep (outershell_test + outer_shell_payload_test).
  @payload_keys [
    :state,
    :path,
    :commands,
    :attend,
    :diagnostics,
    :source,
    :time,
    :buffer_id,
    :addr,
    :origin_name,
    :root,
    :view,
    :draft_live
  ]

  @doc "The seeOuterShell contract (atoms). Dual of JS OUTER_SHELL_KEYS."
  def payload_keys, do: @payload_keys

  @doc """
  Build the seeOuterShell map. One named builder for every server push path.
  Client dual: `outerShellPayload` (same keys; library fills path/attend/buffer_id as null).
  """
  def payload(%Turtle{} = turtle, %__MODULE__{} = shell) do
    turtle
    |> Map.from_struct()
    |> Map.merge(%{
      addr: shell.addr,
      origin_name: shell.name,
      root: shell.root,
      view: shell.view,
      draft_live: shell.draft_live
    })
  end

  # Name the BUMP, never the fields that matter: a field added to the reflect is
  # covered the day it is added and can never mint a second gate (D025 R3).
  @bump %{time: nil, path: nil}

  @doc """
  Would the watcher learn something new? The one question, asked at both ends —
  the client's `_lastReflectChange` speaks the same sentence. Only a
  preview/path bump is suppressed.

  Replaced `code_changed?`, which read `source` alone and so also dropped a
  changed `diagnostics` (runtime ailments move while source does not) and
  `state`.
  """
  def reflect_changed?(%Turtle{} = prev, %Turtle{} = new),
    do: struct(prev, @bump) != struct(new, @bump)

  def reflect_changed?(_prev, _new), do: true
end
