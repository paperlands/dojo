defmodule Dojo.Cluster.Diag do
  @moduledoc """
  Unified cluster diagnostics across all layers.

  Aggregates state from:
  - **mDNS** — socket, cache, interfaces, announce schedule
  - **Transport** — Partisan (HyParView views, connections, config) or ERTS (Node.list, epmd)
  - **Network** — interface report with filter verdicts

  Usage from IEx:

      Dojo.Cluster.Diag.report() |> IO.inspect(limit: :infinity)

  Or for a human-readable summary:

      Dojo.Cluster.Diag.summary()
  """

  @doc """
  Return a comprehensive diagnostic map from all cluster layers.
  """
  def report do
    mdns = mdns_diag()
    adapter = adapter_module()

    transport =
      if function_exported?(adapter, :diag, 0) do
        adapter.diag()
      else
        %{adapter: adapter, note: "no diag/0 callback"}
      end

    %{
      timestamp: DateTime.utc_now(),
      mdns: mdns,
      transport: transport,
      adapter: adapter,
      os: os_info(),
      vm: vm_info()
    }
  end

  @doc """
  Print a human-readable cluster health summary to stdout.
  """
  def summary do
    r = report()

    IO.puts("=== Cluster Diagnostic Summary ===")
    IO.puts("  Time:    #{r.timestamp}")
    IO.puts("  OS:      #{r.os.type} #{r.os.version}")
    IO.puts("  Adapter: #{inspect(r.adapter)}")
    IO.puts("")

    # mDNS layer
    mdns = r.mdns
    IO.puts("--- mDNS ---")

    case mdns do
      {:error, :not_running} ->
        IO.puts("  STATUS: NOT RUNNING")

      %{} ->
        IO.puts("  Socket:   #{inspect(mdns.socket)}")
        IO.puts("  Identity: #{mdns.own_name}:#{mdns.own_port}")
        IO.puts("  Cache:    #{mdns.cache_size} peers")

        Enum.each(mdns.cache || %{}, fn {name, entry} ->
          age = System.monotonic_time(:second) - entry.seen_at

          IO.puts(
            "    #{name} @ #{fmt_ip(entry.ip)}:#{entry.port} (#{age}s ago, missed=#{entry.missed_queries})"
          )
        end)

        IO.puts("  Announce: interval=#{mdns.announce_interval}s")
        IO.puts("  Debug:    #{mdns.debug}")

        # Interface report
        selected = Enum.filter(mdns.interfaces || [], & &1.selected)
        rejected = Enum.reject(mdns.interfaces || [], & &1.selected)

        IO.puts("  Interfaces (#{length(selected)} selected):")

        Enum.each(selected, fn i ->
          IO.puts("    >> #{i.name} #{inspect(i.routable_addrs)}")
        end)

        if rejected != [] do
          IO.puts("  Filtered out:")

          Enum.each(rejected, fn i ->
            reason =
              cond do
                i.virtual -> "virtual"
                not i.up -> "down"
                i.routable_addrs == [] -> "no routable addr"
                true -> "unknown"
              end

            IO.puts("    -- #{i.name} (#{reason}) #{inspect(i.addrs)}")
          end)
        end
    end

    IO.puts("")

    # Transport layer
    IO.puts("--- Transport (#{inspect(r.adapter)}) ---")
    print_transport(r.adapter, r.transport)

    IO.puts("")
    IO.puts("=== End ===")
    :ok
  end

  # ── Transport printers ──────────────────────────────────────────────

  defp print_transport(Dojo.Cluster.MDNS.PartisanAdapter, t) do
    IO.puts("  Identity: #{inspect(t[:identity])}")

    case t[:members] do
      {:ok, members} -> IO.puts("  Members:  #{inspect(members)}")
      other -> IO.puts("  Members:  #{inspect(other)}")
    end

    case t[:hyparview] do
      %{active_view: av, passive_view: pv} ->
        IO.puts("  Active:   #{inspect(av)} (#{length(av)})")
        IO.puts("  Passive:  #{inspect(pv)} (#{length(pv)})")

      other ->
        IO.puts("  HyParView: #{inspect(other)}")
    end

    case t[:connections] do
      conns when is_list(conns) ->
        IO.puts("  Connections (#{length(conns)}):")

        Enum.each(conns, fn c ->
          IO.puts("    #{c.node} count=#{c.connection_count} full=#{c.fully_connected}")

          Enum.each(c.channels || [], fn ch ->
            IO.puts(
              "      ch=#{ch.channel} pid=#{inspect(ch.pid)} addr=#{inspect(ch.listen_addr)}"
            )
          end)
        end)

      other ->
        IO.puts("  Connections: #{inspect(other)}")
    end

    IO.puts("  Discovery: #{inspect(t[:discovery_agent])}")

    case t[:config] do
      %{} = cfg ->
        IO.puts("  Config:")
        IO.puts("    name:           #{inspect(cfg[:name])}")
        IO.puts("    listen_addrs:   #{inspect(cfg[:listen_addrs])}")
        IO.puts("    parallelism:    #{cfg[:parallelism]}")
        IO.puts("    connect_disterl:#{cfg[:connect_disterl]}")
        IO.puts("    connect_timeout:#{cfg[:connect_timeout]}")

      other ->
        IO.puts("  Config: #{inspect(other)}")
    end
  end

  defp print_transport(Dojo.Cluster.MDNS.DistAdapter, t) do
    IO.puts("  Node:     #{t[:node]}")
    IO.puts("  Alive:    #{t[:alive]}")
    IO.puts("  Connected: #{inspect(t[:connected_nodes])}")
    IO.puts("  Hidden:   #{inspect(t[:hidden_nodes])}")

    case t[:net_kernel] do
      %{status: :running} = nk ->
        IO.puts("  net_kernel: running (pid=#{inspect(nk.pid)})")

      %{status: :not_running} ->
        IO.puts("  net_kernel: NOT RUNNING")

      other ->
        IO.puts("  net_kernel: #{inspect(other)}")
    end

    case t[:epmd] do
      names when is_list(names) ->
        IO.puts("  EPMD names: #{inspect(names)}")

      other ->
        IO.puts("  EPMD: #{inspect(other)}")
    end
  end

  defp print_transport(adapter, t) do
    IO.puts("  Adapter: #{inspect(adapter)}")
    IO.puts("  Data:    #{inspect(t, limit: :infinity, pretty: true)}")
  end

  # ── Helpers ─────────────────────────────────────────────────────────

  defp mdns_diag do
    Dojo.Cluster.MDNS.diag()
  catch
    :exit, _ -> {:error, :not_running}
  end

  defp adapter_module do
    Application.get_env(:dojo, :cluster_adapter, Dojo.Cluster.MDNS.PartisanAdapter)
  end

  defp os_info do
    {family, name} = :os.type()

    version =
      case :os.version() do
        {ma, mi, pa} -> "#{ma}.#{mi}.#{pa}"
        str -> to_string(str)
      end

    %{type: "#{family}/#{name}", version: version}
  end

  defp vm_info do
    %{
      otp_release: to_string(:erlang.system_info(:otp_release)),
      erts_version: to_string(:erlang.system_info(:version)),
      schedulers: :erlang.system_info(:schedulers_online)
    }
  end

  defp fmt_ip({a, b, c, d}), do: "#{a}.#{b}.#{c}.#{d}"
  defp fmt_ip(other), do: inspect(other)
end
