defmodule DojoWeb.ShellLive.OuterShell do
  @moduledoc """
  The OuterShell domain model / FSM. Its view is `DojoWeb.OuterShellLive`
  (`components/outer_shell.ex`).

  One living diff between two turtle-sources along a fork lineage.

  The OuterShell is a code-review surface. It holds two sources and a small
  selector — nothing more. The merge view is the single rendering primitive.

    * `origin`    — the friend's code (the lineage root you're watching).
                    Always carries the *current* turtle, success or error.
    * `last_good` — the last successful `origin` (for look-back, and the
                    natural baseline since a diff against broken code is noise).
    * `mine`      — your version lives in the editor (CM6), not here; in
                    `:draft` it is diffed against `origin`. It is the same
                    lineage as your coreshell fork, seen from another angle.

  ## View — a pairing over the one diff, not a mode machine

    * `:watch`  — show `origin` live. Errors show live (glitch in the view).
    * `:draft`  — editable; merge `mine` against `origin`.
    * `:recall` — look back at `last_good`.
    * `:request`— (reserved/future) the same diff with an *inbound* proposal
                  as `mine`.

  `stream` is the liveness switch: does `origin` flow to the foreground /
  merge-baseline live, or is it frozen.

  ## Observation is uniform

  An incoming turtle always becomes the current `origin` (and `last_good` on
  success). What gets pushed to the view is *derived* by `render_intent/1`
  from `view` + `stream` — there are no per-event transitions.
  """

  alias Dojo.Turtle

  defstruct addr: nil,
            name: "friend",
            follow: true,
            active: false,
            origin: nil,
            last_good: nil,
            view: :watch,
            stream: true

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
  # Returns {:push, turtle} | :hold. The view/stream the JS needs to render the
  # right diff travel on the seeOuterShell payload itself, not here.

  # :recall — look back at the last good.
  def render_intent(%__MODULE__{view: :recall, last_good: %Turtle{} = good}), do: {:push, good}

  # :draft, frozen baseline — don't disturb the draft the user is editing.
  def render_intent(%__MODULE__{view: :draft, stream: false}), do: :hold

  # :draft, live baseline — stream origin into the merge ORIGINAL (rebase preview).
  def render_intent(%__MODULE__{view: :draft, origin: %Turtle{} = origin}), do: {:push, origin}

  # :watch — show origin live, whatever its state (error shows live, #5).
  def render_intent(%__MODULE__{origin: %Turtle{} = origin}), do: {:push, origin}

  def render_intent(_), do: :hold

  # --- UI actions: just set the selector ---

  # Intervening on a *working* friend runs your draft right away (auto-live).
  # Intervening on an *error* is deliberate — start frozen; you toggle to run.
  def draft(%__MODULE__{origin: %Turtle{state: :error}} = shell),
    do: %{shell | view: :draft, stream: false}

  def draft(%__MODULE__{} = shell), do: %{shell | view: :draft, stream: true}

  def toggle_stream(%__MODULE__{stream: stream} = shell), do: %{shell | stream: !stream}

  def recall(%__MODULE__{last_good: %Turtle{}} = shell), do: %{shell | view: :recall}
  def recall(shell), do: shell

  def watch(%__MODULE__{} = shell), do: %{shell | view: :watch, stream: true}

  # --- Queries ---

  def last_time(%__MODULE__{last_good: %Turtle{time: t}}) when is_integer(t), do: t
  def last_time(_), do: 0

  @doc "True when watching and the friend's current code is in error (recall is offered)."
  def errored?(%__MODULE__{view: :watch, origin: %Turtle{state: :error}}), do: true
  def errored?(_), do: false

  @doc """
  Whether the shell wants the friend's latest code streamed in.

  Following on the canvas (watch) wants it; so does any draft — a live draft
  streams the friend's code into the merge baseline, and even a frozen draft
  wants their execution status flowing to the nerve while you work on a fix.
  """
  def wants_updates?(%__MODULE__{follow: true}), do: true
  def wants_updates?(%__MODULE__{view: :draft}), do: true
  def wants_updates?(_), do: false

  # THE BUMP — the closed set of fields a mere image/preview re-publish moves.
  # Naming the bump is the whole design (D025 R3): every OTHER field is compared
  # without being listed, so a field added to the reflect — `attend` today, a
  # caret's column tomorrow — is covered the day it is added and can never mint
  # a second gate. Enumerating what *matters* drifts on its first successor.
  @bump %{time: nil, path: nil}

  @doc """
  Would the watcher learn something new from this turtle?

  The one question, asked at both ends of the wire — the client's dirty bit
  (`_lastReflectChange`) speaks the same sentence. A hatch can fire for a mere
  image/preview/path bump with everything else identical; only that is
  suppressed. Anything else the envelope carries — source, the projected
  `commands`, the attention riding with it, diagnostics, state, message —
  reaches the watcher.

  Replaces `code_changed?`, which compared `source` alone and so suppressed the
  whole reaction (including `outerSignal`) whenever the source repeated. That
  silently dropped a changed `diagnostics` list — which joins parse errors with
  *runtime* walk ailments, and so can move while the source does not — along
  with `state` and `message`, while this module's own `wants_updates?/1`
  documents status as flowing even in a frozen draft. The docstring only ever
  claimed to suppress the bump; now the code agrees with it.
  """
  def reflect_changed?(%Turtle{} = prev, %Turtle{} = new),
    do: struct(prev, @bump) != struct(new, @bump)

  def reflect_changed?(_prev, _new), do: true
end
