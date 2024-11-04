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
     |> assign(label: nil, clan: nil, outershell: nil, sensei: false, myfunctions: [], outerfunctions: [], class: nil, disciples: %{}, deck: false)
     |> assign(focused_phx_ref: "")}
  end

  def handle_params(params, _url, socket) do
    {:noreply, socket
     |> join_clan(params["clan"] || "home")
     |> sync_session()}
  end

  defp join_clan(socket, clan) do
    Dojo.Class.listen("shell:" <> clan)

    socket
    |> assign(disciples: Dojo.Class.list_disciples("shell:" <> clan))
    |> assign(clan: clan)
  end

  defp sync_session(%{assigns: %{session: %Session{name: name} = sess, clan: clan}} = socket) when is_binary(name) do
    {:ok, class} = Dojo.Class.join(self(), "shell:" <> clan, %Dojo.Disciple{name: name, action: "active"})

    socket
    |> assign(:class, class)
    |> push_event("initSession", sess)
  end

  defp sync_session(socket) do
    socket
  end

  def handle_info(
        {:join, "class:shell" <> _ , %{name: name} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do

    {:noreply,
     socket
     |> assign(:disciples, Map.put(d, name, disciple))}
  end

  def handle_info(
        {:leave, "class:shell"  <> _ , %{name: name, phx_ref: ref} = disciple},
        %{assigns: %{disciples: d}} = socket
      ) do

    if d[name][:phx_ref] == ref do
      {:noreply,
       socket
       |> assign(:disciples, Map.delete(d, name))}
    else
      {:noreply, socket}
    end
  end

  def handle_info({Dojo.PubSub, :focused_phx_ref, {focused_phx_ref}}, socket) do
    {:noreply,
     socket
     |> assign(focused_phx_ref: focused_phx_ref)}
  end

  def handle_info({Dojo.PubSub, :hatch, {name, {Dojo.Turtle, meta}}}, %{assigns: %{disciples: dis}} = socket) do
    active_dis= if Map.has_key?(dis, name) do
      put_in(dis, [name, :meta], meta)
    else
      dis
    end

    {:noreply,
     socket
     |> assign(disciples: active_dis)}
  end

  def handle_event(
        "tellTurtle",
        _,
        %{assigns: %{class: class}} = socket
      ) do
    # Dojo.Turtle.hatch(%{path: path, commands: commands |> Enum.take(88)}, %{class: class})
    {:noreply, socket |>  push_event("writeShell", %{})}
  end

  def handle_event(
        "hatchTurtle",
        %{"commands" => commands, "path" => path},
        %{assigns: %{class: class}} = socket
      ) do
    Dojo.Turtle.hatch(%{path: path, commands: commands |> Enum.take(88)}, %{class: class})
    {:noreply, socket |> assign(myfunctions: commands |> Dojo.Turtle.filter_fns())}
  end


  def handle_event("seeTurtle", %{"addr" => addr, "function" => func}, %{assigns: %{disciples: dis}} = socket) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{ast: dis[addr][:meta][:commands] |> Dojo.Turtle.find_fn(func), addr: addr, mod: "lambda", name: func})
     |> assign(:outershell,
     %{
       addr: addr,
       resp: "drawing @#{addr}'s #{func}"
     })}
  end

  def handle_event("seeTurtle", %{"addr" => addr}, %{assigns: %{disciples: dis}} = socket) when is_binary(addr) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{ast: dis[addr][:meta][:commands], addr: addr, mod: "root"})
     |> assign(:outershell,
     %{
       addr: addr,
       outerfunctions: dis[addr][:meta][:commands] |> Dojo.Turtle.filter_fns(),
       resp: "summoning @#{addr}'s code ☄"
     })}
  end

  def handle_event("seeTurtle", %{"function" => func}, %{assigns: %{myfunctions: commands}} = socket) do
    {:noreply,
     socket
     |> push_event("seeOuterShell", %{ast: commands |> Dojo.Turtle.find_fn(func), addr: "my", mod: "lambda", name: func})
     |> assign(:outershell,
     %{
       addr: "my",
       resp: "drawing your #{func}"
     })}
  end

  def handle_event("seeTurtle", _ , socket) do
    {:noreply,
     socket
     |> assign(:outershell,
       nil)}
  end

  def handle_event("flipDeck", _ , socket), do: {:noreply, update(socket, :deck, &(!&1))}

  def handle_event(
        "name",
        %{"name" => name},
        %{assigns: %{session: sess}} = socket
      ) do
    {:noreply,
     socket
     |> assign(session: %{sess | name: name})
     |> sync_session()}
  end

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
        %{assigns: %{sensei: true}} = socket
      ) do
    old_phx_ref = socket.assigns.focused_phx_ref

    new_phx_ref =
      case old_phx_ref do
        "" -> phx_ref
        ^phx_ref -> ""
        _ -> phx_ref
      end

    Dojo.PubSub.publish({new_phx_ref}, :focused_phx_ref, "class:shell")

    # TODO: store focused_phx_ref in presence tracking so that new liveviews know which to focus on

    {:noreply,
     socket
     |> assign(focused_phx_ref: new_phx_ref)}
  end



  def command_deck(assigns) do
    ~H"""
    <!-- CommandDeck Component (command_deck.html.heex) -->
    <div class="relative">
      <!-- Trigger Button -->
      <div class="absolute bottom-1 right-1 z-50" phx-click={@visible || "flipDeck"}>
        <svg
          class="w-5 h-5 text-brand transition-transform duration-700 hover:rotate-180"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
            fill="#FCD34D"
          />
          <path
            d="M12 3C11.175 3 10.5 3.675 10.5 4.5V4.71094C10.5 5.32494 10.074 5.86494 9.48901 6.05994C9.33001 6.11394 9.17397 6.17397 9.01697 6.23397C8.43897 6.47797 7.76901 6.35191 7.34001 5.92191L7.17999 5.76205C6.60999 5.19205 5.69498 5.19205 5.12598 5.76105L4.76562 6.12109C4.19563 6.69109 4.19563 7.60595 4.76562 8.17595L4.92603 8.33594C5.35703 8.76494 5.48292 9.43494 5.23792 10.0129C5.17792 10.1699 5.11897 10.326 5.06397 10.486C4.86897 11.071 4.32897 11.4961 3.71497 11.4961H3.5C2.675 11.4961 2 12.1721 2 12.9971C2 13.8221 2.675 14.4971 3.5 14.4971H3.71094C4.32494 14.4971 4.86494 14.923 5.05994 15.508C5.11394 15.667 5.17397 15.8231 5.23397 15.9801C5.47797 16.5581 5.35191 17.228 4.92191 17.657L4.76205 17.817C4.19205 18.387 4.19205 19.302 4.76205 19.871L5.12207 20.231C5.69207 20.801 6.60693 20.801 7.17693 20.231L7.33691 20.071C7.76591 19.64 8.43592 19.514 9.01392 19.759C9.17092 19.819 9.32703 19.878 9.48703 19.933C10.072 20.128 10.4971 20.668 10.4971 21.282V21.4971C10.4971 22.3221 11.1731 22.9971 11.9981 22.9971C12.8231 22.9971 13.4981 22.3221 13.4981 21.4971V21.2861C13.4981 20.6721 13.924 20.1321 14.509 19.9371C14.668 19.8831 14.824 19.8231 14.981 19.7631C15.559 19.5191 16.229 19.6451 16.658 20.0751L16.818 20.2349C17.388 20.8049 18.303 20.8049 18.872 20.2349L19.232 19.8749C19.802 19.3049 19.802 18.39 19.232 17.82L19.072 17.66C18.641 17.231 18.515 16.561 18.76 15.983C18.82 15.826 18.879 15.67 18.934 15.51C19.129 14.925 19.669 14.5 20.283 14.5H20.4981C21.3231 14.5 21.9981 13.825 21.9981 13C21.9981 12.175 21.3231 11.5 20.4981 11.5H20.2871C19.6731 11.5 19.1331 11.074 18.9381 10.489C18.8841 10.33 18.8241 10.174 18.7641 10.017C18.5201 9.43896 18.6451 8.76901 19.0751 8.34001L19.2349 8.17999C19.8049 7.60999 19.8049 6.69498 19.2349 6.12598L18.8749 5.76562C18.3049 5.19563 17.39 5.19563 16.82 5.76562L16.66 5.92603C16.231 6.35703 15.561 6.48292 14.983 6.23792C14.826 6.17792 14.67 6.11897 14.51 6.06397C13.925 5.86897 13.5 5.32897 13.5 4.71497V4.5C13.5 3.675 12.825 3 12 3ZM12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12C17 14.7614 14.7614 17 12 17Z"
            fill="#FCD34D"
          />
        </svg>
      </div>

      <!-- Command Deck Panel -->
      <%= if @visible do %>
        <div
          class="fixed top-4 right-4 w-64 bg-brand-900/70 rounded-lg shadow-xl backdrop-blur-sm transform transition-all duration-500 ease-in-out"
          phx-click-away="flipDeck"
        >
          <div class="p-4">
            <!-- Header -->
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-amber-200 font-bold text-xl">Command Deck</h2>
            </div>

            <!-- Command List -->
            <div class="space-y-2">
              <%= for {cmd, desc, icon} <- [
                {"fw", "Move Forward", "M12 5l7 7-7 7"},
                {"rt", "Turn Right", "M5 12h14l-7 7"},
                {"lt", "Turn Left", "M19 12H5l7-7"},
                {"show", "Show Turtle", "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"},
                {"hd", "Hide Turtle", "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8"},
                {"jmp", "Jump To Position", "M5 9l7-7 7 7"},
                {"home", "Return To Start", "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"},
                {"beColour", "Set Color", "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"}
              ] do %>
                <div class="flex items-center p-2 rounded hover:bg-amber-900/50 transition-colors group">
                  <div class="mr-3 text-amber-400">
                    <.cmd_icon command={cmd} class="w-8 h-8 fill-brand"/>
                  </div>
                  <div>
                    <code class="text-amber-300 font-mono text-sm"><%= cmd %></code>
                    <p class="text-amber-200/80 text-xs"><%= desc %></p>
                  </div>
                </div>
              <% end %>
            </div>

            <!-- Footer -->
            <div class="mt-4 pt-4 border-t border-amber-600/50 text-center">
              <p class="text-amber-200/60 text-xs font-serif italic">
                Turtle Navigation System v0.8
              </p>
            </div>
          </div>

          <!-- Decorative corners -->
          <div class="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-amber-400"></div>
          <div class="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-amber-400"></div>
          <div class="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-amber-400"></div>
          <div class="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-amber-400"></div>
        </div>
      <% end %>
    </div>

    """
  end

  defp is_main_focus(phx_ref, focused_phx_ref) do
    case phx_ref do
      ^focused_phx_ref -> " scale-150"
      _ -> " border-brand"
    end
  end
end
