# Reload rig — reproduces the dev loop's crash window under control.
#
#   mix run scripts/verify/reload_rig.exs                 # 3 real recompiles
#   CYCLES=10 TARGET=lib/dojo/cluster/mdns.ex mix run scripts/verify/reload_rig.exs
#
# It edits a real source file, runs the real Mix compile inside the running
# node — the same path Phoenix.CodeReloader takes on a request, and the same
# path `listeners: [Phoenix.CodeReloader]` takes when another terminal
# compiles — then reports every process that died and every supervised child
# that came back with a new pid.
#
# The rig asserts nothing. Causation is not established; this prints evidence.

defmodule Rig.Recorder do
  @moduledoc "Captures every crash report in the node, in order."

  def start do
    :ets.new(:rig_crashes, [:named_table, :public, :duplicate_bag])

    :logger.add_handler(:rig_recorder, __MODULE__, %{
      level: :all,
      filter_default: :log,
      filters: []
    })
  end

  def stop do
    :logger.remove_handler(:rig_recorder)
    out = :ets.tab2list(:rig_crashes)
    :ets.delete(:rig_crashes)
    Enum.map(out, &elem(&1, 1))
  end

  def clear, do: :ets.delete_all_objects(:rig_crashes)

  # :logger handler callback.
  def log(%{level: level, msg: msg, meta: meta}, _config) when level in [:error, :warning] do
    if crash?(meta), do: :ets.insert(:rig_crashes, {:c, %{level: level, text: text(msg)}})
    :ok
  end

  def log(_, _), do: :ok

  defp crash?(meta) do
    case meta do
      %{error_logger: %{type: type}} -> type in [:crash_report, :supervisor_report]
      _ -> false
    end
  end

  defp text({:report, report}), do: inspect(report, limit: 12, printable_limit: 240)
  defp text({:string, s}), do: IO.iodata_to_binary(s)
  defp text({fmt, args}), do: fmt |> :io_lib.format(args) |> IO.iodata_to_binary()
end

defmodule Rig.Tree do
  @moduledoc "Walks the live supervision tree into a comparable shape."

  @roots [Dojo.Supervisor, Dojo.Cluster.Supervisor, DojoWeb.Endpoint]

  def snapshot do
    @roots
    |> Enum.filter(&Process.whereis/1)
    |> Enum.flat_map(&walk(&1, [&1]))
    |> Map.new()
  end

  defp walk(sup, path) do
    case safe_children(sup) do
      {:ok, children} ->
        Enum.flat_map(children, fn
          {id, pid, type, _mods} when is_pid(pid) ->
            here = [{Enum.reverse([id | path]), pid}]
            if type == :supervisor, do: here ++ walk(pid, [id | path]), else: here

          {id, state, _type, _mods} ->
            [{Enum.reverse([id | path]), state}]
        end)

      :error ->
        []
    end
  end

  defp safe_children(sup) do
    {:ok, Supervisor.which_children(sup)}
  catch
    _, _ -> :error
  end

  def diff(before, now) do
    %{
      died: for({p, pid} <- before, Map.get(now, p) == nil, do: {p, pid}),
      replaced:
        for(
          {p, pid} <- before,
          (new = Map.get(now, p)) && new != pid && is_pid(pid) && is_pid(new),
          do: {p, pid, new}
        ),
      appeared: for({p, pid} <- now, not Map.has_key?(before, p), do: {p, pid})
    }
  end
end

defmodule Rig do
  @default_target "lib/dojo/cluster/mdns.ex"

  def run do
    target = System.get_env("TARGET") || @default_target
    cycles = String.to_integer(System.get_env("CYCLES") || "3")
    settle = String.to_integer(System.get_env("SETTLE_MS") || "8000")

    unless File.exists?(target), do: abort("no such file: #{target}")

    banner(target, cycles, settle)
    Rig.Recorder.start()
    original = File.read!(target)

    try do
      for n <- 1..cycles do
        IO.puts("\n── cycle #{n}/#{cycles} ─────────────────────────────────")
        Rig.Recorder.clear()
        before = Rig.Tree.snapshot()

        touch(target, original, n)
        {us, result} = :timer.tc(fn -> recompile() end)
        IO.puts("   compile: #{inspect(result)} in #{div(us, 1000)}ms")

        # Long enough for every poller in the cluster tree to tick at least
        # once on the freshly-loaded code (NetworkMonitor 3s, MDNS 5s).
        Process.sleep(settle)

        report(Rig.Tree.diff(before, Rig.Tree.snapshot()), Rig.Recorder.stop())
        Rig.Recorder.start()
      end
    after
      File.write!(target, original)
      recompile()
      Rig.Recorder.stop()
      IO.puts("\n#{target} restored.")
    end
  end

  # A whitespace-only change still forces a full recompile of the module, so
  # the reload is real while the semantics stay untouched — functionality is
  # what the rig is trying not to break.
  defp touch(target, original, n) do
    File.write!(target, original <> "\n# rig cycle #{n}\n")
  end

  defp recompile do
    Mix.Task.reenable("compile")
    Mix.Task.reenable("compile.all")
    Mix.Task.reenable("compile.elixir")
    Mix.Task.run("compile", ["--no-deps-check"])
  catch
    kind, reason -> {:compile_failed, kind, reason}
  end

  defp report(diff, crashes) do
    tell("died", diff.died, fn {p, pid} -> "#{fmt(p)}  was #{inspect(pid)}" end)

    tell("restarted", diff.replaced, fn {p, a, b} ->
      "#{fmt(p)}  #{inspect(a)} → #{inspect(b)}"
    end)

    tell("appeared", diff.appeared, fn {p, pid} -> "#{fmt(p)}  #{inspect(pid)}" end)
    tell("crash reports", crashes, & &1.text)

    if diff.died == [] and diff.replaced == [] and crashes == [] do
      IO.puts("   clean — nothing died, nothing restarted")
    end
  end

  defp tell(_label, [], _fmt), do: :ok

  defp tell(label, items, fmt) do
    IO.puts("   #{label} (#{length(items)}):")
    Enum.each(items, fn i -> IO.puts("     • #{fmt.(i)}") end)
  end

  defp fmt(path), do: path |> Enum.map(&inspect/1) |> Enum.join(" / ")

  defp banner(target, cycles, settle) do
    IO.puts("""

    reload rig
      target  #{target}
      cycles  #{cycles}
      settle  #{settle}ms
      ips     #{inspect(Dojo.Cluster.MDNS.routable_ipv4_addrs())}
    """)
  end

  defp abort(msg) do
    IO.puts(:stderr, "reload rig: #{msg}")
    System.halt(1)
  end
end

Rig.run()
