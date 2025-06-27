defmodule DojoWeb.ShellLive do
  use DojoWeb, :live_shell
  alias DojoWeb.Session
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
       outershell: nil,
       sensei: false,
       myfunctions: [],
       mytitle: "paperland",
       outerfunctions: [],
       class: nil,
       disciples: %{},
       visible_disciples: [],
       right: :deck,
       deck: :command,
       pane: true
     )
     |> assign(focused_phx_ref: "")}
  end

  def handle_params(params, _url, socket) do
    {:noreply,
     socket
     |> join_clan(params["clan"] || "paperland")
     |> sync_session()}
  end

  defp join_clan(socket, clan) do
    Process.send_after(self(), :refreshDisciples, 200)

    socket
    |> assign(clan: clan)
    |> start_async(:list_disciples, fn -> Dojo.Class.list_disciples("shell:" <> clan) end)
  end

  defp sync_session(%{assigns: %{session: %Session{name: name} = _sess, clan: clan}} = socket)
       when is_binary(name) do
    parent = self()

    socket
    |> start_async(:join_disciples, fn ->
      Dojo.Class.join!(parent, "shell:" <> clan, %Dojo.Disciple{name: name, action: "active"})
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
    {:noreply, assign(socket, :class, class)}
  end

  def handle_async(:join_disciples, {:exit, reason}, socket) do
    IO.inspect(reason, label: "disciples join failed")
    {:noreply, socket}
  end

  # presence handlers => move to more pull based approach -> concern of class genserver instead c5 for personal shell

  def handle_info(
        {:join, "class:shell" <> _, %{phx_ref: ref} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    {:noreply,
     socket
     |> assign(:disciples, Map.put(d, ref, disciple))}
  end

  def handle_info(
        {:leave, "class:shell" <> _, %{phx_ref: ref} = _disciple},
        %{assigns: %{disciples: d}} = socket
      ) do
    if Map.has_key?(d, ref) do
      {:noreply,
       socket
       |> assign(:disciples, Map.delete(d, ref))}
    else
      {:noreply, socket}
    end
  end

  def handle_info({Dojo.PubSub, :focused_phx_ref, {focused_phx_ref}}, socket) do
    {:noreply,
     socket
     |> assign(focused_phx_ref: focused_phx_ref)}
  end

  # lets move this towards an async pull based pattern
  def handle_info(
        :refreshDisciples,
        %{assigns: %{disciples: dis, visible_disciples: visible_dis}} = socket
      ) do
    Process.send_after(self(), :refreshDisciples, 3000)

    new_dis =
      Enum.reduce(visible_dis, dis, fn ref, acc ->
        try do
          case dis[ref] && Dojo.Table.last(dis[ref][:node], :hatch) do
            nil ->
              acc

            %{path: path} ->
              put_in(acc, [ref, :meta], %{path: path})

            # Catch-all for any other unexpected return values
            _ ->
              acc
          end
        catch
          _kind, _error ->
            # Skip this disciple if Dojo.Table.last throws an error
            acc
        end
      end)

    {:noreply,
     socket
     |> assign(disciples: new_dis)}
  end

  def handle_info(
        {Dojo.PubSub, :hatch, {name, {Dojo.Turtle, meta}}},
        %{assigns: %{disciples: dis}} = socket
      ) do
    active_dis =
      if Map.has_key?(dis, name) do
        put_in(dis, [name, :meta], meta)
      else
        dis
      end

    {:noreply,
     socket
     |> assign(disciples: active_dis)}
  end

  def handle_info({Dojo.Controls, command, arg}, socket) do

    {:noreply, socket |> push_event("mutateShell", %{"command" => command, "args" => arg})}
  end

  def handle_info(event, socket) do
    IO.inspect(event, label: "pokemon catch event")

    {:noreply, socket}
  end

  # def handle_event(
  #       "tellTurtle",
  #       %{"cmd" => cmd},
  #       socket
  #     ) do
  #   # Dojo.Turtle.hatch(%{path: path, commands: commands |> Enum.take(88)}, %{class: class})
  #   {:noreply, socket |> push_event("writeShell", %{"command" => cmd})}
  # end

  # def handle_event(
  #       "tellTurtle",
  #       _,
  #       socket
  #     ) do
  #   # Dojo.Turtle.hatch(%{path: path, commands: commands |> Enum.take(88)}, %{class: class})
  #   {:noreply, socket}
  # end

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
          {name, %{meta: %{path: path}}}, sock ->
            sock
            |> push_event("download-file", %{
              href: path,
              filename: name <> ".png"
            })

          _, sock ->
            sock
        end
      )

    # Dojo.Turtle.hatch(%{path: path, commands: commands |> Enum.take(88)}, %{class: class})
    {:noreply, push_socket}
  end

  def handle_event(
        "hatchTurtle",
        %{"commands" => commands, "path" => path},
        %{assigns: %{class: class, clan: clan, session: %{name: name, last_opened: time}}} =
          socket
      )
      when is_binary(name) do
    dest_dir = Path.join([:code.priv_dir(:dojo), "static", "frames", clan])

    if !File.dir?(dest_dir) do
      File.mkdir(dest_dir)
    end

    id = name <> Base.encode64(to_string(time))

    with file when is_binary(file) <-
           DojoWeb.Utils.Base64.to_file(path, Path.join([dest_dir, id])),
         ext when byte_size(ext) > 0 <- Path.extname(file) do
      Dojo.Turtle.hatch(
        %{
          path: Path.join(["frames", clan, id]) <> ext <> "#bump=#{System.os_time(:second)}",
          commands: commands |> Enum.take(1008)
        },
        %{class: class}
      )
    else
      _ -> nil
    end

    {:noreply, socket |> assign(mytitle: commands |> Dojo.Turtle.find_title())}
  end

  def handle_event(
        "hatchTurtle",
        %{"commands" => commands},
        socket
      ) do
    {:noreply, socket |> assign(mytitle: commands |> Dojo.Turtle.find_title())}
  end

  def handle_event(
        "seeTurtle",
        %{"addr" => addr, "function" => func},
        %{assigns: %{disciples: dis}} = socket
      ) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{
       ast: dis[addr][:meta][:commands] |> Dojo.Turtle.find_fn(func),
       addr: addr,
       mod: "lambda",
       name: func
     })
     |> assign(
       :outershell,
       %{
         addr: addr,
         resp: "drawing @#{addr}'s #{func}"
       }
     )}
  end

  def handle_event(
        "seeTurtle",
        %{"addr" => addr},
        %{assigns: %{disciples: dis, class: _class}} = socket
      )
      when is_binary(addr) do
    command =
      case Dojo.Table.last(dis[addr][:node], :hatch) do
        %{commands: ast} -> ast
        _ -> %{}
      end

    {:noreply,
     socket
     |> push_event("seeOuterShell", %{ast: command, addr: addr, mod: "root"})
     |> assign(
       :outershell,
       %{
         addr: addr,
         title: command |> Dojo.Turtle.find_title(),
         # outerfunctions: dis[addr][:meta][:commands] |> Dojo.Turtle.filter_fns(),
         resp: "#{dis[addr][:name]}"
       }
     )
     |> assign(:right, :pane)}
  end

  def handle_event(
        "seeTurtle",
        %{"function" => func},
        %{assigns: %{myfunctions: commands}} = socket
      ) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{
       ast: commands |> Dojo.Turtle.find_fn(func),
       addr: "my",
       mod: "lambda",
       name: func
     })
     |> assign(
       :outershell,
       %{
         addr: "my",
         resp: "drawing your #{func}"
       }
     )}
  end

  def handle_event("seeTurtle", _, socket) do
    {:noreply,
     socket
     |> assign(
       :outershell,
       nil
     )}
  end


  # Handle the viewport update event from the hook
  def handle_event(
        "seeDisciples",
        %{"visible_disciples" => visible_refs},
        %{assigns: %{disciples: _dis}} = socket
      ) do
    {:noreply, assign(socket, visible_disciples: visible_refs)}
  end

  def handle_event("flipDeck", _, socket),
    do: {:noreply, update(socket, :right, &((&1 == :deck && true) || :deck))}

  def handle_event("flipControl", _, socket),
    do: {:noreply, update(socket, :deck, &(&1 = :control))}

  def handle_event("flipCommand", _, socket),
    do: {:noreply, update(socket, :deck, &(&1 = :command))}

  def handle_event("flipWell", _, socket),
    do: {:noreply, update(socket, :right, &((&1 == :well && true) || :well))}

  def handle_event("flipPane", _, socket), do: {:noreply, update(socket, :pane, &(!&1))}

  def handle_event("opensenseime", _, %{assigns: %{sensei: bool}} = socket) do
    {:noreply, assign(socket, sensei: !bool)}
  end

  def handle_event(
        "toggle-focus",
        %{"disciple-phx_ref" => _phx_ref},
        %{assigns: %{sensei: false}} = socket
      ),
      do: {:noreply, socket}

  def handle_event(
        "toggle-focus",
        %{"disciple-phx_ref" => phx_ref},
        %{assigns: %{sensei: true, clan: clan}} = socket
      ) do
    old_phx_ref = socket.assigns.focused_phx_ref

    new_phx_ref =
      case old_phx_ref do
        "" -> phx_ref
        ^phx_ref -> ""
        _ -> phx_ref
      end

    Dojo.PubSub.publish({new_phx_ref}, :focused_phx_ref, "class:shell:" <> clan)

    # TODO: store focused_phx_ref in presence tracking so that new liveviews know which to focus on

    {:noreply,
     socket
     |> assign(focused_phx_ref: new_phx_ref)}
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

  def deck(assigns) do
    assigns = assign(assigns, :primitive, %{
      command: [
        {"fw", "Move Forward", [length: 50]},
        {"rt", "Face Right", [angle: 30]},
        {"lt", "Face Left", [angle: 30]},
        {"jmp", "Jump Forward", [length: 50]},
        {"wait", "Wait a While", [time: 1]},
        {"label", "Write Something", [text: "'Hello'", size: 10]},
        {"faceto", "Face Towards Start", ["→": 0, "↑": 0]},
        {"goto", "Go To Start", ["→": 0, "↑": 0]},
        {"erase", "Wipe Everything", nil},
        {"hd", "Hide your Head", nil},
        {"show", "Show your Head", nil},
        {"beColour", "Set Colour to", [colour: "'red'"]}
      ],
      control: [
        {"loop", "Repeat Commands", [times: 5]},
        {"def", "Name your Command", [name: "my_cmd"]}
      ]
    })

    ~H"""
    <!-- Command Deck Component (command_deck.html.heex) -->
    <div class={["absolute flex select-none px-1 pb-1 right-5 bottom-5 animate-fade", !@active && "hidden"]}>
      <!-- Command Deck Panel -->
      <div class="fixed w-64 transition-all duration-100 ease-in-out transform right-5 bottom-20 xl:h-2/3 h-1/2 scrollbar-hide dark-scrollbar">
        <%!-- Top row --%>
        <div class="flex pl-6 pt-4 ">
          <!-- Header -->
          <div class="flex items-center justify-between">
            <h2 class="z-50  pointer-events-auto text-xl font-bold text-base-content">
              <div class="dropdown dropdown-top">
                <div tabindex="0" role="button" class="inline-block group cursor-pointer  bg-base-200/50 hover:bg-base-100 transform transition-transform focus-within:border-accent-content border-accent  border-t-0 border-l-0 border-r-0 border-b-2 outline-none text-base-content focus:outline-none ">
                  {to_titlecase("#{@type}")}
                  <svg
                    class={"z-50 w-4 h-4 -ml-3 -mr-2 inline-block  bg-transparent group-focus:text-primary hover:text-primary text-primary/50 items-center group-focus:rotate-180 flex duration-300"}
                    viewBox="0 0 24 24"
                    fill="transparent"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M18 15l-6-6-6 6" />
                  </svg>

                </div>
                <ul tabindex="0" class="dropdown-content dropdown-left text-lg font-bold menu rounded bg-transparent  rounded-box z-60 w-32 p-2 shadow-sm">
                  <li :if={!(@type == :command)} class="hover:bg-accent/50 border-0 rounded-t-lg  border-t-2 border-primary " phx-click="flipCommand" ><a>Command</a></li>
                  <li :if={!(@type == :control)} class="hover:bg-accent/50 border-0 rounded-t-lg   border-t-2 border-primary " phx-click="flipControl" ><a>Control</a></li>
                </ul>
              <span class="inline-block">
                Deck
              </span>

              </div>
            </h2>
          </div>

          <%!-- Undo button --%>
          <div
            class="z-50 pointer-events-auto group pl-6 pt-1"
            phx-click={JS.dispatch("phx:writeShell", detail: %{"command" => "undo"})}
          >
            <div class="relative">
              <button class="flex items-center focus-within:border-accent-content justify-center w-8 h-8 rounded-full border-2 border-accent backdrop-blur-sm transform transition-all duration-300 hover:scale-110 hover:rotate-[-45deg] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:rotate-0">
                <svg
                  class="w-4 h-4 text-primary-content"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M9 14L4 9L9 4" />
                  <path d="M4 9H13.5C16.5376 9 19 11.4624 19 14.5C19 17.5376 16.5376 20 13.5 20H11" />
                </svg>
              </button>
            </div>
            <!-- Tooltip -->
            <div class="absolute pointer-events-none mb-2 transition-opacity duration-200 opacity-0 -top-3 right-6 group-hover:opacity-100">
              <div class="px-2 py-1 text-xs border rounded bg-secondary text-secondary-content border-primary backdrop-blur-sm whitespace-nowrap">
                Undo
              </div>
            </div>
          </div>
        </div>
        <!-- Command&Control Dropdown -->
        <div id="deckofcards" class="h-11/12 overflow-y-scroll p-2 px-4">
          <%= for {cmd, desc, vals} <- @primitive[@type] do %>
            <div
              phx-click={
                JS.dispatch("phx:writeShell",
                  detail: %{@type => cmd, "args" => vals && Keyword.keys(vals)}
                )
              }
              class="flex duration-500 animate-fade items-center p-2 transition-colors rounded pointer-events-auto hover:bg-accent/50 group cursor-pointer"
            >
              <%!-- Icon --%>
              <div class="mr-3">
                <.cmd_icon command={cmd} class="w-8 h-8 fill-primary" />
              </div>
              <div class="flex-grow">
                <%!-- Description --%>
                <code class="font-mono text-sm text-secondary-content">{desc}</code>
                <%!-- Sample code --%>
                <p class="text-xs text-lint-commands flex items-baseline flex-wrap">
                  {cmd}
                  <span :if={vals} class="relative grid-cols-3  ">
                    <input
                      :for={{arg, val} <- vals}
                      type="text"
                      id={"cmdparam-#{cmd}-#{arg}"}
                      value={val}
                      defaulted={val}
                      class="ml-[1ch] bg-base-200/50 hover:bg-base-100 focus-within:border-accent-content border-accent focus-within:bg-primary/40 border-t-0 border-l-0 border-r-0 border-b-2 outline-none text-base-content focus:outline-none text-xs px-0 py-0 min-w-[2ch] max-w-[8ch]"
                      placeholder={arg}
                      phx-update="ignore"
                      phx-keydown={JS.dispatch("phx:writeShell",
                  detail: %{@type => cmd, "args" => vals && Keyword.keys(vals)}
                )}
                      phx-key="Enter"
                      oninput="this.style.width = (this.value.length || this.placeholder.length) + 1 + 'ch';"
                      onclick="event.stopPropagation()"
                    />
                  </span>
                </p>
                <script>
                  // Initialize all input fields lengths
                  window.addEventListener('DOMContentLoaded', () => {
                    document.querySelectorAll('input[id^="cmdparam-"]').forEach(input => {input.style.width = ((input.value.length || input.placeholder.length) + 1) + 'ch';});
                    const mutobserver = new MutationObserver((mutations) => {
                      mutations.forEach((mutation) => {
                      // If nodes were added or attributes changed, resize inputs
                      if (mutation.type === 'childList' || mutation.type === 'attributes') {
                        document.querySelectorAll('input[id^="cmdparam-"]').forEach(input => {input.style.width = ((input.value.length || input.placeholder.length) + 1) + 'ch';});
                      }
                      });
                    });
                    const targetNode = document.getElementById("deckofcards");
                    mutobserver.observe(targetNode, {childList: true});
                  });
                </script>
              </div>
            </div>
          <% end %>
        </div>
        <!-- Decorative corners -->
        <div class="absolute w-3 h-3 border-t-2 border-l-2 -top-1 -left-1 border-primary-content"></div>
        <div class="absolute w-3 h-3 border-t-2 border-r-2 -top-1 right-1 border-primary-content"></div>
        <div class="absolute w-3 h-3 border-b-2 border-l-2 -bottom-8 -left-1 border-primary-content"></div>
        <div class="absolute w-3 h-3 border-b-2 border-r-2 -bottom-8 -right-1 border-primary-content"></div>
      </div>
    </div>
    """
  end

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
                <h3 class="text-sm font-bold text-amber-300 truncate">{"title here"}</h3>
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
                    class="w-4 h-4 text-amber-300"
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
                    class="w-4 h-4 text-amber-300"
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
          class="absolute inset-0 w-6 h-6 text-amber-300 transform transition-transform group-hover:translate-y-0.5"
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
      class="absolute hidden w-full max-w-xs transition-opacity duration-300 ease-in-out opacity-50 group hover:opacity-100 group-hover:block"
    >
      <div class="flex items-center space-x-3">
        <!-- Value Display -->
        <div class="w-4 mr-4 -ml-4 text-left">
          <span class="font-mono text-sm text-amber-300">
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
          <span class="font-mono text-sm text-amber-300">
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

  defp is_main_focus(phx_ref, focused_phx_ref) do
    case phx_ref do
      ^focused_phx_ref -> " scale-150"
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
