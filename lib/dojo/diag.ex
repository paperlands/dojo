defmodule Dojo.Diag do
  @moduledoc """
  Runtime diagnostics for BEAM VM, processes, ETS, and schedulers.

  Complements `Dojo.Cluster.Diag` (cluster topology) with node-local
  resource analysis. All functions are IEx-friendly.

      Dojo.Diag.memory()
      Dojo.Diag.top(20, :reductions)
      Dojo.Diag.ets()
      Dojo.Diag.schedulers(2000)
      Dojo.Diag.partisan()
      Dojo.Diag.snapshot()
      Dojo.Diag.watch(5000)
      Dojo.Diag.unwatch()
  """

  # ── Memory ────────────────────────────────────────────────────────────

  @doc "BEAM memory breakdown with allocator fragmentation and limits."
  def memory do
    mem = :erlang.memory()
    total = mem[:total]

    IO.puts("=== BEAM Memory ===")

    for {key, label} <- [
          {:total, "Total"},
          {:processes_used, "Processes"},
          {:ets, "ETS"},
          {:binary, "Binary"},
          {:atom_used, "Atom"},
          {:code, "Code"},
          {:system, "System"}
        ] do
      val = mem[key]
      pct = if total > 0, do: Float.round(val / total * 100, 1), else: 0.0
      IO.puts("  #{String.pad_trailing(label <> ":", 12)} #{fmt_bytes(val)}  (#{pct}%)")
    end

    # Allocator fragmentation
    try do
      used = :recon_alloc.memory(:used)
      allocated = :recon_alloc.memory(:allocated)
      frag = if allocated > 0, do: Float.round((1 - used / allocated) * 100, 1), else: 0.0
      IO.puts("")

      IO.puts(
        "  Allocator: used=#{fmt_bytes(used)}  allocated=#{fmt_bytes(allocated)}  frag=#{frag}%"
      )
    rescue
      _ -> :ok
    end

    # Limits
    procs = :erlang.system_info(:process_count)
    proc_limit = :erlang.system_info(:process_limit)
    ports = :erlang.system_info(:port_count)
    port_limit = :erlang.system_info(:port_limit)

    IO.puts("")
    IO.puts("  Processes:  #{procs} / #{proc_limit}")
    IO.puts("  Ports:      #{ports} / #{port_limit}")
    :ok
  end

  # ── Top Processes ─────────────────────────────────────────────────────

  @doc """
  Top N processes by `:memory`, `:reductions`, or `:message_queue_len`.
  """
  def top(n \\ 20, sort_by \\ :memory)
      when sort_by in [:memory, :reductions, :message_queue_len] do
    results = :recon.proc_count(sort_by, n)

    header =
      case sort_by do
        :memory -> "MEM"
        :reductions -> "REDS"
        :message_queue_len -> "MSGQ"
      end

    IO.puts("=== Top #{n} by #{header} ===")

    IO.puts(
      "  #{pad("PID", 18)} #{pad("NAME", 38)} #{pad("CURRENT", 28)} #{rpad(header, 10)} #{rpad("MEM(KB)", 10)} #{rpad("MSGQ", 6)}"
    )

    IO.puts("  #{String.duplicate("-", 120)}")

    Enum.each(results, fn {pid, sort_val, info} ->
      pinfo = safe_process_info(pid)
      name = process_name(info, pinfo)
      current = fmt_mfa(pinfo[:current_function])
      mem_kb = div(pinfo[:memory] || 0, 1024)
      msgq = pinfo[:message_queue_len] || 0

      sort_display =
        case sort_by do
          :memory -> "#{div(sort_val, 1024)}"
          :reductions -> "#{div(sort_val, 1000)}K"
          :message_queue_len -> "#{sort_val}"
        end

      IO.puts(
        "  #{pad(inspect(pid), 18)} #{pad(name, 38)} #{pad(current, 28)} #{rpad(sort_display, 10)} #{rpad("#{mem_kb}", 10)} #{rpad("#{msgq}", 6)}"
      )
    end)

    :ok
  end

  # ── ETS Tables ────────────────────────────────────────────────────────

  @doc "All ETS tables sorted by memory usage."
  def ets do
    word_size = :erlang.system_info(:wordsize)

    tables =
      :ets.all()
      |> Enum.map(fn tab ->
        %{
          id: tab,
          name: safe_ets_info(tab, :name),
          type: safe_ets_info(tab, :type),
          size: safe_ets_info(tab, :size) || 0,
          memory: (safe_ets_info(tab, :memory) || 0) * word_size,
          owner: safe_ets_info(tab, :owner),
          protection: safe_ets_info(tab, :protection)
        }
      end)
      |> Enum.sort_by(& &1.memory, :desc)

    total_mem = Enum.sum(Enum.map(tables, & &1.memory))

    IO.puts("=== ETS Tables (#{length(tables)}) ===")

    IO.puts(
      "  #{pad("NAME", 40)} #{pad("TYPE", 12)} #{rpad("SIZE", 10)} #{rpad("MEMORY", 12)} #{pad("OWNER", 30)} #{pad("PROT", 10)}"
    )

    IO.puts("  #{String.duplicate("-", 120)}")

    Enum.each(tables, fn t ->
      owner_name = process_name_for_pid(t.owner)

      IO.puts(
        "  #{pad(fmt_ets_name(t.name), 40)} #{pad("#{t.type}", 12)} #{rpad("#{t.size}", 10)} #{rpad(fmt_bytes(t.memory), 12)} #{pad(owner_name, 30)} #{pad("#{t.protection}", 10)}"
      )
    end)

    IO.puts("  #{String.duplicate("-", 120)}")
    IO.puts("  Total: #{fmt_bytes(total_mem)}")
    :ok
  end

  # ── Scheduler Utilization ─────────────────────────────────────────────

  @doc "Per-scheduler utilization over `sample_ms` window."
  def schedulers(sample_ms \\ 1000) do
    IO.puts("=== Scheduler Utilization (#{sample_ms}ms sample) ===")
    IO.puts("  Sampling...")

    usage = :recon.scheduler_usage(sample_ms)

    {normal, dirty} = Enum.split_with(usage, fn {id, _} -> is_integer(id) end)

    total_util = 0.0

    total_util =
      Enum.reduce(normal, total_util, fn {id, util}, acc ->
        pct = Float.round(util * 100, 1)
        bar_len = round(util * 30)
        bar = String.duplicate("\u2588", bar_len) <> String.duplicate("\u2591", 30 - bar_len)
        IO.puts("  ##{String.pad_leading("#{id}", 2)}  [#{bar}]  #{pct}%")
        acc + util
      end)

    avg = if length(normal) > 0, do: Float.round(total_util / length(normal) * 100, 1), else: 0.0
    IO.puts("")
    IO.puts("  Average: #{avg}%")

    if dirty != [] do
      IO.puts("  Dirty schedulers:")

      Enum.each(dirty, fn {id, util} ->
        pct = Float.round(util * 100, 1)
        IO.puts("    #{id}: #{pct}%")
      end)
    end

    run_queue = :erlang.statistics(:run_queue)
    IO.puts("  Run queue: #{run_queue}")
    IO.puts("  Schedulers online: #{:erlang.system_info(:schedulers_online)}")
    IO.puts("  Dirty CPU: #{:erlang.system_info(:dirty_cpu_schedulers_online)}")
    IO.puts("  Dirty IO:  #{:erlang.system_info(:dirty_io_schedulers)}")
    :ok
  end

  # ── Partisan Resources ───────────────────────────────────────────────

  @doc "Partisan connection process memory, plumtree state, member count."
  def partisan do
    IO.puts("=== Partisan Resources ===")

    # Connection inventory
    case safe(fn -> :partisan_peer_connections.nodes() end) do
      nodes when is_list(nodes) ->
        total_mem = 0
        total_conns = 0

        {total_conns, total_mem} =
          Enum.reduce(nodes, {total_conns, total_mem}, fn node, {tc, tm} ->
            conns = safe(fn -> :partisan_peer_connections.connections(node) end) || []
            count = length(conns)

            mem =
              Enum.sum(
                Enum.map(conns, fn conn ->
                  pid = safe(fn -> :partisan_peer_connections.pid(conn) end)

                  if is_pid(pid) do
                    case Process.info(pid, :memory) do
                      {:memory, m} -> m
                      _ -> 0
                    end
                  else
                    0
                  end
                end)
              )

            IO.puts("  #{node}: #{count} conns, #{fmt_bytes(mem)}")
            {tc + count, tm + mem}
          end)

        IO.puts("  Total: #{length(nodes)} nodes, #{total_conns} conns, #{fmt_bytes(total_mem)}")

      err ->
        IO.puts("  Connections: #{inspect(err)}")
    end

    IO.puts("")

    # Plumtree state
    case safe(fn -> :partisan_plumtree_broadcast.broadcast_members() end) do
      {:ok, members} when is_list(members) ->
        IO.puts("  Broadcast members: #{length(members)}")

      other ->
        IO.puts("  Broadcast members: #{inspect(other)}")
    end

    case safe(fn -> :partisan_plumtree_broadcast.exchanges() end) do
      {:ok, exchanges} when is_list(exchanges) ->
        IO.puts("  Active exchanges: #{length(exchanges)}")

      _ ->
        :ok
    end

    # Partisan ETS tables
    IO.puts("")
    IO.puts("  ETS tables:")
    word_size = :erlang.system_info(:wordsize)

    for name <- [:partisan_peer_connections, :mdns_known_peers, :partisan_config] do
      case safe(fn -> :ets.info(name) end) do
        info when is_list(info) ->
          size = Keyword.get(info, :size, 0)
          mem = Keyword.get(info, :memory, 0) * word_size
          IO.puts("    #{name}: #{size} entries, #{fmt_bytes(mem)}")

        _ ->
          :ok
      end
    end

    :ok
  end

  # ── Network IO ─────────────────────────────────────────────────────────

  @doc """
  Per-socket TCP stats for all Partisan connections.

  Shows bytes sent/received, packet counts, and avg packet sizes.
  With `window_ms`, takes two snapshots and shows the delta (bandwidth).

      Dojo.Diag.net()          # current totals
      Dojo.Diag.net(5000)      # 5-second bandwidth measurement
  """
  def net(window_ms \\ 0) do
    conns = partisan_socket_stats()

    if window_ms > 0 do
      IO.puts("=== Network IO (#{window_ms}ms window) ===")
      IO.puts("  Sampling...")
      t1 = conns
      Process.sleep(window_ms)
      t2 = partisan_socket_stats()
      secs = window_ms / 1000

      rows =
        Enum.map(t2, fn s2 ->
          s1 = Enum.find(t1, fn s -> s.port == s2.port end)

          if s1 do
            %{
              s2
              | recv_oct: s2.recv_oct - s1.recv_oct,
                send_oct: s2.send_oct - s1.send_oct,
                recv_cnt: s2.recv_cnt - s1.recv_cnt,
                send_cnt: s2.send_cnt - s1.send_cnt
            }
          else
            s2
          end
        end)
        |> Enum.sort_by(fn s -> s.recv_oct + s.send_oct end, :desc)

      IO.puts(
        "  #{pad("PEER", 30)} #{pad("CH", 12)} #{rpad("RECV", 12)} #{rpad("SEND", 12)} #{rpad("RECV/s", 10)} #{rpad("SEND/s", 10)} #{rpad("PKT_IN", 8)} #{rpad("PKT_OUT", 8)}"
      )

      IO.puts("  #{String.duplicate("-", 110)}")

      total_recv = Enum.sum(Enum.map(rows, & &1.recv_oct))
      total_send = Enum.sum(Enum.map(rows, & &1.send_oct))

      Enum.each(rows, fn s ->
        recv_s = fmt_rate(s.recv_oct, secs)
        send_s = fmt_rate(s.send_oct, secs)

        IO.puts(
          "  #{pad(short_node(s.node), 30)} #{pad("#{s.channel}", 12)} #{rpad(fmt_bytes(s.recv_oct), 12)} #{rpad(fmt_bytes(s.send_oct), 12)} #{rpad(recv_s, 10)} #{rpad(send_s, 10)} #{rpad("#{s.recv_cnt}", 8)} #{rpad("#{s.send_cnt}", 8)}"
        )
      end)

      IO.puts("  #{String.duplicate("-", 110)}")

      IO.puts(
        "  Total: recv=#{fmt_bytes(total_recv)} (#{fmt_rate(total_recv, secs)})  send=#{fmt_bytes(total_send)} (#{fmt_rate(total_send, secs)})"
      )
    else
      IO.puts("=== Network IO (cumulative) ===")

      IO.puts(
        "  #{pad("PEER", 30)} #{pad("CH", 12)} #{rpad("RECV", 12)} #{rpad("SEND", 12)} #{rpad("PKT_IN", 8)} #{rpad("PKT_OUT", 8)} #{rpad("AVG_IN", 8)} #{rpad("AVG_OUT", 8)}"
      )

      IO.puts("  #{String.duplicate("-", 100)}")

      rows = Enum.sort_by(conns, fn s -> s.recv_oct + s.send_oct end, :desc)

      Enum.each(rows, fn s ->
        IO.puts(
          "  #{pad(short_node(s.node), 30)} #{pad("#{s.channel}", 12)} #{rpad(fmt_bytes(s.recv_oct), 12)} #{rpad(fmt_bytes(s.send_oct), 12)} #{rpad("#{s.recv_cnt}", 8)} #{rpad("#{s.send_cnt}", 8)} #{rpad("#{s.recv_avg}", 8)} #{rpad("#{s.send_avg}", 8)}"
        )
      end)

      total_recv = Enum.sum(Enum.map(rows, & &1.recv_oct))
      total_send = Enum.sum(Enum.map(rows, & &1.send_oct))
      IO.puts("  #{String.duplicate("-", 100)}")
      IO.puts("  Total: recv=#{fmt_bytes(total_recv)}  send=#{fmt_bytes(total_send)}")
    end

    :ok
  end

  # ── Process Activity Window ──────────────────────────────────────────

  @doc """
  Top N processes by activity DELTA over a time window.

  Unlike `top/2` which shows cumulative stats, this measures what
  processes are doing RIGHT NOW — reductions burned, memory allocated,
  or messages queued during the window.

      Dojo.Diag.hot(10, :reductions, 3000)   # who's burning CPU over 3s
      Dojo.Diag.hot(10, :memory, 5000)       # who's allocating over 5s
  """
  def hot(n \\ 20, sort_by \\ :reductions, window_ms \\ 3000)
      when sort_by in [:memory, :reductions, :message_queue_len] do
    header =
      case sort_by do
        :memory -> "MEM_DELTA"
        :reductions -> "REDS_DELTA"
        :message_queue_len -> "MSGQ"
      end

    IO.puts("=== Hot #{n} by #{header} (#{window_ms}ms window) ===")
    IO.puts("  Sampling...")

    results = :recon.proc_window(sort_by, n, window_ms)

    IO.puts(
      "  #{pad("PID", 18)} #{pad("NAME", 38)} #{pad("CURRENT", 28)} #{rpad(header, 12)} #{rpad("MEM(KB)", 10)} #{rpad("MSGQ", 6)}"
    )

    IO.puts("  #{String.duplicate("-", 120)}")

    Enum.each(results, fn {pid, delta_val, info} ->
      pinfo = safe_process_info(pid)
      name = process_name(info, pinfo)
      current = fmt_mfa(pinfo[:current_function])
      mem_kb = div(pinfo[:memory] || 0, 1024)
      msgq = pinfo[:message_queue_len] || 0

      delta_display =
        case sort_by do
          :memory -> fmt_bytes(delta_val)
          :reductions -> "#{div(delta_val, 1000)}K"
          :message_queue_len -> "#{delta_val}"
        end

      IO.puts(
        "  #{pad(inspect(pid), 18)} #{pad(name, 38)} #{pad(current, 28)} #{rpad(delta_display, 12)} #{rpad("#{mem_kb}", 10)} #{rpad("#{msgq}", 6)}"
      )
    end)

    :ok
  end

  # ── Message Tracing ──────────────────────────────────────────────────

  @doc """
  Trace Plumtree broadcast sends. Shows what's being gossipped.

  Rate-limited to `max_per_sec` traces/second. Call `untrace()` to stop.

      Dojo.Diag.trace_broadcasts()      # 5 traces/sec
      Dojo.Diag.trace_broadcasts(1)     # 1 trace/sec (calmer)
  """
  def trace_broadcasts(max_per_sec \\ 5) do
    IO.puts(
      "Tracing Plumtree broadcasts (max #{max_per_sec}/s). Call Dojo.Diag.untrace() to stop."
    )

    :recon_trace.calls(
      {:partisan_plumtree_broadcast, :broadcast, 2},
      {max_per_sec, 1000},
      [{:io_server, Process.group_leader()}, {:formatter, &fmt_trace/1}]
    )
  end

  @doc """
  Trace Partisan socket sends on the data channel. Shows raw send volume.

      Dojo.Diag.trace_sends()
  """
  def trace_sends(max_per_sec \\ 10) do
    IO.puts(
      "Tracing partisan socket sends (max #{max_per_sec}/s). Call Dojo.Diag.untrace() to stop."
    )

    :recon_trace.calls(
      {:partisan_peer_service_client, :handle_cast, 2},
      {max_per_sec, 1000},
      [{:io_server, Process.group_leader()}, {:formatter, &fmt_trace/1}]
    )
  end

  @doc """
  Trace messages arriving at a specific process.

      Dojo.Diag.trace_pid(pid, 10)   # 10 traces/sec
  """
  def trace_pid(pid, max_per_sec \\ 5) when is_pid(pid) do
    name = process_name_for_pid(pid)

    IO.puts(
      "Tracing messages to #{name} (max #{max_per_sec}/s). Call Dojo.Diag.untrace() to stop."
    )

    :recon_trace.calls(
      {:erlang, :send, [{:pid, pid}]},
      {max_per_sec, 1000},
      [{:io_server, Process.group_leader()}]
    )
  end

  @doc "Stop all active traces."
  def untrace do
    :recon_trace.clear()
    IO.puts("All traces cleared.")
    :ok
  end

  # ── Correlate: network → process ─────────────────────────────────────

  @doc """
  Identify which Partisan connections are hottest and correlate to
  peer node, channel, and owning process state.

  Measures socket IO over `window_ms` and ranks by total bytes.

      Dojo.Diag.hotconns(5000)   # 5-second sample
  """
  def hotconns(window_ms \\ 3000) do
    IO.puts("=== Hot Connections (#{window_ms}ms window) ===")
    IO.puts("  Sampling...")

    t1 = partisan_socket_stats()
    Process.sleep(window_ms)
    t2 = partisan_socket_stats()
    secs = window_ms / 1000

    deltas =
      Enum.map(t2, fn s2 ->
        s1 = Enum.find(t1, fn s -> s.port == s2.port end)

        delta_recv = if s1, do: s2.recv_oct - s1.recv_oct, else: s2.recv_oct
        delta_send = if s1, do: s2.send_oct - s1.send_oct, else: s2.send_oct

        %{
          node: s2.node,
          channel: s2.channel,
          pid: s2.pid,
          port: s2.port,
          recv: delta_recv,
          send: delta_send,
          total: delta_recv + delta_send,
          msgq: s2.msgq,
          proc_mem: s2.proc_mem,
          reductions: s2.reductions
        }
      end)
      |> Enum.sort_by(& &1.total, :desc)

    IO.puts("")

    Enum.each(deltas, fn d ->
      recv_s = fmt_rate(d.recv, secs)
      send_s = fmt_rate(d.send, secs)

      IO.puts("  #{short_node(d.node)} :#{d.channel}")
      IO.puts("    pid=#{inspect(d.pid)}  port=#{inspect(d.port)}")
      IO.puts("    recv=#{recv_s}  send=#{send_s}  total=#{fmt_rate(d.total, secs)}")

      IO.puts(
        "    proc_mem=#{fmt_bytes(d.proc_mem)}  msgq=#{d.msgq}  reds=#{div(d.reductions, 1000)}K"
      )

      IO.puts("")
    end)

    total = Enum.sum(Enum.map(deltas, & &1.total))
    IO.puts("  Aggregate: #{fmt_rate(total, secs)}")
    :ok
  end

  # ── Snapshot ──────────────────────────────────────────────────────────

  @doc "Combined diagnostic report."
  def snapshot do
    IO.puts("╔══════════════════════════════════════════════════════════════╗")
    IO.puts("║  Dojo Diagnostics — #{DateTime.utc_now() |> DateTime.truncate(:second)}  ║")
    IO.puts("╚══════════════════════════════════════════════════════════════╝")
    IO.puts("")

    memory()
    IO.puts("")
    top(10, :memory)
    IO.puts("")
    top(5, :reductions)
    IO.puts("")
    top(5, :message_queue_len)
    IO.puts("")
    ets()
    IO.puts("")
    schedulers(1000)
    IO.puts("")
    partisan()
    IO.puts("")
    net(3000)
    IO.puts("")

    try do
      Dojo.Cluster.Diag.summary()
    rescue
      _ -> IO.puts("  (Cluster.Diag unavailable)")
    end

    :ok
  end

  # ── Telemetry Integration ─────────────────────────────────────────────

  @doc false
  def emit_vm_stats do
    mem = :erlang.memory()
    {plumtree_mq, plumtree_mem} = plumtree_stats()

    :telemetry.execute(
      [:dojo, :vm],
      %{
        memory_total: mem[:total],
        memory_processes: mem[:processes_used],
        memory_ets: mem[:ets],
        memory_binary: mem[:binary],
        process_count: :erlang.system_info(:process_count),
        port_count: :erlang.system_info(:port_count),
        run_queue: :erlang.statistics(:run_queue),
        plumtree_mq: plumtree_mq,
        plumtree_mem: plumtree_mem
      },
      %{}
    )
  end

  defp plumtree_stats do
    case Process.whereis(:partisan_plumtree_broadcast) do
      nil ->
        {0, 0}

      pid ->
        mq =
          case Process.info(pid, :message_queue_len) do
            {:message_queue_len, l} -> l
            _ -> 0
          end

        mem =
          case Process.info(pid, :memory) do
            {:memory, m} -> m
            _ -> 0
          end

        {mq, mem}
    end
  end

  # ── Watch (periodic compact report) ──────────────────────────────────

  @doc "Start periodic compact diagnostics to console."
  def watch(interval_ms \\ 5000) do
    case Process.whereis(Dojo.Diag.Watcher) do
      nil -> :ok
      _pid -> Dojo.Diag.Watcher.stop()
    end

    {:ok, _} = Dojo.Diag.Watcher.start_link(interval_ms)
    IO.puts("Watching every #{interval_ms}ms. Call Dojo.Diag.unwatch() to stop.")
    :ok
  end

  @doc "Stop the periodic watcher."
  def unwatch do
    Dojo.Diag.Watcher.stop()
    IO.puts("Watcher stopped.")
    :ok
  end

  @doc false
  def compact_line do
    mem = :erlang.memory()
    mem_mb = div(mem[:total], 1_048_576)
    ets_mb = div(mem[:ets], 1_048_576)
    bin_mb = div(mem[:binary], 1_048_576)
    procs = :erlang.system_info(:process_count)
    run_q = :erlang.statistics(:run_queue)

    # Max message queue across all processes (sampled)
    mqmax =
      :erlang.processes()
      |> Enum.reduce(0, fn pid, acc ->
        case Process.info(pid, :message_queue_len) do
          {:message_queue_len, len} -> max(acc, len)
          _ -> acc
        end
      end)

    partisan_conns =
      case safe(fn -> :partisan_peer_connections.nodes() end) do
        nodes when is_list(nodes) ->
          Enum.sum(
            Enum.map(nodes, fn n ->
              case safe(fn -> :partisan_peer_connections.count(n) end) do
                c when is_integer(c) -> c
                _ -> 0
              end
            end)
          )

        _ ->
          0
      end

    # Network IO snapshot (cheap — no sleep, just current totals)
    {net_recv, net_send} =
      case safe(fn -> :partisan_peer_connections.nodes() end) do
        nodes when is_list(nodes) ->
          Enum.reduce(nodes, {0, 0}, fn node, {r, s} ->
            conns = safe(fn -> :partisan_peer_connections.connections(node) end) || []

            Enum.reduce(conns, {r, s}, fn conn, {r2, s2} ->
              pid = safe(fn -> :partisan_peer_connections.pid(conn) end)

              if is_pid(pid) and Process.alive?(pid) do
                port = find_tcp_port(pid)

                case port && socket_stats(port) do
                  %{recv_oct: ro, send_oct: so} -> {r2 + ro, s2 + so}
                  _ -> {r2, s2}
                end
              else
                {r2, s2}
              end
            end)
          end)

        _ ->
          {0, 0}
      end

    net_recv_kb = div(net_recv, 1024)
    net_send_kb = div(net_send, 1024)

    {plumtree_mq, _plumtree_mem} = plumtree_stats()

    outstanding =
      case safe(fn -> :ets.info(:partisan_plumtree_broadcast, :size) end) do
        n when is_integer(n) -> n
        _ -> 0
      end

    time = Calendar.strftime(DateTime.utc_now(), "%H:%M:%S")

    "[#{time}] mem=#{mem_mb}MB bin=#{bin_mb}MB ets=#{ets_mb}MB procs=#{procs} runq=#{run_q} mqmax=#{mqmax} partisan=#{partisan_conns}conns net=#{net_recv_kb}K/#{net_send_kb}K plumtree_mq=#{plumtree_mq} outstanding=#{outstanding}"
  end

  # ── Formatting Helpers ───────────────────────────────────────────────

  defp fmt_bytes(bytes) when bytes >= 1_048_576, do: "#{Float.round(bytes / 1_048_576, 1)} MB"
  defp fmt_bytes(bytes) when bytes >= 1024, do: "#{Float.round(bytes / 1024, 1)} KB"
  defp fmt_bytes(bytes), do: "#{bytes} B"

  defp fmt_rate(bytes, secs) when secs > 0 do
    bps = bytes / secs

    cond do
      bps >= 1_048_576 -> "#{Float.round(bps / 1_048_576, 1)} MB/s"
      bps >= 1024 -> "#{Float.round(bps / 1024, 1)} KB/s"
      true -> "#{round(bps)} B/s"
    end
  end

  defp fmt_rate(_, _), do: "?"

  defp pad(str, width), do: String.pad_trailing(String.slice(to_string(str), 0, width), width)
  defp rpad(str, width), do: String.pad_leading(String.slice(to_string(str), 0, width), width)

  defp fmt_mfa({m, f, a}), do: "#{inspect(m)}.#{f}/#{a}"
  defp fmt_mfa(nil), do: "?"
  defp fmt_mfa(other), do: inspect(other)

  defp fmt_ets_name(name) when is_atom(name), do: Atom.to_string(name)
  defp fmt_ets_name(ref) when is_reference(ref), do: inspect(ref)
  defp fmt_ets_name(other), do: inspect(other)

  defp short_node(name) when is_atom(name) do
    name
    |> Atom.to_string()
    |> String.replace(~r/@.*-.*-.*-.*-/, "@")
    |> String.slice(0, 28)
  end

  defp short_node(other), do: inspect(other)

  defp safe_process_info(pid) do
    case Process.info(pid, [
           :registered_name,
           :current_function,
           :memory,
           :message_queue_len,
           :reductions,
           :initial_call
         ]) do
      nil -> %{}
      info -> Map.new(info)
    end
  end

  defp process_name(recon_info, pinfo) do
    cond do
      is_list(recon_info) and Keyword.has_key?(recon_info, :registered_name) ->
        inspect(recon_info[:registered_name])

      is_map(pinfo) and pinfo[:registered_name] not in [nil, []] ->
        inspect(pinfo[:registered_name])

      is_list(recon_info) and Keyword.has_key?(recon_info, :initial_call) ->
        fmt_mfa(recon_info[:initial_call])

      is_map(pinfo) and pinfo[:initial_call] != nil ->
        fmt_mfa(pinfo[:initial_call])

      true ->
        "?"
    end
  end

  defp process_name_for_pid(pid) when is_pid(pid) do
    case Process.info(pid, :registered_name) do
      {:registered_name, name} when name != [] -> inspect(name)
      _ -> inspect(pid)
    end
  end

  defp process_name_for_pid(other), do: inspect(other)

  # ── Network Helpers ──────────────────────────────────────────────────

  # Collect per-socket TCP stats for all Partisan connections.
  # Walks the partisan_peer_connections ETS, resolves each connection PID
  # to its linked port (TCP socket), and calls :inet.getstat/1.
  defp partisan_socket_stats do
    case safe(fn -> :partisan_peer_connections.nodes() end) do
      nodes when is_list(nodes) ->
        Enum.flat_map(nodes, fn node ->
          conns = safe(fn -> :partisan_peer_connections.connections(node) end) || []

          Enum.flat_map(conns, fn conn ->
            pid = safe(fn -> :partisan_peer_connections.pid(conn) end)
            channel = safe(fn -> :partisan_peer_connections.channel(conn) end)

            if is_pid(pid) and Process.alive?(pid) do
              port = find_tcp_port(pid)
              stats = if port, do: socket_stats(port), else: %{}
              pinfo = safe_process_info(pid)

              [
                %{
                  node: node,
                  channel: channel,
                  pid: pid,
                  port: port,
                  recv_oct: stats[:recv_oct] || 0,
                  send_oct: stats[:send_oct] || 0,
                  recv_cnt: stats[:recv_cnt] || 0,
                  send_cnt: stats[:send_cnt] || 0,
                  recv_avg: stats[:recv_avg] || 0,
                  send_avg: stats[:send_avg] || 0,
                  msgq: pinfo[:message_queue_len] || 0,
                  proc_mem: pinfo[:memory] || 0,
                  reductions: pinfo[:reductions] || 0
                }
              ]
            else
              []
            end
          end)
        end)

      _ ->
        []
    end
  end

  # Find the TCP port owned by a Partisan connection process.
  # The connection process links to its TCP socket port.
  defp find_tcp_port(pid) do
    case Process.info(pid, :links) do
      {:links, links} ->
        Enum.find(links, fn
          link when is_port(link) ->
            case :erlang.port_info(link, :name) do
              {:name, name} -> name in [~c"tcp_inet", ~c"ssl_inet"]
              _ -> false
            end

          _ ->
            false
        end)

      _ ->
        nil
    end
  end

  defp socket_stats(port) when is_port(port) do
    case :inet.getstat(port, [:recv_oct, :send_oct, :recv_cnt, :send_cnt, :recv_avg, :send_avg]) do
      {:ok, stats} -> Map.new(stats)
      _ -> %{}
    end
  end

  defp socket_stats(_), do: %{}

  defp fmt_trace(trace_msg) do
    try do
      info = :recon_trace.format(trace_msg)
      # Truncate long traces to keep output readable
      str = IO.iodata_to_binary(info)

      if byte_size(str) > 500 do
        String.slice(str, 0, 500) <> "...\n"
      else
        str
      end
    rescue
      _ -> "  (trace format error)\n"
    end
  end

  defp safe_ets_info(tab, key) do
    :ets.info(tab, key)
  rescue
    _ -> nil
  catch
    _ -> nil
  end

  defp safe(fun) do
    fun.()
  rescue
    _ -> nil
  catch
    :exit, _ -> nil
  end
end

defmodule Dojo.Diag.Watcher do
  @moduledoc false
  use GenServer

  def start_link(interval_ms) do
    GenServer.start_link(__MODULE__, interval_ms, name: __MODULE__)
  end

  def stop do
    GenServer.stop(__MODULE__, :normal)
  catch
    :exit, {:noproc, _} -> :ok
    :exit, :noproc -> :ok
  end

  @impl true
  def init(interval_ms) do
    tref = Process.send_after(self(), :tick, interval_ms)
    {:ok, %{interval: interval_ms, tref: tref}}
  end

  @impl true
  def handle_info(:tick, state) do
    IO.puts(Dojo.Diag.compact_line())
    tref = Process.send_after(self(), :tick, state.interval)
    {:noreply, %{state | tref: tref}}
  end
end
