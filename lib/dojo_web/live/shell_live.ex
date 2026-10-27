defmodule DojoWeb.ShellLive do
  use DojoWeb, :live_shell
  require Logger
  alias DojoWeb.Session
  alias DojoWeb.ShellLive.{OuterShell}
  import DojoWeb.SVGComponents
  import DojoWeb.RiverComponent

  @moduledoc """
  This LV module defines the Turtling Experience

  we break apart the problem as follows:

  turtle bridge
  turtle <--> turtle  <--- editor
    |            |
    |            |
    v            v
  [canvas]     [canvas]
  """

  # ShellLive only (lvdx-9). Real Module attributes — Phoenix html/tag engines
  # read them and stop emitting data-phx-loc / HEEx source annotations on every
  # node. Without this the morph tree drowns in debug attrs; with it, a future
  # reader must not "clean up dead code." Unrelated to the data-* mergeAttrs
  # trap on phx-update=ignore islands — that is JS.ignore_attributes (lvdx-2).
  @debug_heex_annotations false
  @debug_attributes false

  @selector_views %{"watch" => :watch, "draft" => :draft, "recall" => :recall}
  @selector_keys [:addr, :view, :draft_live, :follow_peer]

  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(
       label: nil,
       clan: nil,
       outershell: %OuterShell{},
       class: nil,
       disciples: %{},
       lanterns: [],
       visible_disciples: MapSet.new()
     )}
  end

  def handle_params(params, _url, socket) do
    clan = params["clan"] || "PaperLand"

    if connected?(socket) do
      Dojo.PubSub.subscribe("dojo:hotspot")
      Dojo.Nerve.subscribe(clan)
    end

    {:noreply,
     socket
     |> join_clan(clan)
     |> sync_session()}
  end

  defp join_clan(socket, clan) do
    uid = self_id(socket)

    socket
    |> assign(clan: clan)
    |> start_async(:list_disciples, fn -> Dojo.Class.list_disciples("shell:" <> clan) end)
    # The room's lanterns — journal heads, room-ordered, minus my own (ks-light,
    # ks-delta). A seat's dark face. Fetched once: room memory is slow where
    # presence is churn.
    |> start_async(:load_lanterns, fn -> Dojo.Keep.latest(clan, of: :root, except: uid) end)
  end

  defp self_id(%{assigns: %{session: %Session{name: name} = s}}) when is_binary(name),
    do: Session.author_id(s)

  defp self_id(_), do: nil

  # The seat a hand stands on, resolved once from the work_id presence already
  # carries (ks-light). `Keep.owner_of` is the works bind — any river to its
  # journal, not only the head a fan shows. A local derivation on the read-only
  # projection, never written back; an unshared work resolves to nil → rootless.
  defp with_root(%{keep: work} = disciple) when is_binary(work),
    do: Map.put(disciple, :root, Dojo.Keep.owner_of(work))

  defp with_root(disciple), do: disciple

  defp sync_session(%{assigns: %{session: %Session{name: name} = session, clan: clan}} = socket)
       when is_binary(name) do
    parent = self()

    # Pre-cut occupancy (keep-cut II). Occupancy is root; this is not it.
    author_id = Session.author_id(session)

    socket
    |> start_async(:join_disciples, fn ->
      Dojo.Class.join!(parent, "shell:" <> clan, %Dojo.Disciple{
        name: name,
        action: "active",
        author_id: author_id
      })
    end)
  end

  defp sync_session(socket) do
    socket
  end

  def handle_async(:list_disciples, {:ok, disciples}, %{assigns: %{clan: clan}} = socket) do
    Dojo.Class.listen("shell:" <> clan)
    socket = assign(socket, :disciples, Map.new(disciples, fn {k, d} -> {k, with_root(d)} end))
    {:noreply, apply_selection(socket)}
  end

  def handle_async(:list_disciples, {:exit, reason}, socket) do
    Logger.error("[LC:ShellLive] disciples load failed: #{inspect(reason)}")
    {:noreply, socket}
  end

  def handle_async(:load_lanterns, {:ok, {lanterns, _cursor}}, socket) do
    {:noreply, assign(socket, :lanterns, lanterns)}
  end

  def handle_async(:load_lanterns, {:exit, reason}, socket) do
    Logger.error("[LC:ShellLive] lanterns load failed: #{inspect(reason)}")
    {:noreply, socket}
  end

  def handle_async(:join_disciples, {:ok, class}, %{assigns: %{clan: _clan}} = socket) do
    Process.monitor(class)
    # The owner stands only after the Table is attached. This is the one
    # readiness request: the client answers by reading CURRENT, never a queue.
    {:noreply, socket |> assign(:class, class) |> push_event("syncShell", %{})}
  end

  def handle_async(:join_disciples, {:exit, reason}, socket) do
    Logger.error("[LC:ShellLive] disciples join failed: #{inspect(reason)}")
    {:noreply, socket}
  end

  def handle_async(:pull_visible, {:ok, metadata}, socket) when map_size(metadata) == 0 do
    {:noreply, socket}
  end

  def handle_async(:pull_visible, {:ok, metadata}, socket) do
    current = socket.assigns.disciples

    disciples =
      Enum.reduce(metadata, current, fn {name, meta}, acc ->
        if Map.has_key?(acc, name) do
          existing_time = get_in(acc, [name, :meta, :time]) || 0

          if (meta[:time] || 0) > existing_time do
            put_in(acc, [name, :meta], meta)
          else
            acc
          end
        else
          acc
        end
      end)

    if disciples == current do
      {:noreply, socket}
    else
      {:noreply, assign(socket, :disciples, disciples)}
    end
  end

  def handle_async(:pull_visible, {:exit, _reason}, socket) do
    {:noreply, socket}
  end

  @max_follow_attempts 3
  @follow_backoff [250, 1000]

  # One owned read lane: task or retry timer, with one coalesced "again" flag.
  def handle_async(:follow_code, {:ok, {gen, addr, attempt, outcome}}, socket) do
    case socket.assigns[:follow_read] do
      %{phase: :read, gen: ^gen, addr: ^addr, attempt: ^attempt, again: again} ->
        socket = assign(socket, :follow_read, nil)

        if current_follow?(socket, gen, addr),
          do: {:noreply, finish_follow(socket, again, gen, addr, attempt, outcome)},
          else: {:noreply, socket}

      _ ->
        {:noreply, socket}
    end
  end

  def handle_async(:follow_code, {:ok, _}, socket), do: {:noreply, socket}

  def handle_async(:follow_code, {:exit, reason}, socket) do
    case socket.assigns[:follow_read] do
      %{phase: :read, gen: gen, addr: addr, attempt: attempt} ->
        socket = assign(socket, :follow_read, nil)

        if current_follow?(socket, gen, addr),
          do: {:noreply, schedule_retry(socket, gen, addr, attempt, {:exit, reason})},
          else: {:noreply, socket}

      _ ->
        {:noreply, socket}
    end
  end

  defp finish_follow(socket, again, gen, addr, attempt, outcome) do
    case outcome do
      {:turtle, %Dojo.Turtle{} = turtle} ->
        {:noreply, socket} = apply_follow(turtle, socket)
        maybe_trailing(socket, again, gen, addr)

      :empty ->
        maybe_trailing(socket, again, gen, addr)

      {:error, reason} ->
        # A coalesced hatch never buys another attempt: the failure budget is
        # the slot's, and retry departure consumes any demand that arrived.
        schedule_retry(socket, gen, addr, attempt, reason)
    end
  end

  defp current_follow?(socket, gen, addr) do
    gen == follow_gen(socket) and socket.assigns.outershell.addr == addr and
      OuterShell.wants_updates?(socket.assigns.outershell)
  end

  defp maybe_trailing(socket, true, gen, addr) do
    if current_follow?(socket, gen, addr),
      do: start_follow_read(socket, gen, addr, 1),
      else: socket
  end

  defp maybe_trailing(socket, _again, _gen, _addr), do: socket

  defp start_follow_read(socket, gen, addr, attempt) do
    case socket.assigns.disciples[addr] do
      %{} = disciple ->
        address = Dojo.Disciple.table_address(disciple)

        socket =
          assign(socket, :follow_read, %{
            phase: :read,
            gen: gen,
            addr: addr,
            attempt: attempt,
            again: false
          })

        start_async(socket, :follow_code, fn ->
          try do
            {gen, addr, attempt, follow_outcome(Dojo.Table.last(address, :hatch))}
          rescue
            e -> {gen, addr, attempt, {:error, Exception.message(e)}}
          catch
            kind, reason -> {gen, addr, attempt, {:error, {kind, reason}}}
          end
        end)

      _ ->
        socket
    end
  end

  defp follow_outcome(nil), do: :empty
  defp follow_outcome(%Dojo.Turtle{} = turtle), do: {:turtle, turtle}
  defp follow_outcome(other), do: {:error, {:unexpected, other}}

  defp demand_follow(socket, addr) do
    %{outershell: shell} = socket.assigns

    if shell.addr == addr and OuterShell.wants_updates?(shell) do
      case socket.assigns[:follow_read] do
        nil -> start_follow_read(socket, follow_gen(socket), addr, 1)
        slot -> assign(socket, :follow_read, %{slot | again: true})
      end
    else
      socket
    end
  end

  defp schedule_retry(socket, gen, addr, attempt, reason) do
    if attempt < @max_follow_attempts do
      delay = Enum.at(@follow_backoff, attempt - 1, 1000)
      timer = :erlang.start_timer(delay, self(), :follow_retry)

      assign(socket, :follow_read, %{
        phase: :retry,
        gen: gen,
        addr: addr,
        attempt: attempt + 1,
        timer: timer,
        again: false
      })
    else
      Logger.warning(
        "follow_code exhausted addr=#{addr} gen=#{gen} attempts=#{attempt} reason=#{inspect(reason, limit: 10, printable_limit: 200)}"
      )

      assign(socket, :follow_read, nil)
    end
  end

  defp retire_follow_read(socket, reason) do
    case socket.assigns[:follow_read] do
      %{phase: :read} ->
        socket |> assign(:follow_read, nil) |> cancel_async(:follow_code, reason)

      %{phase: :retry, timer: timer} ->
        if timer, do: :erlang.cancel_timer(timer)
        assign(socket, :follow_read, nil)

      _ ->
        socket
    end
  end

  # Each selection epoch retires pending peer-read results.
  defp follow_gen(socket), do: socket.assigns[:follow_gen] || 0

  defp bump_follow(socket) do
    socket
    |> retire_follow_read(:epoch)
    |> assign(:follow_gen, follow_gen(socket) + 1)
  end

  # The owner's selector descriptor: recovery metadata, never a document.
  defp push_intent(socket) do
    push_event(socket, "outerIntent", Map.take(socket.assigns.outershell, @selector_keys))
  end

  # Presence enriches a retained selection without changing its selector.
  defp apply_selection(
         %{assigns: %{outershell: %OuterShell{addr: addr, origin: nil} = shell, disciples: dis}} =
           socket
       )
       when is_binary(addr) do
    case dis[addr] do
      %{} = disciple ->
        shell = %{shell | name: "#{disciple[:name]}", root: disciple[:root], active: true}
        socket = assign(socket, :outershell, shell)

        # A paused watch keeps its island; only a live/following seat reads.
        if OuterShell.wants_updates?(shell), do: fetch_watch(socket, addr), else: socket

      _ ->
        socket
    end
  end

  defp apply_selection(socket), do: socket

  # Optional last-known chrome from the client; presence always overwrites it.
  defp recover_name(shell, payload) do
    shell =
      if is_binary(payload["name"]) and payload["name"] != "",
        do: %{shell | name: payload["name"]},
        else: shell

    if is_binary(payload["root"]) and payload["root"] != "",
      do: %{shell | root: payload["root"]},
      else: shell
  end

  defp apply_follow(turtle, socket) do
    prev = socket.assigns.outershell.origin
    shell = OuterShell.observe(socket.assigns.outershell, turtle)
    socket = assign(socket, :outershell, shell)

    # Only a preview/path bump is silence; everything else is news (D025 R3).
    if OuterShell.reflect_changed?(prev, turtle) do
      socket =
        case OuterShell.render_intent(shell) do
          {:push, source} ->
            push_event(socket, "seeOuterShell", OuterShell.payload(source, shell))

          :hold ->
            socket
        end

      {:noreply, socket}
    else
      {:noreply, socket}
    end
  end

  # presence handlers — keyed by reg_key (a meta field; Disciple.reg_key/1
  # stays tolerant of legacy metas where it rode inside the node tuple).
  # The `disciples` assign is a DECLARED READ-ONLY PROJECTION of Tracker
  # state + Table meta (Phase 4): written only here and by the pull/hatch
  # meta refreshers — never written back to any owner.

  def handle_info(
        {:join, "class:shell" <> _, disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    reg_key = Dojo.Disciple.reg_key(disciple)
    # Gate.change re-joins under a new phx_ref; hatch meta is not Tracker state.
    disciple = disciple |> retain_hatch_meta(d[reg_key]) |> with_root()

    socket = assign(socket, :disciples, Map.put(d, reg_key, disciple))

    if socket.assigns.outershell.addr == reg_key,
      do: {:noreply, apply_selection(socket)},
      else: {:noreply, socket}
  end

  def handle_info(
        {:leave, "class:shell" <> _, %{phx_ref: ref} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    reg_key = Dojo.Disciple.reg_key(disciple)
    # only delete if the leaving ref matches the current ref for this reg_key
    # prevents stale-leave race when Gate.change regenerates phx_ref
    if d[reg_key][:phx_ref] == ref do
      leaving = d[reg_key]

      {:noreply,
       socket
       |> assign(:disciples, Map.delete(d, reg_key))
       |> relight(leaving)}
    else
      {:noreply, socket}
    end
  end

  # Layer 2a: local hatch push — meta already in message, no RPC needed
  def handle_info({Dojo.PubSub, :hatch, {reg_key, {Dojo.Turtle, meta}}}, socket) do
    {:noreply,
     socket
     |> update_visible_meta(reg_key, meta)
     |> push_attend(reg_key, meta)
     |> maybe_follow_code(reg_key, meta[:time])}
  end

  # Layer 2b: remote version signal — derive meta from signal, no RPC for visible
  # Map payload: extensible across rolling deploys. Path preserved from prior pull/local hatch.
  def handle_info(
        {Dojo.PubSub, :hatch_version, %{reg_key: reg_key} = version},
        socket
      ) do
    {:noreply, apply_hatch_version(socket, reg_key, version[:time], version[:state])}
  end

  # Legacy 3-tuple from older nodes during rolling deploy — same semantics
  def handle_info(
        {Dojo.PubSub, :hatch_version, {reg_key, time, state}},
        socket
      ) do
    {:noreply, apply_hatch_version(socket, reg_key, time, state)}
  end

  def handle_info({Dojo.Controls, command, arg}, socket) do
    {:noreply, socket |> push_event("writeShell", %{"command" => command, "args" => arg})}
  end

  def handle_info({Dojo.PubSub, :hotspot_changed, status}, socket) do
    send_update(DojoWeb.HotspotLive, id: "hotspot", hotspot_status: status)
    {:noreply, socket}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, %{assigns: %{class: pid}} = socket) do
    # nil our pid and rejoins 
    {:noreply, socket |> assign(:class, nil) |> sync_session()}
  end

  def handle_info({:setting, key, value}, socket) do
    {:noreply, Session.apply_setting(socket, key, value)}
  end

  def handle_info({:timeout, timer, :follow_retry}, socket) do
    case socket.assigns[:follow_read] do
      %{phase: :retry, timer: ^timer, gen: gen, addr: addr, attempt: attempt} ->
        socket = assign(socket, :follow_read, nil)

        if current_follow?(socket, gen, addr),
          do: {:noreply, start_follow_read(socket, gen, addr, attempt)},
          else: {:noreply, socket}

      _ ->
        {:noreply, socket}
    end
  end

  # --- OuterShell LiveComponent messages ---

  def handle_info({:outer_shell, :toggle_follow_peer}, socket) do
    # The LiveView owns the authoritative follow_peer flag; the component emits a bare
    # intent and we flip our own value — no stale read round-trips through the UI.
    socket = update(socket, :outershell, &%{&1 | follow_peer: !&1.follow_peer})
    socket = push_intent(socket)
    # Resuming an idle watch reads CURRENT now, not at the next hatch.
    socket =
      cond do
        socket.assigns.outershell.follow_peer -> fetch_latest(socket)
        OuterShell.wants_updates?(socket.assigns.outershell) -> socket
        true -> retire_follow_read(socket, :paused)
      end

    {:noreply, socket}
  end

  def handle_info({:outer_shell, :recall}, socket) do
    {:noreply, apply_outer_view(socket, OuterShell.recall(socket.assigns.outershell))}
  end

  def handle_info({:outer_shell, :watch}, socket) do
    {:noreply, apply_outer_view(socket, OuterShell.watch(socket.assigns.outershell))}
  end

  def handle_info({:outer_shell, :toggle_draft_live}, socket) do
    shell = OuterShell.toggle_draft_live(socket.assigns.outershell)
    live = shell.view == :draft and shell.draft_live

    socket =
      socket
      |> apply_outer_view(shell)
      |> push_event("outerLive", %{live: live})

    # Going live: pull their freshest code so the diff baseline (and your running
    # draft's reference) is current right away, not at the next hatch.
    {:noreply, if(live, do: fetch_latest(socket), else: socket)}
  end

  # --- Nerve signal relay ---

  def handle_info({Dojo.PubSub, :nerve, signal}, socket) do
    ref =
      case find_reg_key(socket.assigns.disciples, signal.source) do
        nil -> nil
        key -> %{key: key}
      end

    {:noreply, push_event(socket, "nerveIncoming", Map.put(signal, :ref, ref))}
  end

  def handle_info(event, socket) do
    IO.inspect(event, label: "pokemon catch event")

    {:noreply, socket}
  end

  def handle_event(
        "changeName",
        %{"value" => name},
        %{assigns: %{class: class}} = socket
      ) do
    # Route through Table GenServer (which owns the presence entry)
    # instead of through Class (which used the LiveView PID)
    Dojo.Table.change_meta(class, {:name, name})
    send(self(), {:setting, :name, name})
    {:noreply, socket}
  end

  def handle_event(
        "hatchTurtle",
        %{"state" => _state} = payload,
        %{assigns: %{class: class, clan: clan, session: %Session{name: name} = session}} =
          socket
      )
      when is_pid(class) and is_binary(name) do
    # Pre-cut hatch attribution (keep-cut II).
    id = Session.author_id(session)

    Dojo.Turtle.reflect(payload, %{topic: :hatch, class: class, node: node(), id: id, clan: clan})

    {:noreply, socket}
  end

  def handle_event(
        "hatchTurtle",
        %{"commands" => _commands},
        socket
      ) do
    {:noreply, socket}
  end

  # Not ready, or not a full reflect: syncShell will read CURRENT once the
  # owner stands. No pending_hatch, no queue.
  def handle_event("hatchTurtle", _payload, socket), do: {:noreply, socket}

  # Recovery metadata from the watcher's mirrored descriptor. It installs the
  # selection BEFORE presence; enrichment/fetch lands when the peer is known.
  def handle_event("restoreShell", payload, socket) when is_map(payload) do
    with addr when is_binary(addr) and addr != "" <- payload["addr"],
         view when not is_nil(view) <- @selector_views[payload["view"]],
         draft_live when is_boolean(draft_live) <- payload["draft_live"],
         follow_peer when is_boolean(follow_peer) <- payload["follow_peer"] do
      shell = %OuterShell{
        addr: addr,
        view: view,
        draft_live: draft_live,
        follow_peer: follow_peer,
        active: true
      }

      socket =
        socket
        |> assign(:outershell, recover_name(shell, payload))
        |> bump_follow()
        |> push_intent()

      socket = apply_selection(socket)
      {:reply, Map.take(socket.assigns.outershell, @selector_keys ++ [:name, :root]), socket}
    else
      _ -> {:noreply, socket}
    end
  end

  def handle_event("restoreShell", _payload, socket), do: {:noreply, socket}

  # A click is an intention, not a successful read. Install it FIRST; an empty
  # store means "wait for their next hatch", never "forget the click".
  def handle_event(
        "seeTurtle",
        %{"addr" => addr},
        %{assigns: %{disciples: dis}} = socket
      )
      when is_binary(addr) do
    case dis[addr] do
      %{} = disciple ->
        # The friend's work_id lives in presence (`disciple[:keep]`) — read it
        # HERE, at the click, when this shell wants that work's keeps (id:kb-8).
        outershell = %OuterShell{
          addr: addr,
          active: true,
          name: "#{disciple[:name]}",
          root: disciple[:root],
          follow_peer: true
        }

        socket =
          socket
          |> assign(:outershell, outershell)
          |> bump_follow()
          |> push_intent()

        # Same epoch-fenced fetch as go-live; an empty answer leaves intent
        # standing for the next hatch. Never block the LV on a remote read.
        {:noreply, fetch_watch(socket, addr)}

      _ ->
        {:noreply, socket}
    end
  end

  # Weave open is client-local (lvdx-5). This event only informs chrome assigns —
  # never re-pushes seeOuterShell (that was the ferry).
  def handle_event(
        "seeWeave",
        %{"addr" => addr, "name" => name, "source" => source} = payload,
        socket
      )
      when is_binary(addr) and is_binary(source) do
    turtle = %Dojo.Turtle{
      state: :success,
      source: source,
      commands: payload["commands"] || [],
      diagnostics: payload["diagnostics"] || [],
      time: payload["ts"]
    }

    outershell =
      OuterShell.observe(
        %OuterShell{addr: addr, active: true, name: name, follow_peer: false},
        turtle
      )

    socket =
      socket
      |> assign(:outershell, outershell)
      |> bump_follow()
      |> push_intent()

    {:reply, Map.take(outershell, @selector_keys ++ [:name, :root]), socket}
  end

  # Empty seeTurtle = close. Server must tell the client (no prior close_js).
  def handle_event("seeTurtle", _, socket) do
    {:noreply, reset_outershell(socket, notify: true)}
  end

  # Client already ran cleanup; the reply is the canonical closed selector.
  def handle_event("closeTurtle", _, socket) do
    socket = reset_outershell(socket)
    {:reply, %{addr: nil, view: :watch, draft_live: true, follow_peer: true}, socket}
  end

  # The Shell JS hook reports the user started editing in the outer viewer.
  # A draft names its SUBJECT (O1): a bare event or a retired subject changes
  # nothing. On a mismatch re-assert the selector so the client retires its ghost.
  def handle_event("outerDraft", %{"addr" => addr}, socket)
      when is_binary(addr) and addr != "" do
    %{addr: selected} = socket.assigns.outershell

    if is_binary(selected) and selected != "" and selected == addr do
      # A draft always runs (OuterShell.draft/1); the client owns liveness.
      shell = OuterShell.draft(socket.assigns.outershell)

      {:noreply,
       socket
       |> assign(:outershell, shell)
       |> push_intent()
       |> push_event("outerLive", %{live: shell.view == :draft and shell.draft_live})}
    else
      {:noreply, push_intent(socket)}
    end
  end

  def handle_event("outerDraft", _payload, socket), do: {:noreply, socket}

  # Handle the viewport update event from the hook (Decision 003, Layer 3 — windowed pull)
  def handle_event(
        "seeDisciples",
        %{"visible_disciples" => visible_names},
        %{assigns: %{disciples: dis, visible_disciples: old_visible}} = socket
      ) do
    new_visible = MapSet.new(visible_names)

    if MapSet.equal?(new_visible, old_visible) do
      {:noreply, socket}
    else
      newly_entered = MapSet.difference(new_visible, old_visible)
      socket = assign(socket, visible_disciples: new_visible)

      if MapSet.size(newly_entered) > 0 do
        {:noreply,
         start_async(socket, :pull_visible, fn ->
           pull_metadata(dis, newly_entered)
         end)}
      else
        {:noreply, socket}
      end
    end
  end

  # pushEvent ↔ envelope adapter (Phase 3): the client's `ts` rides through
  # untouched — Dojo.Nerve annotates received_at, never replaces (gw-t-clock).
  # source is pre-cut occupancy (keep-cut II); letters ride presence name.
  def handle_event("nerveGlobal", %{"target" => target, "body" => body} = params, socket) do
    %{assigns: %{clan: clan, session: %Session{} = session}} = socket
    Dojo.Nerve.chat(clan, Session.author_id(session), target, body, params["ts"])
    {:noreply, socket}
  end

  # Keep ship — one message, one answer. Clan hangs; author_id is pre-cut.
  # Silence when unready is not an answer: the entry stays kept local.
  # Presence :keep should be the origin id (keep-cut VI).
  def handle_event(
        "keep",
        payload,
        %{assigns: %{clan: clan, session: %Session{name: name} = session}} = socket
      )
      when is_binary(clan) and is_binary(name) and is_map(payload) do
    reply =
      Dojo.Keep.receive(payload,
        clan: clan,
        author_id: Session.author_id(session),
        name: name
      )

    {:reply, reply, publish_latest_keep(socket, reply)}
  end

  def handle_event("keep", _payload, socket), do: {:noreply, socket}

  # pokemon clause
  def handle_event(
        e,
        p,
        socket
      ) do
    IO.inspect("pokemon handle event: " <> e)
    IO.inspect(p, label: "pokemon params")

    {:noreply, socket}
  end

  # pokemon clause
  def handle_call(
        _e,
        p,
        socket
      ) do
    IO.inspect(p, label: "pokemon params")

    {:noreply, socket}
  end

  # Bootstrap pull — fetch meta for newly visible disciples (Decision 003, Layer 3)
  # Only called on viewport entry (seeDisciples). Ongoing updates come from push/signal.
  defp pull_metadata(disciples, reg_keys) do
    Enum.reduce(reg_keys, %{}, fn reg_key, acc ->
      case pull_one_meta(disciples, reg_key) do
        %{} = meta -> Map.put(acc, reg_key, meta)
        nil -> acc
      end
    end)
  end

  # Single-key pull: returns %{path, state, time} or nil. Never crashes.
  # Used both by batch pull_metadata and by apply_hatch_version for path hydration.
  defp pull_one_meta(disciples, reg_key) do
    with %{node: _} = disciple <- disciples[reg_key],
         %{path: _, state: _, time: _} = meta <-
           Dojo.Table.last_meta(Dojo.Disciple.table_address(disciple), :hatch) do
      meta
    else
      _ -> nil
    end
  end

  defp update_visible_meta(socket, reg_key, meta) do
    %{disciples: dis, visible_disciples: visible} = socket.assigns

    if MapSet.member?(visible, reg_key) and Map.has_key?(dis, reg_key) do
      existing_time = get_in(dis, [reg_key, :meta, :time]) || 0

      if (meta[:time] || 0) > existing_time do
        existing_meta = get_in(dis, [reg_key, :meta]) || %{}
        # Preserve existing path when incoming signal has none — path is
        # hydrated by pull_visible and only the timestamp needs bumping
        merged = Map.merge(existing_meta, meta)
        merged = %{merged | path: meta[:path] || existing_meta[:path]}
        assign(socket, :disciples, put_in(dis, [reg_key, :meta], merged))
      else
        socket
      end
    else
      socket
    end
  end

  defp apply_hatch_version(socket, reg_key, time, state) do
    %{disciples: dis, visible_disciples: visible} = socket.assigns

    socket =
      if MapSet.member?(visible, reg_key) and Map.has_key?(dis, reg_key) do
        existing_meta = get_in(dis, [reg_key, :meta]) || %{}
        existing_time = existing_meta[:time] || 0

        if (time || 0) > existing_time do
          path =
            existing_meta[:path] ||
              (pull_one_meta(dis, reg_key) || %{})[:path]

          new_meta = %{
            path: bump_path_time(path, time),
            state: state,
            time: time
          }

          assign(socket, :disciples, put_in(dis, [reg_key, :meta], new_meta))
        else
          socket
        end
      else
        socket
      end

    maybe_follow_code(socket, reg_key, time)
  end

  # The attention rides the META already in hand — no fetch, no task, ~40 bytes.
  # No time gate: `maybe_follow_code`'s is second-resolution and dropped moves
  # inside one second. No `:node` either, which is why self-watch got nothing.
  # The client already ignores a line equal to the one it holds.
  defp push_attend(socket, reg_key, %{attend: attend}) when not is_nil(attend) do
    outershell = socket.assigns.outershell

    if outershell.addr == reg_key and OuterShell.wants_updates?(outershell) do
      push_event(socket, "outerAttend", %{addr: reg_key, attend: attend})
    else
      socket
    end
  end

  defp push_attend(socket, _reg_key, _meta), do: socket

  defp maybe_follow_code(socket, reg_key, time) do
    %{outershell: outershell, disciples: dis} = socket.assigns

    if OuterShell.wants_updates?(outershell) and outershell.addr == reg_key and
         not is_nil(dis[reg_key][:node]) and (time || 0) > OuterShell.last_time(outershell) do
      demand_follow(socket, reg_key)
    else
      socket
    end
  end

  # Fetch the friend's latest now, bypassing the time gate — used on go-live so
  # the merge baseline jumps to their current code immediately.
  defp fetch_latest(socket), do: fetch_watch(socket, socket.assigns.outershell.addr)

  # One demand slot: all callers refer to CURRENT; the owned lane coalesces.
  defp fetch_watch(socket, addr) when is_binary(addr), do: demand_follow(socket, addr)
  defp fetch_watch(socket, _addr), do: socket

  defp bump_path_time(nil, _time), do: nil
  defp bump_path_time(path, time), do: Regex.replace(~r/\?t=\d+/, path, "?t=#{time}")

  # Nerve source is the author id (id:ki-presence). Match presence meta or
  # the reg_key suffix `"#{topic}:#{author_id}"`.
  defp find_reg_key(disciples, author_id) when is_binary(author_id) do
    Enum.find_value(disciples, fn {key, dis} ->
      cond do
        Map.get(dis, :author_id) == author_id -> key
        is_binary(key) and String.ends_with?(key, ":" <> author_id) -> key
        true -> nil
      end
    end)
  end

  defp find_reg_key(_disciples, _), do: nil

  # Persist the selector; deliver a snapshot only when render_intent allows it.
  # Chrome assigns only. Client owns open flag + canvas cleanup.
  # notify: true when the server closes without a prior close_js (empty seeTurtle).
  defp reset_outershell(socket, opts \\ []) do
    socket =
      socket
      |> assign(:outershell, %OuterShell{})
      |> bump_follow()
      |> push_intent()

    if opts[:notify], do: push_event(socket, "outerClose", %{}), else: socket
  end

  defp apply_outer_view(socket, %OuterShell{} = shell) do
    socket =
      socket
      |> assign(:outershell, shell)
      |> bump_follow()
      |> push_intent()

    case OuterShell.render_intent(shell) do
      {:push, source} -> push_event(socket, "seeOuterShell", OuterShell.payload(source, shell))
      :hold -> socket
    end
  end

  # Presence :keep should be the origin id (keep-cut VI). Pre-cut still ships target.
  defp publish_latest_keep(
         %{assigns: %{class: class}} = socket,
         %{target: target}
       )
       when is_pid(class) and is_binary(target) do
    Dojo.Table.change_meta(class, {:keep, target})
    socket
  end

  defp publish_latest_keep(socket, _), do: socket

  # A departed hand leaves its lamp — the head of its journal (id:ks-delta). The
  # root is already on the disciple (owner_of, resolved upstream), so we ask the
  # log only for the fresh head and key it by that root. The living name is still
  # on the leaving hand — history does not join authors; copy it (id:ks-name).
  # A hand with no root made no keep: nothing to leave, no query, no harm.
  defp relight(%{assigns: %{lanterns: lanterns}} = socket, %{root: root} = leaving)
       when is_binary(root) do
    case Dojo.Keep.history(root, of: :root) do
      {[lamp | _], _} ->
        lamp = put_name(lamp, Map.get(leaving, :name))
        assign(socket, :lanterns, [lamp | Enum.reject(lanterns, &(&1.root == root))])

      _ ->
        socket
    end
  end

  defp relight(socket, _leaving), do: socket

  defp put_name(lamp, name) when is_binary(name) and name != "", do: Map.put(lamp, :name, name)
  defp put_name(lamp, _), do: lamp

  defp retain_hatch_meta(disciple, %{meta: meta}) when not is_nil(meta),
    do: Map.put(disciple, :meta, meta)

  defp retain_hatch_meta(disciple, _), do: disciple

  def slider(assigns) do
    ~H"""
    <div
      id="slider"
      class="absolute hidden w-2/3 max-w-xs transition-opacity duration-300 ease-in-out opacity-50 group hover:opacity-100 group-hover:block"
    >
      <div class="flex items-center space-x-3">
        <!-- Value Display -->
        <div class="w-4 mr-4 -ml-4 text-left">
          <span class="font-mono text-sm text-primary-content">
            -360
          </span>
        </div>
        <!-- Slider Track -->
        <div class="relative flex-grow h-2 overflow-hidden rounded-full bg-amber-900/60">
          <!-- Gear Background -->
          <div class="absolute inset-y-0 left-0 w-full opacity-50 pointer-events-none bg-gradient-to-r from-amber-700/30 to-amber-600/30">
          </div>
          <!-- Slider Fill -->
          <div
            class="absolute inset-y-0 left-0 transition-all duration-300 ease-out rounded-full bg-amber-600"
            style={"width: #{@slider_value}%"}
          >
          </div>
          <!-- Slider Thumb -->
          <div
            id="slider-thumb"
            phx-hook="Draggables"
            class="absolute w-6 h-6 transition-transform duration-300 transform  -translate-x-1/2 -translate-y-1/2 border-2 rounded-full cursor-pointer top-1/2 bg-amber-900 border-amber-600 hover:scale-110 active:scale-125"
            style={"left: #{@slider_value}%"}
          >
            <!-- Inner Gear Detail -->
            <svg
              class="absolute inset-0 w-full h-full opacity-50 text-amber-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
              <path d="M12 3C11.175 3 10.5 3.675 10.5 4.5V4.71094C10.5 5.32494 10.074 5.86494 9.48901 6.05994C9.33001 6.11394 9.17397 6.17397 9.01697 6.23397C8.43897 6.47797 7.76901 6.35191 7.34001 5.92191L7.17999 5.76205C6.60999 5.19205 5.69498 5.19205 5.12598 5.76105L4.76562 6.12109C4.19563 6.69109 4.19563 7.60595 4.76562 8.17595L4.92603 8.33594C5.35703 8.76494 5.48292 9.43494 5.23792 10.0129C5.17792 10.1699 5.11897 10.326 5.06397 10.486C4.86897 11.071 4.32897 11.4961 3.71497 11.4961H3.5C2.675 11.4961 2 12.1721 2 12.9971C2 13.8221 2.675 14.4971 3.5 14.4971H3.71094C4.32494 14.4971 4.86494 14.923 5.05994 15.508C5.11394 15.667 5.17397 15.8231 5.23397 15.9801C5.47797 16.5581 5.35191 17.228 4.92191 17.657L4.76205 17.817C4.19205 18.387 4.19205 19.302 4.76205 19.871L5.12207 20.231C5.69207 20.801 6.60693 20.801 7.17693 20.231L7.33691 20.071C7.76591 19.64 8.43592 19.514 9.01392 19.759C9.17092 19.819 9.32703 19.878 9.48703 19.933C10.072 20.128 10.4971 20.668 10.4971 21.282V21.4971C10.4971 22.3221 11.1731 22.9971 11.9981 22.9971C12.8231 22.9971 13.4981 22.3221 13.4981 21.4971V21.2861C13.4981 20.6721 13.924 20.1321 14.509 19.9371C14.668 19.8831 14.824 19.8231 14.981 19.7631C15.559 19.5191 16.229 19.6451 16.658 20.0751L16.818 20.2349C17.388 20.8049 18.303 20.8049 18.872 20.2349L19.232 19.8749C19.802 19.3049 19.802 18.39 19.232 17.82L19.072 17.66C18.641 17.231 18.515 16.561 18.76 15.983C18.82 15.826 18.879 15.67 18.934 15.51C19.129 14.925 19.669 14.5 20.283 14.5H20.4981C21.3231 14.5 21.9981 13.825 21.9981 13C21.9981 12.175 21.3231 11.5 20.4981 11.5H20.2871C19.6731 11.5 19.1331 11.074 18.9381 10.489C18.8841 10.33 18.8241 10.174 18.7641 10.017C18.5201 9.43896 18.6451 8.76901 19.0751 8.34001L19.2349 8.17999C19.8049 7.60999 19.8049 6.69498 19.2349 6.12598L18.8749 5.76562C18.3049 5.19563 17.39 5.19563 16.82 5.76562L16.66 5.92603C16.231 6.35703 15.561 6.48292 14.983 6.23792C14.826 6.17792 14.67 6.11897 14.51 6.06397C13.925 5.86897 13.5 5.32897 13.5 4.71497V4.5C13.5 3.675 12.825 3 12 3ZM12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12C17 14.7614 14.7614 17 12 17Z" />
            </svg>
          </div>
        </div>
        <!-- Value Display -->
        <div class="w-4 text-right">
          <span class="font-mono text-sm text-primary-content">
            360
          </span>
        </div>
      </div>
      <!-- Tooltip -->
      <div class="absolute mb-2 transition-opacity duration-200 -translate-x-1/2 opacity-0 pointer-events-none bottom-full left-1/2 group-hover:opacity-100">
        <div class="px-2 py-1 text-xs border rounded bg-amber-900/90 text-amber-200 border-amber-600 backdrop-blur-sm whitespace-nowrap">
          Adjust Value
        </div>
      </div>
      <!-- Ornamental -->
      <div class="absolute w-2 h-2 border-t-2 border-l-2 rounded-tl-sm -top-1 -left-1 border-primary-content">
      </div>
      <div class="absolute w-2 h-2 border-t-2 border-r-2 rounded-tr-sm -top-1 -right-1 border-amber-400">
      </div>
      <div class="absolute w-2 h-2 border-b-2 border-l-2 rounded-bl-sm -bottom-1 -left-1 border-amber-400">
      </div>
      <div class="absolute w-2 h-2 border-b-2 border-r-2 rounded-br-sm -bottom-1 -right-1 border-amber-400">
      </div>
    </div>
    """
  end

  defp to_titlecase(snek) when is_binary(snek) do
    snek
    |> String.split(["_", "-"])
    |> Enum.map(fn <<first_grapheme::utf8, rest::binary>> ->
      String.capitalize(<<first_grapheme::utf8>>) <> rest
    end)
    |> Enum.join(" ")
  end

  defp to_titlecase(_), do: ""
end
