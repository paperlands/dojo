defmodule DojoWeb.ShellLive.OuterShell do
  @moduledoc """
  State machine for viewing a remote disciple's code.

  Mirrors Dojo.Turtle — holds two snapshots rather than duplicating fields.
  The mode FSM gates what gets pushed to the JS editor view.

  ## Modes

    * `:live`    — green. Success updates flow to the view.
    * `:freeze`  — red. Last good code stays displayed; error stored silently.
    * `:peek`    — pulsing red. User opted in to preview the broken code.
    * `:request` — (future) peer pushes changes against your lineage.

  ## Transitions

      :live    + success(turtle) -> :live     push to view
      :live    + error(turtle)   -> :freeze   DON'T push
      :freeze  + success(turtle) -> :live     push to view
      :freeze  + error(turtle)   -> :freeze   silent update
      :freeze  + preview         -> :peek     push freeze_turtle.source
      :peek    + dismiss         -> :freeze   push live_turtle.source
      :peek    + success(turtle) -> :live     push to view
      :peek    + error(turtle)   -> :peek     update freeze_turtle
  """

  alias Dojo.Turtle

  defstruct addr: nil,
            name: "friend",
            follow: true,
            active: false,
            mode: :live,
            live_turtle: nil,
            freeze_turtle: nil

  # --- Turtle event transitions ---

  def transition(%__MODULE__{mode: :live} = shell, %Turtle{state: :success} = turtle) do
    {:push, %{shell | live_turtle: turtle}}
  end

  def transition(%__MODULE__{mode: :live} = shell, %Turtle{state: :error} = turtle) do
    {:silent, %{shell | mode: :freeze, freeze_turtle: turtle}}
  end

  def transition(%__MODULE__{mode: :freeze} = shell, %Turtle{state: :success} = turtle) do
    {:push, %{shell | mode: :live, live_turtle: turtle, freeze_turtle: nil}}
  end

  def transition(%__MODULE__{mode: :freeze} = shell, %Turtle{state: :error} = turtle) do
    {:silent, %{shell | freeze_turtle: turtle}}
  end

  def transition(%__MODULE__{mode: :peek} = shell, %Turtle{state: :success} = turtle) do
    {:push, %{shell | mode: :live, live_turtle: turtle, freeze_turtle: nil}}
  end

  def transition(%__MODULE__{mode: :peek} = shell, %Turtle{state: :error} = turtle) do
    {:push, %{shell | freeze_turtle: turtle}}
  end

  def transition(shell, _turtle), do: {:silent, shell}

  # --- UI action transitions ---

  def preview(%__MODULE__{mode: :freeze, freeze_turtle: %Turtle{}} = shell) do
    {:push_freeze, %{shell | mode: :peek}}
  end

  def preview(shell), do: {:noop, shell}

  def dismiss(%__MODULE__{mode: :peek, live_turtle: %Turtle{}} = shell) do
    {:push_live, %{shell | mode: :freeze}}
  end

  def dismiss(shell), do: {:noop, shell}

  # --- Queries ---

  def last_time(%__MODULE__{live_turtle: %Turtle{time: t}}) when is_integer(t), do: t
  def last_time(_), do: 0
end
