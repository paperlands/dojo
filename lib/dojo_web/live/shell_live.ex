defmodule DojoWeb.ShellLive do
  use DojoWeb, :live_shell
  alias DojoWeb.Session
  alias DojoWeb.ShellLive.{OuterShell}
  import DojoWeb.SVGComponents

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

  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(
       label: nil,
       clan: nil,
       outershell: %OuterShell{},
       sensei: false,
       class: nil,
       disciples: %{},
       visible_disciples: MapSet.new(),
       pane: true
     )
     |> assign(focused_name: "")}
  end

  def handle_params(params, _url, socket) do
    if connected?(socket), do: Dojo.PubSub.subscribe("dojo:hotspot")

    {:noreply,
     socket
     |> join_clan(params["clan"] || "PaperLand")
     |> sync_session()}
  end

  defp join_clan(socket, clan) do
    socket
    |> assign(clan: clan)
    |> start_async(:list_disciples, fn -> Dojo.Class.list_disciples("shell:" <> clan) end)
  end

  defp sync_session(
         %{assigns: %{session: %Session{name: name, last_opened: time}, clan: clan}} = socket
       )
       when is_binary(name) do
    parent = self()

    # Compute user_id: combine name + first login time for unique session identity
    # Same logic as hatchTurtle to ensure consistency
    user_id =
      (name <> Base.encode64(to_string(time)))
      |> String.replace(~r/[^a-zA-Z0-9]/, "")

    socket
    |> start_async(:join_disciples, fn ->
      Dojo.Class.join!(parent, "shell:" <> clan, %Dojo.Disciple{
        name: name,
        action: "active",
        user_id: user_id
      })
    end)
  end

  defp sync_session(socket) do
    socket
  end

  def handle_async(:list_disciples, {:ok, disciples}, %{assigns: %{clan: clan}} = socket) do
    Dojo.Class.listen("shell:" <> clan)
    {:noreply, assign(socket, :disciples, disciples)}
  end

  def handle_async(:list_disciples, {:exit, reason}, socket) do
    IO.inspect(reason, label: "disciples load failed")
    {:noreply, socket}
  end

  def handle_async(:join_disciples, {:ok, class}, %{assigns: %{clan: _clan}} = socket) do
    Process.monitor(class)
    {:noreply, assign(socket, :class, class)}
  end

  def handle_async(:join_disciples, {:exit, reason}, socket) do
    IO.inspect(reason, label: "disciples join failed")
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

  def handle_async(:follow_code, {:ok, %Dojo.Turtle{} = turtle}, socket) do
    outershell = socket.assigns.outershell

    {:noreply,
     socket
     |> assign(:outershell, %{outershell | state: turtle.state, last_active: turtle.time})
     |> push_event("seeOuterShell", Map.from_struct(turtle))}
  end

  def handle_async(:follow_code, {:ok, _}, socket), do: {:noreply, socket}
  def handle_async(:follow_code, {:exit, _reason}, socket), do: {:noreply, socket}

  # presence handlers — keyed by reg_key from node tuple (stable unique identity)

  def handle_info(
        {:join, "class:shell" <> _, %{node: {reg_key, _}} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    {:noreply, assign(socket, :disciples, Map.put(d, reg_key, disciple))}
  end

  def handle_info(
        {:leave, "class:shell" <> _, %{node: {reg_key, _}, phx_ref: ref}},
        %{assigns: %{disciples: d}} = socket
      ) do
    # only delete if the leaving ref matches the current ref for this reg_key
    # prevents stale-leave race when Gate.change regenerates phx_ref
    if d[reg_key][:phx_ref] == ref do
      {:noreply, assign(socket, :disciples, Map.delete(d, reg_key))}
    else
      {:noreply, socket}
    end
  end

  def handle_info({Dojo.PubSub, :focused_name, {focused_name}}, socket) do
    {:noreply, assign(socket, focused_name: focused_name)}
  end

  # Layer 2a: local hatch push — meta already in message, no RPC needed
  def handle_info({Dojo.PubSub, :hatch, {reg_key, {Dojo.Turtle, meta}}}, socket) do
    {:noreply,
     socket
     |> update_visible_meta(reg_key, meta)
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
    {:noreply, socket}
  end

  def handle_event(
        "keepTurtle",
        _,
        %{assigns: %{disciples: dis}} = socket
      ) do
    push_socket =
      dis
      |> Enum.reduce(
        socket,
        fn
          {_reg_key, %{name: name, meta: %{path: path}}}, sock ->
            sock
            |> push_event("download-file", %{
              href: "///" <> path,
              filename: name <> ".png"
            })

          _, sock ->
            sock
        end
      )

    {:noreply, push_socket}
  end

  def handle_event(
        "hatchTurtle",
        %{"state" => _state} = payload,
        %{assigns: %{class: class, clan: clan, session: %{name: name, last_opened: time}}} =
          socket
      )
      when is_binary(name) do
    # this is user sesion first logintime
    id =
      (name <> Base.encode64(to_string(time)))
      |> String.replace(~r/[^a-zA-Z0-9]/, "")

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

  def handle_event(
        "seeTurtle",
        %{"addr" => addr},
        %{assigns: %{disciples: dis, class: _class}} = socket
      )
      when is_binary(addr) do
    case Dojo.Table.last(dis[addr][:node], :hatch) do
      %Dojo.Turtle{state: state} = table_state ->
        {:noreply,
         socket
         |> push_event("seeOuterShell", Map.from_struct(table_state))
         |> assign(
           :outershell,
           %OuterShell{
             state: state,
             addr: addr,
             active: true,
             name: "#{dis[addr][:name]}"
           }
         )}

      _ ->
        {:noreply, socket}
    end
  end

  def handle_event("seeTurtle", _, socket) do
    {:noreply,
     socket
     |> assign(
       :outershell,
       %OuterShell{}
     )}
  end

  def handle_event("followTurtle", _, %{assigns: %{outershell: shell}} = socket) do
    {:noreply,
     socket
     |> assign(
       :outershell,
       %{shell | follow: !shell.follow}
     )}
  end

  def handle_event("closeTurtle", _, socket) do
    {:noreply,
     socket
     |> assign(
       :outershell,
       %OuterShell{}
     )}
  end

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

  def handle_event("flipPane", _, socket), do: {:noreply, update(socket, :pane, &(!&1))}

  def handle_event("opensenseime", _, %{assigns: %{sensei: bool}} = socket) do
    {:noreply, assign(socket, sensei: !bool)}
  end

  def handle_event(
        "toggle-focus",
        %{"disciple-name" => _name},
        %{assigns: %{sensei: false}} = socket
      ),
      do: {:noreply, socket}

  def handle_event(
        "toggle-focus",
        %{"disciple-name" => name},
        %{assigns: %{sensei: true, clan: clan}} = socket
      ) do
    old_name = socket.assigns.focused_name

    new_name =
      case old_name do
        "" -> name
        ^name -> ""
        _ -> name
      end

    Dojo.PubSub.publish({new_name}, :focused_name, "class:shell:" <> clan)

    {:noreply, assign(socket, focused_name: new_name)}
  end

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
        e,
        p,
        socket
      ) do
    dbg()
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
    with %{node: node} <- disciples[reg_key],
         %{path: _, state: _, time: _} = meta <- Dojo.Table.last_meta(node, :hatch) do
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

  defp maybe_follow_code(socket, reg_key, time) do
    %{outershell: outershell, disciples: dis} = socket.assigns

    if outershell.follow and outershell.addr == reg_key and dis[reg_key][:node] do
      if (time || 0) > outershell.last_active do
        start_async(socket, :follow_code, fn ->
          Dojo.Table.last(dis[reg_key][:node], :hatch)
        end)
      else
        socket
      end
    else
      socket
    end
  end

  defp bump_path_time(nil, _time), do: nil
  defp bump_path_time(path, time), do: Regex.replace(~r/\?t=\d+/, path, "?t=#{time}")

  def outershell(assigns) do
    ~H"""
    <div class="relative outershell  pt-20 right-2 w-full lg:-left-1/2 lg:w-[150%] ">
      <div class="flex items-start justify-between gap-2 mb-3">
        <span
          id="top-head"
          class="text-lg font-bold text-secondary-content flex-1 leading-tight"
        >
          {Session.t(@locale, "@%{addr}'s code", addr: @outershell.name)}
        </span>

        <span
          phx-click="followTurtle"
          class="pointer-events-auto cursor-pointer relative flex h-2 w-2 flex-shrink-0 mt-1 mr-3 transition-colors delay-150"
        >
          <span class={[
            "absolute inline-flex h-full w-full rounded-full  opacity-75",
            (@outershell.state == :error && "bg-error") ||
              (@outershell.follow && "bg-accent-content animate-ping") || "bg-primary"
          ]}>
          </span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-primaryAccent"></span>
        </span>
      </div>

      <div
        id="outerenv"
        phx-update="ignore"
        class="overflow-y-scroll relative border pointer-events-auto rounded-lg h-[50vh]  border-amber-600/20 dark-scrollbar backdrop-blur-xs scrollbar-hide cursor-text"
      >
        <button
          phx-click="closeTurtle"
          class="z-50 absolute flex  items-center justify-center w-8 h-8 transition-all duration-300 transform border-2 rounded-full opacity-50 pointer-events-auto backdrop-blur-sm hover:scale-110 group hover:opacity-100 top-2 right-2 border-accent focus-within:border-none"
        >
          <!-- Base Crosshair -->
          <div class="absolute inset-0 flex items-center justify-center">
            <svg
              class="w-4 h-4 transition-colors text-error text-shadow-error group-hover:text-primary-content"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </div>
        </button>
        <!--
        <div class="relative z-4 rounded-sm pointer-events-auto cursor-text border-none h-full" >
        <textarea
          phx-update="ignore"
          id="outershell"
          phx-hook="Shell"
          data-target="outer"/>
      </div>
      -->
        <div
          phx-update="ignore"
          id="outershell"
          phx-hook="Shell"
          class="relative z-40 rounded-sm pointer-events-auto cursor-text bg-inherit border-none h-full"
          data-target="outer"
        />
      </div>
      <div
        class="flex"
        class="-bottom-1/12  transition-colors delay-150 duration-300 overflow-y-auto pb-1 "
      >
        <div
          phx-update="ignore"
          id="outer-output"
          class="w-1/2 left-2 flex-auto opacity-80 font-mono border-none text-primary text-sm"
        />

        <div
          phx-update="ignore"
          id="outermerge-output"
          class="w-1/2 flex-auto font-mono  opacity-80 border-none text-primary text-sm"
        />
      </div>
    </div>
    """
  end

  def nerve(assigns) do
    ~H"""
    <div class="relative hidden rightthird nerve pt-10 right-2 w-full lg:-left-1/5 lg:w-[120%] ">
      <div class="h-full w-full max-w-2xl mx-auto">
        <div class="relative h-full overflow-hidden">
          <div class="h-full overflow-y-auto space-y-1 text-sm">
            <p class="text-primary-content">远山如黛</p>
            <p class="text-primary">The mountains fade into mist</p>
            <p class="text-primary-content">江流天地外</p>
            <p class="text-primary">Rivers flow beyond heaven and earth</p>
          </div>

          <div class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-transparent to-black/100   pointer-events-none">
          </div>
        </div>
      </div>
    </div>
    """
  end

  # Deck is now DojoWeb.DeckLive LiveComponent — mounted in the template

  def memory_well(assigns) do
    ~H"""
    <!-- Memory Well Component (memory_well.html.heex) -->
    <div class="fixed flex flex-col w-64 top-1/4 h-4/5 right-5 bottom-20">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 mb-2 border-b border-amber-600/50">
        <h2 class="text-xl font-bold text-amber-200">Memory Well</h2>
        
    <!-- View Toggle -->
        <div class="flex space-x-2">
          <button
            phx-click="store-memory"
            class="flex items-center justify-center w-8 h-8 rounded-full border-2 border-primary/50 backdrop-blur-sm transform transition-all duration-300 hover:scale-110 hover:rotate-[-45deg] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:rotate-0"
          >
            <.save class="w-4 h-4 text-amber-400" />
          </button>
        </div>
      </div>
      
    <!-- Viewing Pane -->
      <div class="flex-1 overflow-y-auto p-2 dark-scrollbar">
        <div class="space-y-3">
          <%= for mmr <- @memories do %>
            <div
              :if={Map.has_key?(mmr, :meta)}
              class="flex items-center p-3 transition-colors rounded-lg bg-primary-900/70 hover:bg-primary-800/70"
            >
              <!-- Thumbnail -->
              <div class="flex-shrink-0 w-16 h-16 mr-4 overflow-hidden rounded">
                <img src={mmr.meta.path} class="object-cover w-full h-full" />
              </div>
              
    <!-- Info -->
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-bold text-primary-content truncate">{"title here"}</h3>
                <p class="text-xs text-amber-400/60">{"date here"}</p>
              </div>
              
    <!-- Actions -->
              <div class="flex ml-2 space-x-2">
                <button
                  phx-click="view-item"
                  phx-value-id={mmr.phx_ref}
                  class="p-2 transition-colors rounded-full bg-amber-900/70 hover:bg-amber-800"
                >
                  <svg
                    class="w-4 h-4 text-primary-content"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
                <button
                  phx-click="download-item"
                  phx-value-id={mmr.phx_ref}
                  class="p-2 transition-colors rounded-full bg-amber-900/70 hover:bg-amber-800"
                >
                  <svg
                    class="w-4 h-4 text-primary-content"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            </div>
          <% end %>
        </div>
      </div>
      <!-- Decorative corners -->
      <div class="absolute w-3 h-3 border-t-2 border-l-2 -top-2 -left-4 border-amber-400"></div>
      <div class="absolute w-3 h-3 border-t-2 border-r-2 -top-2 right-1 border-amber-400"></div>
      <div class="absolute w-3 h-3 border-b-2 border-l-2 -bottom-2 -left-4 border-amber-400"></div>
      <div class="absolute w-3 h-3 border-b-2 border-r-2 -bottom-2 right-1 border-amber-400"></div>
    </div>
    """
  end

  def export(assigns) do
    ~H"""
    <div
      phx-click="keepTurtle"
      class="relative z-[60] flex items-center m-auto gap-2 px-4 py-2 bg-transparent rounded-lg backdrop-blur-sm transform transition-all duration-300 hover:scale-105 group z-[100]"
    >
      <div class="relative w-6 h-6">
        <svg
          class="absolute inset-0 w-6 h-6 text-primary-content transform transition-transform group-hover:translate-y-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </div>

      <span class="font-mono text-sm tracking-wide transition-all duration-300 transform text-primary group-hover:text-primary">
        Keep Creations
      </span>
      <!-- Decorative corners -->
      <div class="absolute w-2 h-2 border-t-2 border-l-2 -top-1 animate-pulse -left-1 border-primary">
      </div>
      <div class="absolute w-2 h-2 border-t-2 border-r-2 -top-1 animate-pulse -right-1 border-primary">
      </div>
      <div class="absolute w-2 h-2 border-b-2 border-l-2 -bottom-1 animate-pulse -left-1 border-primary">
      </div>
      <div class="absolute w-2 h-2 border-b-2 border-r-2 -bottom-1 animate-pulse -right-1 border-primary">
      </div>
    </div>
    <!-- Tooltip -->
    <div class="absolute mb-2 transition-opacity duration-200 -translate-x-1/2 opacity-0 bottom-full left-1/2 group-hover:opacity-100">
      <div class="px-2 py-1 text-xs border rounded bg-primary/90 text-primary border-primary backdrop-blur-sm whitespace-nowrap">
        Download Your Creation
      </div>
    </div>
    """
  end

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

  defp is_main_focus(name, focused_name) do
    case name do
      ^focused_name -> " scale-150"
      _ -> " border-primary"
    end
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
