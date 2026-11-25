# Minimal multippartition positive control for ekv under pure disterl.
# 3 nodes, partition 2+1, CAS on both sides, heal, converge.
# Run from ekv root: mix run --no-start /tmp/ekv_multipartition_probe.exs

System.cmd("epmd", ["-daemon"], stderr_to_stdout: true)

unless Node.alive?() do
  {:ok, _} = Node.start(:"runner_#{System.unique_integer([:positive])}@127.0.0.1", :longnames)
  Node.set_cookie(:ekv_mp)
end

:application.set_env(:kernel, :prevent_overlapping_partitions, false)

Application.ensure_all_started(:logger)
Application.ensure_all_started(:ekv)

defmodule MP do
  @t 60_000
  @cookie :ekv_mp

  def main do
    IO.puts("\n══ ekv multippartition (disterl positive control) ══\n")
    paths = Enum.filter(:code.get_path(), fn p ->
      s = List.to_string(p)
      String.contains?(s, "ekv") or String.contains?(s, "elixir") or
        String.contains?(s, "stdlib") or String.contains?(s, "kernel") or
        String.contains?(s, "compiler") or String.contains?(s, "logger") or
        String.contains?(s, "crypto") or String.contains?(s, "public_key") or
        String.contains?(s, "asn1") or String.contains?(s, "ssl") or
        String.contains?(s, "inets") or String.contains?(s, "cc_precompiler") or
        String.contains?(s, "elixir_make")
    end)

    peers = for i <- 1..3 do
      start_peer(:"n#{i}_#{System.unique_integer([:positive])}", paths)
    end

    try do
      [{_, n1}, {_, n2}, {_, n3}] = peers
      # ensure full mesh
      for {_, a} <- peers, {_, b} <- peers, a != b do
        :erpc.call(a, Node, :connect, [b])
      end
      Process.sleep(500)

      name = :"mp_#{System.unique_integer([:positive])}"
      for {{_, node}, id} <- Enum.with_index(peers, 1) do
        dir = "/tmp/ekv_mp_#{node}"
        File.rm_rf!(dir)
        :erpc.call(node, fn ->
          {:ok, pid} = EKV.start_link(
            name: name, data_dir: dir, shards: 1, log: false,
            cluster_size: 3, node_id: id, anti_entropy_interval: 1_000
          )
          Process.unlink(pid)
          :ok
        end)
      end

      IO.puts("waiting for quorum…")
      wait_until(fn ->
        :erpc.call(n1, EKV, :await_quorum, [name, 0]) == :ok
      end, 10_000)
      IO.puts("quorum ok")

      # seed
      {:ok, _} = :erpc.call(n1, EKV, :put, [name, "k", "v0", [if_vsn: nil]])
      Process.sleep(800)
      assert_eq(:erpc.call(n2, EKV, :get, [name, "k"]), "v0", "seed on n2")
      assert_eq(:erpc.call(n3, EKV, :get, [name, "k"]), "v0", "seed on n3")

      # ── multippartition: {n1,n2} | {n3}
      IO.puts("partition 2+1…")
      disconnect(n1, n3)
      disconnect(n2, n3)
      Process.sleep(400)

      # majority CAS
      maj = Task.async(fn ->
        :erpc.call(n1, EKV, :put, [name, "k", "maj", [if_vsn: nil]])
      end)
      # minority CAS
      min = Task.async(fn ->
        try do
          :erpc.call(n3, EKV, :put, [name, "k", "min", [if_vsn: nil]], 5_000)
        catch
          _, r -> {:error, r}
        end
      end)

      r_maj = Task.await(maj, 15_000)
      r_min = Task.await(min, 15_000)
      IO.puts("  majority put: #{inspect(r_maj)}")
      IO.puts("  minority put: #{inspect(r_min)}")

      ok_maj = match?({:ok, _}, r_maj)
      fail_min = match?({:error, _}, r_min) or match?({:error, _}, r_min)

      # heal
      IO.puts("heal…")
      reconnect(n1, n3)
      reconnect(n2, n3)
      Process.sleep(2_000)

      wait_until(fn ->
        vals = Enum.map([n1, n2, n3], fn n -> :erpc.call(n, EKV, :get, [name, "k"]) end)
        Enum.all?(vals, &(&1 == "maj"))
      end, 10_000)

      finals = Enum.map([n1, n2, n3], fn n -> :erpc.call(n, EKV, :get, [name, "k"]) end)
      IO.puts("  finals: #{inspect(finals)}")

      IO.puts("""

      ══ multippartition verdict ══
        majority CAS committed: #{ok_maj}
        minority CAS failed:    #{fail_min}
        converged to maj:       #{finals == ["maj", "maj", "maj"]}
      """)

      if ok_maj and finals == ["maj", "maj", "maj"] do
        IO.puts("PASS — ekv multippartition semantics hold under disterl")
        System.halt(0)
      else
        IO.puts("FAIL")
        System.halt(1)
      end
    after
      for {pid, _} <- peers, do: (try do :peer.stop(pid) catch _, _ -> :ok end)
    end
  end

  defp start_peer(short, paths) do
    {:ok, pid, node} =
      :peer.start(%{
        name: short,
        host: ~c"127.0.0.1",
        connection: 0,
        args: [~c"-setcookie", Atom.to_charlist(@cookie)]
      })

    :peer.call(pid, :code, :add_paths, [paths], @t)
    :peer.call(pid, Application, :ensure_all_started, [:logger], @t)
    :peer.call(pid, Application, :ensure_all_started, [:crypto], @t)
    :peer.call(pid, Application, :ensure_all_started, [:elixir], @t)
    :peer.call(pid, Application, :ensure_all_started, [:ekv], @t)
    {pid, node}
  end

  defp disconnect(a, b) do
    :erpc.call(a, :erlang, :set_cookie, [b, :part_a])
    :erpc.call(b, :erlang, :set_cookie, [a, :part_b])
    :erpc.call(a, :erlang, :disconnect_node, [b])
  end

  defp reconnect(a, b) do
    :erpc.call(a, :erlang, :set_cookie, [b, @cookie])
    :erpc.call(b, :erlang, :set_cookie, [a, @cookie])
    :erpc.call(a, Node, :connect, [b])
  end

  defp wait_until(fun, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_wait(fun, deadline)
  end

  defp do_wait(fun, deadline) do
    if fun.() do
      :ok
    else
      if System.monotonic_time(:millisecond) > deadline, do: raise("timeout")
      Process.sleep(100)
      do_wait(fun, deadline)
    end
  rescue
    # fun may throw while not ready
    _ ->
      if System.monotonic_time(:millisecond) > deadline, do: raise("timeout")
      Process.sleep(100)
      do_wait(fun, deadline)
  end

  defp assert_eq(got, want, label) do
    if got == want do
      IO.puts("  ok #{label}")
    else
      raise "#{label}: got #{inspect(got)} want #{inspect(want)}"
    end
  end
end

MP.main()
