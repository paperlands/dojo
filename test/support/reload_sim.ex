defmodule Dojo.Test.ReloadSim do
  @moduledoc """
  Instruments and reproduces the dev code-reload window.

  Two halves, deliberately separate:

    * `watch/2` — the **instrument**. Records every process death inside a
      window and reports who died and why. It asserts nothing; causation is
      not established yet, so the rig must observe before it judges.

    * `purge/2` and `reload_cycle/2` — the **stressor**. Mirrors what
      `Mix.Compilers.Elixir` does to a module it is about to recompile:
      `:code.purge/1` then `:code.delete/1`, leaving the module with no
      current version until it is loaded back from disk.

  The gap between those two calls and the reload is the window a 3s poller
  lands in roughly once every `hold_ms / poll_interval` saves. Holding it
  open on purpose makes a race into a test.
  """

  @doc """
  Snapshot every child of `supervisor` as `{id, pid, ref}`.

  Monitors are installed before the stressor runs so no death is missed.
  """
  def snapshot(supervisor) do
    supervisor
    |> Supervisor.which_children()
    |> Enum.flat_map(fn
      {id, pid, _type, _mods} when is_pid(pid) -> [{id, pid, Process.monitor(pid)}]
      _ -> []
    end)
  end

  @doc """
  Run `fun` while watching `supervisor`'s children.

  Returns `{result, report}` where report is:

      %{
        deaths: [%{id: term, pid: pid, reason: term}],
        survivors: [{id, pid}],
        replaced: [%{id: term, was: pid, now: pid}],
        missing: [id],          # child gone entirely — supervisor gave up
        lingering_purged: [module]
      }

  `:code.purge/1` returning true means it killed a process that was still
  executing the old code. That is a distinct failure mode from
  `UndefinedFunctionError`, and the report keeps them apart.
  """
  def watch(supervisor, opts \\ [], fun) do
    before = snapshot(supervisor)
    result = fun.()

    # Let the supervisor finish restarting before reading the after-picture,
    # otherwise a replacement child reads as a missing one.
    Process.sleep(Keyword.get(opts, :settle, 200))

    deaths = drain_downs(before, [])
    Enum.each(before, fn {_id, _pid, ref} -> Process.demonitor(ref, [:flush]) end)

    now =
      supervisor
      |> Supervisor.which_children()
      |> Enum.flat_map(fn
        {id, pid, _t, _m} when is_pid(pid) -> [{id, pid}]
        {id, _, _t, _m} -> [{id, :undefined}]
      end)

    now_map = Map.new(now)

    replaced =
      for {id, pid, _ref} <- before,
          Map.get(now_map, id) not in [nil, pid, :undefined],
          do: %{id: id, was: pid, now: Map.fetch!(now_map, id)}

    missing = for {id, _pid, _ref} <- before, not Map.has_key?(now_map, id), do: id

    report = %{
      deaths: deaths,
      survivors: for({id, pid} <- now, is_pid(pid), do: {id, pid}),
      replaced: replaced,
      missing: missing
    }

    {result, report}
  end

  defp drain_downs(before, acc) do
    receive do
      {:DOWN, ref, :process, pid, reason} ->
        id =
          Enum.find_value(before, :unknown, fn
            {id, ^pid, ^ref} -> id
            _ -> nil
          end)

        drain_downs(before, [%{id: id, pid: pid, reason: reason} | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  @doc """
  Take `module` out of the node the way a recompile does.

  Mirrors `Mix.Compilers.Elixir.remove_and_purge/1` — and the `.beam` removal
  is the load-bearing step. The code server runs in `:interactive` mode, so a
  module that is only purged auto-reloads from disk on the very next call and
  no window opens at all. The window is the file's absence, not the purge.

  Returns `%{lingering_killed?: boolean, beam: charlist}`; `lingering_killed?`
  is true when `:code.purge/1` had to kill a process still running old code —
  a different failure from `UndefinedFunctionError`, and worth telling apart.
  """
  def remove(module) do
    beam = :code.which(module)
    stash = to_string(beam) <> ".reloadsim"

    if is_list(beam), do: File.rename!(to_string(beam), stash)
    killed? = :code.purge(module)
    :code.delete(module)

    %{lingering_killed?: killed?, beam: beam, stash: stash, module: module}
  end

  @doc "Put the `.beam` back and load it, ending the window."
  def restore(%{beam: beam, stash: stash, module: module}) do
    if is_list(beam) and File.exists?(stash), do: File.rename!(stash, to_string(beam))
    {:module, ^module} = Code.ensure_loaded(module)
    :ok
  end

  @doc """
  Hold `module` absent for `hold_ms`, then put it back.

  `hold_ms` should exceed the poll interval of whatever process calls into
  `module`, so the window is hit rather than jumped over.
  """
  def reload_cycle(module, hold_ms) do
    removed = remove(module)

    try do
      Process.sleep(hold_ms)
    after
      restore(removed)
    end

    removed
  end

  @doc """
  Remove *every* project module at once — the shape a full recompile has.

  This is the stressor that matters. Editing one file purges one module and
  the tree shrugs it off; `Compiling 75 files` empties the whole ebin, and
  then every long-lived process that calls into any project module faults at
  the same instant. Crucially that includes callback modules owned by *other*
  applications' supervision trees, where Dojo's restart budgets do not reach.

  `Dojo.Test.*` is spared — the rig cannot restore what it needs itself to run.
  """
  def remove_project(hold_ms) do
    modules =
      :code.all_loaded()
      |> Enum.map(&elem(&1, 0))
      |> Enum.filter(&project_module?/1)

    removed = Enum.map(modules, &remove/1)

    try do
      Process.sleep(hold_ms)
    after
      Enum.each(removed, &restore/1)
    end

    %{count: length(removed), modules: modules}
  end

  defp project_module?(mod) do
    name = Atom.to_string(mod)

    String.starts_with?(name, "Elixir.Dojo") and
      not String.starts_with?(name, "Elixir.Dojo.Test.") and
      case :code.which(mod) do
        beam when is_list(beam) -> String.contains?(to_string(beam), "/lib/dojo/ebin/")
        _ -> false
      end
  end

  @doc """
  Run `n` back-to-back reload cycles — a save-storm, the shape of a rename
  sweep or a formatter-on-save loop.
  """
  def storm(module, n, hold_ms, gap_ms \\ 50) do
    for _ <- 1..n do
      out = reload_cycle(module, hold_ms)
      Process.sleep(gap_ms)
      out
    end
  end
end
