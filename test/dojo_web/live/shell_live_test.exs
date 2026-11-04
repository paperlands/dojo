defmodule DojoWeb.ShellLiveTest do
  # Pure handler tests: a supervised real Table + a bare LiveView socket.
  # No DB, no sandbox.
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog

  alias Dojo.Turtle
  alias DojoWeb.Session
  alias DojoWeb.ShellLive
  alias DojoWeb.ShellLive.OuterShell
  alias Phoenix.LiveView.Socket
  alias Phoenix.LiveView.Utils

  # Production shape: Class.topic/1 prefixes every book with "class:"; the
  # Table and the presence key are the same string (id:ki-presence).
  @topic "class:shell:PaperLand"

  @wren "11111111-2222-3333-4444-555555555555"
  @fox "22222222-2222-3333-4444-555555555555"

  defp start_table(uid, name) do
    key = "#{@topic}:#{uid}"

    spec =
      Supervisor.child_spec(
        {Dojo.Table,
         %{
           track_pid: self(),
           topic: @topic,
           disciple: %Dojo.Disciple{name: name, author_id: uid, action: "active"},
           reg_key: key
         }},
        id: key,
        restart: :temporary
      )

    pid = start_supervised!(spec)
    {key, pid}
  end

  defp sock(assigns) do
    base = %{
      __changed__: %{},
      outershell: %OuterShell{},
      disciples: %{},
      visible_disciples: MapSet.new(),
      class: nil,
      follow_gen: 0,
      clan: "PaperLand",
      session: %Session{}
    }

    %Socket{assigns: Map.merge(base, assigns)}
  end

  defp disciple(uid, name, key) do
    %{name: name, node: :partisan.node(), phx_ref: "ref-#{uid}", author_id: uid, reg_key: key}
  end

  defp pushes(socket), do: Utils.get_push_events(socket)
  # Selector recovery metadata is not a document push.
  defp doc_pushes(socket), do: Enum.reject(pushes(socket), &match?(["outerIntent", _], &1))

  defp turtle(source) do
    %Turtle{
      state: :success,
      source: source,
      commands: [%{}],
      diagnostics: [],
      time: 1000,
      attend: %{"line" => 3}
    }
  end

  # The write path is a cast; a call on the same Table is the owner-mailbox
  # barrier that makes the stored state deterministic (no sleep, no inference).
  defp publish(table, turtle) do
    Dojo.Table.publish(table, {Turtle, nil, turtle}, :hatch)
    assert GenServer.call(table, {:last, :hatch}) == turtle
  end

  defp stored(table), do: GenServer.call(table, {:last, :hatch})

  describe "seeTurtle — the click is an intention, not a successful read" do
    test "installs watch intent before the read and pushes nothing yet" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)

      assert socket.assigns.outershell.addr == key
      assert socket.assigns.outershell.follow_peer == true
      assert socket.assigns.outershell.origin == nil
      assert socket.assigns.follow_gen == 1

      assert [["outerIntent", %{addr: ^key, view: :watch, draft_live: true, follow_peer: true}]] =
               pushes(socket)
    end

    test "a stored hatch resolves on the epoch completion" do
      {key, table} = start_table(@wren, "wren")
      publish(table, turtle("fw 60"))

      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)
      assert doc_pushes(socket) == []

      gen = socket.assigns.follow_gen

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {gen, key, 1, {:turtle, turtle("fw 60")}}},
                 socket
               )

      assert [["seeOuterShell", payload]] = doc_pushes(socket)
      assert payload.source == "fw 60"
      assert socket.assigns.outershell.origin.source == "fw 60"
    end

    test "a later hatch reaches the retained intent without a re-click" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)

      meta = %{time: 1200, state: :success, path: nil, attend: %{"line" => 7}}

      assert {:noreply, socket} =
               ShellLive.handle_info({Dojo.PubSub, :hatch, {key, {Turtle, meta}}}, socket)

      assert [["outerAttend", %{addr: ^key, attend: %{"line" => 7}}]] = doc_pushes(socket)
    end

    test "close is explicit and retires the intent" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)
      gen = socket.assigns.follow_gen

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{}, socket)
      assert socket.assigns.outershell.addr == nil
      assert socket.assigns.follow_gen == gen + 1
      assert doc_pushes(socket) == [["outerClose", %{}]]
    end

    test "a stale follow_peer result after a switch changes nothing" do
      {k1, _t1} = start_table(@wren, "wren")
      {k2, _t2} = start_table(@fox, "fox")

      socket =
        sock(%{
          disciples: %{k1 => disciple(@wren, "wren", k1), k2 => disciple(@fox, "fox", k2)}
        })

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => k1}, socket)
      stale_gen = socket.assigns.follow_gen

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => k2}, socket)
      assert socket.assigns.outershell.addr == k2
      assert socket.assigns.follow_gen == stale_gen + 1

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {stale_gen, k1, 1, {:turtle, turtle("fw 10")}}},
                 socket
               )

      assert doc_pushes(socket) == []
      assert socket.assigns.outershell.addr == k2
    end

    test "a stale follow_peer result after close changes nothing" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)
      stale_gen = socket.assigns.follow_gen

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{}, socket)

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {stale_gen, key, 1, {:turtle, turtle("fw 10")}}},
                 socket
               )

      assert doc_pushes(socket) == [["outerClose", %{}]]
      assert socket.assigns.outershell.addr == nil
    end

    test "a legacy embedded address keeps the one composition rule" do
      {key, table} = start_table(@wren, "wren")
      legacy = %{name: "wren", node: {key, :partisan.node()}, phx_ref: "ref", author_id: @wren}

      assert Dojo.Disciple.table_address(legacy) == {key, :partisan.node()}

      socket = sock(%{disciples: %{key => legacy}})
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)
      assert socket.assigns.outershell.addr == key

      publish(table, turtle("fw 60"))
      gen = socket.assigns.follow_gen

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {gen, key, 1, {:turtle, turtle("fw 60")}}},
                 socket
               )

      assert [["seeOuterShell", %{source: "fw 60"}]] = doc_pushes(socket)
    end

    test "an unknown address changes nothing" do
      socket = sock(%{disciples: %{}})

      assert {:noreply, ^socket} =
               ShellLive.handle_event(
                 "seeTurtle",
                 %{"addr" => "class:shell:PaperLand:nobody"},
                 socket
               )

      assert pushes(socket) == []
    end

    test "a paused watch ignores a late read" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)
      gen = socket.assigns.follow_gen

      assert {:noreply, socket} =
               ShellLive.handle_info({:outer_shell, :toggle_follow_peer}, socket)

      assert socket.assigns.outershell.follow_peer == false
      assert socket.assigns.follow_gen == gen
      assert socket.assigns.follow_read == nil

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {gen, key, 1, {:turtle, turtle("fw 10")}}},
                 socket
               )

      assert doc_pushes(socket) == []
      assert socket.assigns.outershell.origin == nil
    end

    test "a draft still accepts its baseline while follow_peer is paused" do
      {key, _table} = start_table(@wren, "wren")

      shell = %OuterShell{
        addr: key,
        view: :draft,
        draft_live: true,
        follow_peer: false,
        active: true
      }

      socket =
        sock(%{
          disciples: %{key => disciple(@wren, "wren", key)},
          outershell: shell,
          follow_gen: 7,
          follow_read: %{phase: :read, gen: 7, addr: key, attempt: 1, again: false}
        })

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {7, key, 1, {:turtle, turtle("fw 10")}}},
                 socket
               )

      assert [["seeOuterShell", %{source: "fw 10", view: :draft}]] = doc_pushes(socket)
      assert socket.assigns.outershell.origin.source == "fw 10"
    end

    test "a stale same-peer read after A -> B -> A changes nothing" do
      {k1, _t1} = start_table(@wren, "wren")
      {k2, _t2} = start_table(@fox, "fox")

      socket =
        sock(%{
          disciples: %{k1 => disciple(@wren, "wren", k1), k2 => disciple(@fox, "fox", k2)}
        })

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => k1}, socket)
      stale_gen = socket.assigns.follow_gen
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => k2}, socket)
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => k1}, socket)

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {stale_gen, k1, 1, {:turtle, turtle("fw 10")}}},
                 socket
               )

      assert doc_pushes(socket) == []
      assert socket.assigns.outershell.addr == k1
      assert socket.assigns.outershell.origin == nil
    end

    test "a stale same-peer read after close and reopen changes nothing" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)
      stale_gen = socket.assigns.follow_gen

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{}, socket)
      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)

      assert {:noreply, socket} =
               ShellLive.handle_async(
                 :follow_code,
                 {:ok, {stale_gen, key, 1, {:turtle, turtle("fw 10")}}},
                 socket
               )

      assert doc_pushes(socket) == [["outerClose", %{}]]
      assert socket.assigns.outershell.addr == key
      assert socket.assigns.outershell.origin == nil
    end
  end

  describe "outer draft names its subject" do
    test "a matching draft records the view and announces live" do
      key = "class:shell:PaperLand:#{@wren}"

      shell = %OuterShell{
        addr: key,
        view: :watch,
        draft_live: true,
        follow_peer: true,
        active: true
      }

      socket = sock(%{outershell: shell})

      assert {:noreply, socket} =
               ShellLive.handle_event("outerDraft", %{"addr" => key}, socket)

      assert socket.assigns.outershell.view == :draft
      assert socket.assigns.outershell.draft_live == true

      assert [
               ["outerIntent", %{addr: ^key, view: :draft, draft_live: true, follow_peer: true}],
               ["outerLive", %{live: true}]
             ] = pushes(socket)
    end

    test "a retired subject is rejected and the selector re-asserted" do
      key = "class:shell:PaperLand:#{@wren}"
      retired = "class:shell:PaperLand:#{@fox}"

      shell = %OuterShell{
        addr: key,
        view: :watch,
        draft_live: true,
        follow_peer: true,
        active: true
      }

      socket = sock(%{outershell: shell})

      assert {:noreply, socket} =
               ShellLive.handle_event("outerDraft", %{"addr" => retired}, socket)

      assert socket.assigns.outershell == shell

      assert [["outerIntent", %{addr: ^key, view: :watch, draft_live: true, follow_peer: true}]] =
               pushes(socket)
    end

    test "a bare draft changes nothing" do
      key = "class:shell:PaperLand:#{@wren}"
      socket = sock(%{outershell: %OuterShell{addr: key, view: :watch, active: true}})

      assert {:noreply, ^socket} = ShellLive.handle_event("outerDraft", %{}, socket)
      assert pushes(socket) == []
    end

    test "an empty subject changes nothing" do
      key = "class:shell:PaperLand:#{@wren}"
      socket = sock(%{outershell: %OuterShell{addr: key, view: :watch, active: true}})

      assert {:noreply, ^socket} = ShellLive.handle_event("outerDraft", %{"addr" => ""}, socket)
      assert pushes(socket) == []
    end
  end

  describe "follow_peer read lane" do
    test "a hatch during a read becomes one trailing read after nil" do
      {key, _table} = start_table(@wren, "wren")
      shell = %OuterShell{addr: key, active: true, follow_peer: true}

      socket =
        sock(%{
          disciples: %{key => disciple(@wren, "wren", key)},
          outershell: shell,
          follow_gen: 1,
          follow_read: %{phase: :read, gen: 1, addr: key, attempt: 1, again: false}
        })

      meta = %{time: 1200, state: :success, path: nil, attend: nil}

      assert {:noreply, socket} =
               ShellLive.handle_info({Dojo.PubSub, :hatch, {key, {Turtle, meta}}}, socket)

      assert socket.assigns.follow_read.again

      assert {:noreply, socket} =
               ShellLive.handle_async(:follow_code, {:ok, {1, key, 1, :empty}}, socket)

      assert %{phase: :read, attempt: 1, again: false} = socket.assigns.follow_read
    end

    test "transport failures retry twice and then log exhaustion" do
      {key, _table} = start_table(@wren, "wren")
      shell = %OuterShell{addr: key, active: true, follow_peer: true}

      socket =
        sock(%{
          disciples: %{key => disciple(@wren, "wren", key)},
          outershell: shell,
          follow_gen: 1,
          follow_read: %{phase: :read, gen: 1, addr: key, attempt: 1, again: false}
        })

      log =
        capture_log(fn ->
          assert {:noreply, socket} =
                   ShellLive.handle_async(
                     :follow_code,
                     {:ok, {1, key, 1, {:error, :boom}}},
                     socket
                   )

          assert %{phase: :retry, attempt: 2} = socket.assigns.follow_read

          assert {:noreply, socket} =
                   ShellLive.handle_info(
                     {:timeout, socket.assigns.follow_read.timer, :follow_retry},
                     socket
                   )

          assert %{phase: :read, attempt: 2} = socket.assigns.follow_read

          assert {:noreply, socket} =
                   ShellLive.handle_async(
                     :follow_code,
                     {:ok, {1, key, 2, {:error, :boom}}},
                     socket
                   )

          assert %{phase: :retry, attempt: 3} = socket.assigns.follow_read

          assert {:noreply, socket} =
                   ShellLive.handle_info(
                     {:timeout, socket.assigns.follow_read.timer, :follow_retry},
                     socket
                   )

          assert %{phase: :read, attempt: 3} = socket.assigns.follow_read

          assert {:noreply, socket} =
                   ShellLive.handle_async(
                     :follow_code,
                     {:ok, {1, key, 3, {:error, :boom}}},
                     socket
                   )

          assert socket.assigns.follow_read == nil
        end)

      assert log =~ "follow_code exhausted"
    end

    test "a stale retry timer cannot start beside a newer lane" do
      {key, _table} = start_table(@wren, "wren")
      shell = %OuterShell{addr: key, active: true, follow_peer: true}
      timer = make_ref()
      stale_timer = make_ref()

      socket =
        sock(%{
          disciples: %{key => disciple(@wren, "wren", key)},
          outershell: shell,
          follow_gen: 1,
          follow_read: %{
            phase: :retry,
            gen: 1,
            addr: key,
            attempt: 2,
            timer: timer,
            again: false
          }
        })

      # Same gen/addr/attempt but the wrong native timer ref is not ours.
      assert {:noreply, ^socket} =
               ShellLive.handle_info({:timeout, stale_timer, :follow_retry}, socket)

      assert {:noreply, socket} =
               ShellLive.handle_info({:timeout, timer, :follow_retry}, socket)

      assert %{phase: :read, attempt: 2} = socket.assigns.follow_read
    end

    test "an exit uses the owned lane's captured subject" do
      {key, _table} = start_table(@wren, "wren")
      shell = %OuterShell{addr: key, active: true, follow_peer: true}

      socket =
        sock(%{
          disciples: %{key => disciple(@wren, "wren", key)},
          outershell: shell,
          follow_gen: 1,
          follow_read: %{phase: :read, gen: 1, addr: key, attempt: 1, again: false}
        })

      assert {:noreply, socket} =
               ShellLive.handle_async(:follow_code, {:exit, :boom}, socket)

      assert %{phase: :retry, attempt: 2} = socket.assigns.follow_read
    end
  end

  test "a stalled Table keeps one active read across several hatch demands" do
    {key, table} = start_table(@wren, "wren")
    :ok = :sys.suspend(table)

    try do
      socket =
        %{sock(%{disciples: %{key => disciple(@wren, "wren", key)}}) | transport_pid: self()}

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => key}, socket)
      first = get_in(socket.private, [:live_async, :follow_code])
      assert {_ref, pid, _kind} = first
      assert Process.alive?(pid)

      socket =
        Enum.reduce([1200, 1300, 1400], socket, fn time, socket ->
          meta = %{time: time, state: :success, path: nil, attend: nil}

          assert {:noreply, socket} =
                   ShellLive.handle_info({Dojo.PubSub, :hatch, {key, {Turtle, meta}}}, socket)

          socket
        end)

      assert socket.assigns.follow_read.phase == :read
      assert socket.assigns.follow_read.again
      assert get_in(socket.private, [:live_async, :follow_code]) == first
      assert Process.alive?(pid)
    after
      :sys.resume(table)
    end
  end

  test "switching peers cancels the prior owned read task" do
    {k1, _t1} = start_table(@wren, "wren")
    {k2, _t2} = start_table(@fox, "fox")

    socket =
      %{
        sock(%{
          disciples: %{
            k1 => disciple(@wren, "wren", k1),
            k2 => disciple(@fox, "fox", k2)
          }
        })
        | transport_pid: self()
      }

    assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => k1}, socket)
    {_ref, pid, _kind} = get_in(socket.private, [:live_async, :follow_code])
    assert Process.alive?(pid)

    assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{"addr" => k2}, socket)
    Process.sleep(10)
    refute Process.alive?(pid)
    assert socket.assigns.follow_read.addr == k2
  end

  test "a coalesced hatch cannot extend the failure budget" do
    {key, _table} = start_table(@wren, "wren")
    shell = %OuterShell{addr: key, active: true, follow_peer: true}

    socket =
      sock(%{
        disciples: %{key => disciple(@wren, "wren", key)},
        outershell: shell,
        follow_gen: 1,
        follow_read: %{phase: :read, gen: 1, addr: key, attempt: 1, again: true}
      })

    log =
      capture_log(fn ->
        assert {:noreply, socket} =
                 ShellLive.handle_async(
                   :follow_code,
                   {:ok, {1, key, 1, {:error, :boom}}},
                   socket
                 )

        assert %{phase: :retry, attempt: 2} = socket.assigns.follow_read
        :erlang.cancel_timer(socket.assigns.follow_read.timer)

        socket =
          %{
            socket
            | assigns:
                Map.put(socket.assigns, :follow_read, %{
                  phase: :read,
                  gen: 1,
                  addr: key,
                  attempt: 2,
                  again: true
                })
          }

        assert {:noreply, socket} =
                 ShellLive.handle_async(
                   :follow_code,
                   {:ok, {1, key, 2, {:error, :boom}}},
                   socket
                 )

        assert %{phase: :retry, attempt: 3} = socket.assigns.follow_read
        :erlang.cancel_timer(socket.assigns.follow_read.timer)

        socket =
          %{
            socket
            | assigns:
                Map.put(socket.assigns, :follow_read, %{
                  phase: :read,
                  gen: 1,
                  addr: key,
                  attempt: 3,
                  again: true
                })
          }

        assert {:noreply, socket} =
                 ShellLive.handle_async(
                   :follow_code,
                   {:ok, {1, key, 3, {:error, :boom}}},
                   socket
                 )

        assert socket.assigns.follow_read == nil
      end)

    assert log =~ "follow_code exhausted"
  end

  test "an exit with a coalesced hatch still spends the failure budget" do
    {key, _table} = start_table(@wren, "wren")
    shell = %OuterShell{addr: key, active: true, follow_peer: true}

    socket =
      sock(%{
        disciples: %{key => disciple(@wren, "wren", key)},
        outershell: shell,
        follow_gen: 1,
        follow_read: %{phase: :read, gen: 1, addr: key, attempt: 1, again: true}
      })

    assert {:noreply, socket} =
             ShellLive.handle_async(:follow_code, {:exit, :boom}, socket)

    assert %{phase: :retry, attempt: 2} = socket.assigns.follow_read
    :erlang.cancel_timer(socket.assigns.follow_read.timer)
  end

  test "a hatch during a retry timer only arms the owned slot" do
    {key, _table} = start_table(@wren, "wren")
    shell = %OuterShell{addr: key, active: true, follow_peer: true}
    timer = make_ref()

    socket =
      sock(%{
        disciples: %{key => disciple(@wren, "wren", key)},
        outershell: shell,
        follow_gen: 1,
        follow_read: %{
          phase: :retry,
          gen: 1,
          addr: key,
          attempt: 2,
          timer: timer,
          again: false
        }
      })

    meta = %{time: 1200, state: :success, path: nil, attend: nil}

    assert {:noreply, socket} =
             ShellLive.handle_info({Dojo.PubSub, :hatch, {key, {Turtle, meta}}}, socket)

    assert socket.assigns.follow_read.phase == :retry
    assert socket.assigns.follow_read.again

    assert {:noreply, socket} =
             ShellLive.handle_info(
               {:timeout, socket.assigns.follow_read.timer, :follow_retry},
               socket
             )

    assert %{phase: :read, attempt: 2, again: false} = socket.assigns.follow_read
  end

  test "a hatch after exhaustion starts a new bounded pass" do
    {key, _table} = start_table(@wren, "wren")
    shell = %OuterShell{addr: key, active: true, follow_peer: true}

    socket =
      sock(%{
        disciples: %{key => disciple(@wren, "wren", key)},
        outershell: shell,
        follow_gen: 1
      })

    meta = %{time: 1200, state: :success, path: nil, attend: nil}

    assert {:noreply, socket} =
             ShellLive.handle_info({Dojo.PubSub, :hatch, {key, {Turtle, meta}}}, socket)

    assert %{phase: :read, attempt: 1} = socket.assigns.follow_read
  end

  describe "outer recovery descriptor" do
    test "restoring retires an active old read before demanding the new seat" do
      {k1, _t1} = start_table(@wren, "wren")
      {k2, _t2} = start_table(@fox, "fox")
      shell = %OuterShell{addr: k1, active: true, follow_peer: true}

      socket =
        sock(%{
          disciples: %{
            k1 => disciple(@wren, "wren", k1),
            k2 => disciple(@fox, "fox", k2)
          },
          outershell: shell,
          follow_gen: 1,
          follow_read: %{phase: :read, gen: 1, addr: k1, attempt: 1, again: false}
        })

      payload = %{"addr" => k2, "view" => "watch", "draft_live" => true, "follow_peer" => true}
      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      assert %{phase: :read, addr: ^k2} = socket.assigns.follow_read
    end

    test "restoring retires an old retry timer before demanding the new seat" do
      {k1, _t1} = start_table(@wren, "wren")
      {k2, _t2} = start_table(@fox, "fox")
      shell = %OuterShell{addr: k1, active: true, follow_peer: true}
      timer = :erlang.start_timer(10_000, self(), :follow_retry)

      socket =
        sock(%{
          disciples: %{
            k1 => disciple(@wren, "wren", k1),
            k2 => disciple(@fox, "fox", k2)
          },
          outershell: shell,
          follow_gen: 1,
          follow_read: %{
            phase: :retry,
            gen: 1,
            addr: k1,
            attempt: 2,
            timer: timer,
            again: false
          }
        })

      payload = %{"addr" => k2, "view" => "watch", "draft_live" => true, "follow_peer" => true}
      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      assert %{phase: :read, addr: ^k2} = socket.assigns.follow_read
      assert :erlang.read_timer(timer) == false

      before = socket.assigns.follow_read

      assert {:noreply, ^socket} =
               ShellLive.handle_info({:timeout, timer, :follow_retry}, socket)

      assert socket.assigns.follow_read == before
    end

    test "restores the selector before presence and emits metadata only" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{}})

      payload = %{
        "addr" => key,
        "view" => "draft",
        "draft_live" => false,
        "follow_peer" => false,
        "name" => "wren",
        "root" => "root-a"
      }

      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      shell = socket.assigns.outershell
      assert shell.addr == key
      assert shell.view == :draft
      assert shell.draft_live == false
      assert shell.follow_peer == false
      assert shell.name == "wren"
      assert shell.root == "root-a"
      assert shell.active == true

      assert [["outerIntent", %{addr: ^key, view: :draft, draft_live: false, follow_peer: false}]] =
               pushes(socket)
    end

    test "presence enriches name/root without resetting restored modes" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{}})

      payload = %{"addr" => key, "view" => "draft", "draft_live" => false, "follow_peer" => false}
      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      disciple = disciple(@wren, "wren", key) |> Map.put(:root, "root-a")

      assert {:noreply, socket} =
               ShellLive.handle_async(:list_disciples, {:ok, %{key => disciple}}, socket)

      shell = socket.assigns.outershell
      assert shell.name == "wren"
      assert shell.root == "root-a"
      assert shell.active == true
      assert shell.view == :draft
      assert shell.draft_live == false
      assert shell.follow_peer == false
      assert doc_pushes(socket) == []
    end

    test "a later join enriches the retained selection" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{}})

      payload = %{"addr" => key, "view" => "recall", "draft_live" => true, "follow_peer" => true}
      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      disciple = disciple(@wren, "wren", key) |> Map.put(:root, "root-a")

      assert {:noreply, socket} =
               ShellLive.handle_info({:join, "class:shell:PaperLand", disciple}, socket)

      shell = socket.assigns.outershell
      assert shell.addr == key
      assert shell.view == :recall
      assert shell.active == true
      assert doc_pushes(socket) == []
    end

    test "close clears the selection and emits the nil descriptor" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{}})
      payload = %{"addr" => key, "view" => "watch", "draft_live" => true, "follow_peer" => true}
      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      assert {:noreply, socket} = ShellLive.handle_event("seeTurtle", %{}, socket)
      assert socket.assigns.outershell.addr == nil
      assert doc_pushes(socket) == [["outerClose", %{}]]
      assert Enum.any?(pushes(socket), &match?(["outerIntent", %{addr: nil}], &1))
    end

    test "malformed descriptors leave the selection unchanged" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{}})

      for payload <- [
            %{"addr" => key, "view" => "watch"},
            %{"addr" => key, "view" => "bogus", "draft_live" => true, "follow_peer" => true},
            %{"addr" => key, "view" => "watch", "draft_live" => "yes", "follow_peer" => true},
            %{"addr" => "", "view" => "watch", "draft_live" => true, "follow_peer" => true}
          ] do
        assert {:noreply, ^socket} = ShellLive.handle_event("restoreShell", payload, socket)
        assert pushes(socket) == []
      end
    end

    test "paused watch restore enriches without a fresh read" do
      {key, _table} = start_table(@wren, "wren")
      socket = %{sock(%{disciples: %{}}) | transport_pid: self()}

      payload = %{"addr" => key, "view" => "watch", "draft_live" => true, "follow_peer" => false}
      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      disciple = disciple(@wren, "wren", key)

      assert {:noreply, socket} =
               ShellLive.handle_async(:list_disciples, {:ok, %{key => disciple}}, socket)

      assert socket.assigns.outershell.active == true
      assert socket.assigns.outershell.follow_peer == false
      assert get_in(socket.private, [:live_async, :follow_code]) == nil
      assert doc_pushes(socket) == []
    end

    test "an unrelated join does not fetch for the selected absent peer" do
      {selected, _t1} = start_table(@wren, "wren")
      {other, _t2} = start_table(@fox, "fox")
      socket = %{sock(%{disciples: %{}}) | transport_pid: self()}

      payload = %{
        "addr" => selected,
        "view" => "watch",
        "draft_live" => true,
        "follow_peer" => true
      }

      assert {:reply, _reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)
      assert socket.assigns.outershell.active == true
      assert get_in(socket.private, [:live_async, :follow_code]) == nil

      joined = disciple(@fox, "fox", other)

      assert {:noreply, socket} =
               ShellLive.handle_info({:join, "class:shell:PaperLand", joined}, socket)

      assert socket.assigns.outershell.addr == selected
      assert get_in(socket.private, [:live_async, :follow_code]) == nil
    end

    test "toggling follow_peer on reads CURRENT immediately" do
      {key, _table} = start_table(@wren, "wren")

      shell = %OuterShell{
        addr: key,
        view: :watch,
        draft_live: true,
        follow_peer: false,
        active: true
      }

      disciple = disciple(@wren, "wren", key)

      socket =
        %{sock(%{disciples: %{key => disciple}, outershell: shell}) | transport_pid: self()}

      assert {:noreply, socket} =
               ShellLive.handle_info({:outer_shell, :toggle_follow_peer}, socket)

      assert socket.assigns.outershell.follow_peer == true
      assert get_in(socket.private, [:live_async, :follow_code]) != nil
    end
  end

  describe "selector descriptor" do
    test "a selector write emits metadata only" do
      addr = "class:shell:PaperLand:x"
      shell = %OuterShell{addr: addr, view: :watch, draft_live: true, follow_peer: true}
      socket = sock(%{outershell: shell})

      assert {:noreply, socket} =
               ShellLive.handle_info({:outer_shell, :toggle_follow_peer}, socket)

      assert socket.assigns.outershell.follow_peer == false

      assert [["outerIntent", %{addr: ^addr, view: :watch, draft_live: true, follow_peer: false}]] =
               pushes(socket)
    end
  end

  describe "correlated readiness replies" do
    test "seeWeave replies with the installed selector" do
      key = "class:shell:PaperLand:#{@wren}"
      socket = sock(%{})

      payload = %{"addr" => key, "name" => "wren", "source" => "fw 1", "ts" => 1000}

      assert {:reply, reply, socket} = ShellLive.handle_event("seeWeave", payload, socket)

      assert reply.addr == key
      assert reply.name == "wren"
      assert reply.view == :watch
      assert reply.draft_live == true
      assert reply.follow_peer == false
      assert socket.assigns.outershell.addr == key
      assert socket.assigns.outershell.name == "wren"
    end

    test "restoreShell replies with the enriched selector" do
      {key, _table} = start_table(@wren, "wren")
      socket = sock(%{disciples: %{key => disciple(@wren, "wren", key)}})

      payload = %{"addr" => key, "view" => "draft", "draft_live" => false, "follow_peer" => false}

      assert {:reply, reply, socket} = ShellLive.handle_event("restoreShell", payload, socket)

      assert reply.addr == key
      assert reply.name == "wren"
      assert reply.view == :draft
      assert reply.draft_live == false
      assert reply.follow_peer == false
      assert socket.assigns.outershell.name == "wren"
    end

    test "closeTurtle replies with the canonical closed selector" do
      socket = sock(%{})

      assert {:reply, reply, socket} = ShellLive.handle_event("closeTurtle", %{}, socket)

      assert reply == %{addr: nil, view: :watch, draft_live: true, follow_peer: true}
      assert socket.assigns.outershell.addr == nil
    end
  end

  describe "owner readiness" do
    test "class attach asks the client for CURRENT once" do
      {_key, table} = start_table(@wren, "wren")
      socket = sock(%{})

      assert {:noreply, socket} = ShellLive.handle_async(:join_disciples, {:ok, table}, socket)
      assert socket.assigns.class == table
      assert pushes(socket) == [["syncShell", %{}]]
    end

    test "a hatch before class attach is ignored, not stored and not queued" do
      {key, table} = start_table(@wren, "wren")

      socket =
        sock(%{
          class: nil,
          session: %Session{name: "wren", id: @wren},
          disciples: %{key => disciple(@wren, "wren", key)}
        })

      payload = %{"state" => "success", "source" => "fw 50"}
      assert {:noreply, socket} = ShellLive.handle_event("hatchTurtle", payload, socket)

      assert pushes(socket) == []
      assert stored(table) == nil
    end

    test "a hatch after class attach is stored" do
      {key, table} = start_table(@wren, "wren")

      socket =
        sock(%{
          class: table,
          session: %Session{name: "wren", id: @wren},
          disciples: %{key => disciple(@wren, "wren", key)}
        })

      payload = %{"state" => "success", "source" => "fw 50", "commands" => []}
      assert {:noreply, _socket} = ShellLive.handle_event("hatchTurtle", payload, socket)

      assert %Turtle{source: "fw 50"} = stored(table)
    end
  end
end
