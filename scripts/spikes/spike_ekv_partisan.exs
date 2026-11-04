# [⚡] SPIKE keep-spike-ekv — membership surface under Partisan
#
# Isolates contamination: each surface is measured on a FRESH 2-node mesh
# so :erpc/:send auto-connect cannot poison Node.list observations.
#
# Also contrasts resolvable shortnames vs Dojo-like unresolvable UUID hosts.
#
# Run:  MIX_ENV=dev mix run --no-start scripts/spikes/spike_ekv_partisan.exs

System.cmd("epmd", ["-daemon"], stderr_to_stdout: true)

defmodule Spike.EKVPartisan do
  @moduledoc false

  @cookie :spike_ekv
  @t 60_000
  @settle 3_000

  def main do
    IO.puts("\n══ keep-spike-ekv ══════════════════════════════════════════")
    IO.puts("fresh mesh per probe — no cross-probe disterl auto-connect\n")
    paths = :code.get_path()

    rows = [
      # ── resolvable shortnames ──────────────────────────────────────
      probe(paths, :short_partisan_only_node_list, false, :short, :node_list),
      probe(paths, :short_partisan_only_erpc, false, :short, :erpc),
      probe(paths, :short_partisan_only_send, false, :short, :send),
      probe(paths, :short_partisan_only_pg, false, :short, :pg),
      probe(paths, :short_plus_disterl_node_list, true, :short, :node_list),
      probe(paths, :short_plus_disterl_erpc, true, :short, :erpc),
      # ── Dojo-like unresolvable UUID hosts ──────────────────────────
      probe(paths, :uuid_partisan_only_node_list, false, :uuid, :node_list),
      probe(paths, :uuid_partisan_only_erpc, false, :uuid, :erpc),
      probe(paths, :uuid_partisan_only_send, false, :uuid, :send),
      probe(paths, :uuid_plus_disterl_node_list, true, :uuid, :node_list),
      probe(paths, :uuid_plus_disterl_erpc, true, :uuid, :erpc)
    ]

    report(rows)
    write(rows)
    System.halt(0)
  end

  # ── one mesh, one surface ────────────────────────────────────────────

  defp probe(paths, label, connect_disterl?, name_style, surface) do
    IO.puts("── #{label} ──")
    {pa, pb, node_a, node_b, join} = mesh(paths, connect_disterl?, name_style)

    try do
      result =
        case surface do
          :node_list ->
            %{
              list_a: :peer.call(pa, Node, :list, [], @t),
              list_b: :peer.call(pb, Node, :list, [], @t),
              visible?: node_b in :peer.call(pa, Node, :list, [], @t)
            }

          :erpc ->
            %{ok?: erpc?(pa, node_b)}

          :send ->
            %{ok?: dist_send?(pa, pb, node_b)}

          :pg ->
            %{ok?: pg_cross?(pa, pb, node_a)}
        end

      partisan = members(pa)

      row = %{
        label: label,
        connect_disterl: connect_disterl?,
        name_style: name_style,
        surface: surface,
        join: join,
        partisan_size: length(List.wrap(partisan)),
        result: result
      }

      IO.puts("  join=#{inspect(join)} partisan_size=#{row.partisan_size}")
      IO.puts("  → #{inspect(result)}\n")
      row
    after
      stop(pa)
      stop(pb)
      Process.sleep(250)
    end
  end

  defp mesh(paths, connect_disterl?, name_style) do
    port_a = 22_000 + :rand.uniform(3_000)
    port_b = port_a + 1

    {short_a, short_b, host} =
      case name_style do
        :short ->
          {:"sa#{System.unique_integer([:positive])}", :"sb#{System.unique_integer([:positive])}",
           nil}

        :uuid ->
          # Mimic Dojo local: admin@<uuid> — host does not resolve (nxdomain).
          # Use .invalid TLD (RFC 2606) so DNS cannot accidentally succeed.
          u1 = "a#{System.unique_integer([:positive])}.invalid"
          u2 = "b#{System.unique_integer([:positive])}.invalid"
          {:"admin", :"admin", {u1, u2}}
      end

    {pa, node_a, pb, node_b} =
      case host do
        nil ->
          {pa, na} = start_peer(short_a, nil, paths)
          {pb, nb} = start_peer(short_b, nil, paths)
          {pa, na, pb, nb}

        {h1, h2} ->
          {pa, na} = start_peer(short_a, String.to_charlist(h1), paths)
          {pb, nb} = start_peer(short_b, String.to_charlist(h2), paths)
          {pa, na, pb, nb}
      end

    boot_partisan(pa, node_a, port_a, connect_disterl?)
    boot_partisan(pb, node_b, port_b, connect_disterl?)
    join = join(pa, pb, node_b, port_b)
    Process.sleep(@settle)

    if connect_disterl? do
      # What Partisan's maybe_connect_disterl does on join
      try do
        :peer.call(pa, Node, :connect, [node_b], @t)
      catch
        _, _ -> :ok
      end

      Process.sleep(500)
    end

    {pa, pb, node_a, node_b, join}
  end

  defp start_peer(short, nil, paths) do
    {:ok, peer, node} =
      :peer.start(%{
        name: short,
        connection: 0,
        args: [~c"-setcookie", Atom.to_charlist(@cookie)]
      })

    load(peer, paths)
    {peer, node}
  end

  defp start_peer(short, host, paths) when is_list(host) do
    # longnames with unresolvable host — like Dojo's admin@uuid
    {:ok, peer, node} =
      :peer.start(%{
        name: short,
        host: host,
        connection: 0,
        args: [~c"-setcookie", Atom.to_charlist(@cookie)]
      })

    load(peer, paths)
    {peer, node}
  end

  defp load(peer, paths) do
    :peer.call(peer, :code, :add_paths, [paths], @t)
    :peer.call(peer, Application, :ensure_all_started, [:logger], @t)
    :peer.call(peer, Application, :ensure_all_started, [:crypto], @t)
    :peer.call(peer, Application, :ensure_all_started, [:ssl], @t)
    :peer.call(peer, Application, :ensure_all_started, [:elixir], @t)
    :ok
  end

  defp boot_partisan(peer, node, port, connect_disterl?) do
    :peer.call(peer, Application, :load, [:partisan], @t)

    for {k, v} <- [
          {:name, node},
          {:listen_addrs, [%{ip: {127, 0, 0, 1}, port: port}]},
          {:connect_disterl, connect_disterl?},
          {:peer_service_manager, :partisan_pluggable_peer_service_manager},
          {:membership_strategy, :partisan_full_membership_strategy},
          {:peer_discovery, %{enabled: false}},
          {:pid_encoding, false},
          {:ref_encoding, false},
          {:tls, false},
          {:connect_timeout, 2_000},
          {:channels, %{undefined: %{monotonic: false, parallelism: 1}}}
        ] do
      :peer.call(peer, Application, :put_env, [:partisan, k, v], @t)
    end

    for app <- [:telemetry, :types, :uuid, :quickrand, :partisan] do
      case :peer.call(peer, Application, :ensure_all_started, [app], @t) do
        {:ok, _} -> :ok
        {:error, {:already_started, _}} -> :ok
        other -> raise "start #{app}: #{inspect(other)}"
      end
    end

    :ok
  end

  defp join(pa, pb, node_b, port_b) do
    channels =
      :peer.call(pb, :partisan_config, :get, [:channels], @t) ||
        %{undefined: %{monotonic: false, parallelism: 1}}

    spec = %{
      name: node_b,
      listen_addrs: [%{ip: {127, 0, 0, 1}, port: port_b}],
      channels: channels
    }

    :peer.call(pa, :partisan_peer_service, :join, [spec], @t)
  rescue
    e -> {:error, Exception.message(e)}
  end

  defp members(peer) do
    case :peer.call(peer, :partisan_peer_service, :members, [], @t) do
      {:ok, m} -> m
      other -> other
    end
  rescue
    _ -> []
  end

  defp erpc?(pa, node_b) do
    try do
      :peer.call(pa, :erpc, :call, [node_b, :erlang, :node, [], 2_000], @t) == node_b
    catch
      kind, reason ->
        IO.puts("  erpc catch #{kind}: #{inspect(reason)}")
        false
    end
  end

  defp eval_on(peer, source) do
    {result, _} = :peer.call(peer, Code, :eval_string, [source], @t)
    result
  end

  defp dist_send?(pa, pb, node_b) do
    eval_on(pb, """
    case Process.whereis(:spike_mbox) do
      nil -> spawn(fn -> Process.register(self(), :spike_mbox); Process.sleep(:infinity) end)
      _ -> :ok
    end
    :ok
    """)

    Process.sleep(200)

    try do
      :peer.call(pa, :erlang, :send, [{:spike_mbox, node_b}, :ping], @t)
    catch
      kind, reason ->
        IO.puts("  send catch #{kind}: #{inspect(reason)}")
        :ok
    end

    Process.sleep(400)

    eval_on(pb, """
    case Process.whereis(:spike_mbox) do
      nil -> false
      pid ->
        {:messages, msgs} = Process.info(pid, :messages)
        :ping in msgs
    end
    """)
  rescue
    e ->
      IO.puts("  send error: #{inspect(e)}")
      false
  end

  defp pg_cross?(pa, pb, node_a) do
    eval_on(pa, """
    case :pg.start(:spike_pg) do
      {:ok, _} -> :ok
      {:error, {:already_started, _}} -> :ok
    end
    spawn(fn ->
      :ok = :pg.join(:spike_pg, {:ekv_members, :spike, "default"}, self())
      Process.sleep(:infinity)
    end)
    :ok
    """)

    eval_on(pb, """
    case :pg.start(:spike_pg) do
      {:ok, _} -> :ok
      {:error, {:already_started, _}} -> :ok
    end
    """)

    Process.sleep(1_200)

    members = eval_on(pb, ":pg.get_members(:spike_pg, {:ekv_members, :spike, \"default\"})")
    is_list(members) and Enum.any?(members, fn pid -> node(pid) == node_a end)
  rescue
    e ->
      IO.puts("  pg error: #{inspect(e)}")
      false
  end

  defp report(rows) do
    IO.puts("══ matrix ═════════════════════════════════════════════════")

    for r <- rows do
      verdict =
        case r.result do
          %{visible?: v} -> "visible=#{v} list=#{inspect(r.result.list_a)}"
          %{ok?: v} -> "ok=#{v}"
        end

      IO.puts(
        "  #{String.pad_trailing(to_string(r.label), 36)} mesh=#{r.partisan_size} #{verdict}"
      )
    end

    IO.puts("""

    HOW TO READ (ekv mapping)
      Node.list / monitor_nodes  → Replica.init discovery + nodeup handshakes
      :erpc / send               → EKV.Transports.Dist data plane
      :pg                        → MemberPresence / ClientRouter

    keep.org claim: Partisan-only → members never meet; +disterl → ekv rides.
    Refined: discovery is the hard seam. Data-plane ops may *side-effect*
    a disterl connect when hostnames resolve + cookies match; Dojo local
    names (admin@uuid) do not resolve — that path is closed there.
    """)
  end

  defp write(rows) do
    path = Path.join(System.tmp_dir!(), "keep-spike-ekv-result.txt")

    body =
      for r <- rows, into: "" do
        "#{r.label} disterl=#{r.connect_disterl} style=#{r.name_style} mesh=#{r.partisan_size} → #{inspect(r.result)}\n"
      end

    File.write!(path, "keep-spike-ekv #{DateTime.utc_now() |> DateTime.to_iso8601()}\n" <> body)
    IO.puts("result → #{path}")
  end

  defp stop(p) do
    try do
      :peer.stop(p)
    catch
      _, _ -> :ok
    end
  end
end

Spike.EKVPartisan.main()
