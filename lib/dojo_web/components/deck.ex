defmodule DojoWeb.DeckLive do
  use DojoWeb, :live_component

  import DojoWeb.SVGComponents

  alias DojoWeb.Session

  @primitives %{
    command: [
      {"fw", "Move Forward", [length: 50]},
      {"rt", "Face Right", [angle: 30]},
      {"lt", "Face Left", [angle: 30]},
      {"jmp", "Jump Forward", [length: 50]},
      {"wait", "Wait a While", [time: 1]},
      {"label", "Write Something", [text: "'Hello'", size: 10]},
      {"goto", "Go To Start", ["→": 0, "↑": 0]},
      {"jmpto", "Jump To Start", ["→": 0, "↑": 0]},
      {"grid", "Create a Grid", [size: 100, unit: 10]},
      {"faceto", "Face a Point", ["→": 0, "↑": 0]},
      {"dive", "Dive Into Page", [angle: 45]},
      {"roll", "Tilt Right", [angle: 45]},
      {"beColour", "Set Colour to", [colour: "'red'"]},
      {"hide", "Hide your Head", nil},
      {"show", "Show your Head", [size: 10]},
      {"erase", "Wipe Everything", nil}
    ],
    control: [
      {"loop", "Repeat Commands", [times: 5]},
      {"def", "Name your Command", [name: "name"]}
    ]
  }

  def update(assigns, socket) do
    locale = assigns[:locale]

    primitive =
      Map.new(@primitives, fn {key, specs} ->
        translated =
          Enum.map(specs, fn {cmd, msgid, vals} ->
            translated_vals =
              if cmd == "label" && vals do
                Keyword.put(vals, :text, Session.t(locale, "'Hello'"))
              else
                vals
              end

            {cmd, Session.t(locale, msgid), translated_vals}
          end)

        {key, translated}
      end)

    {:ok, assign(socket, locale: locale, primitive: primitive)}
  end

  def render(assigns) do
    ~H"""
    <div
      id="commanddeck"
      class="rightthird fixed right-0 flex deck mt-[15dvh] h-3/5 lg:h-4/5 select-none animate-fade sm:block"
    >
      <!-- Command Deck Panel -->
      <div class="h-5/6 md:h-full transition-all duration-100 ease-in-out transform scrollbar-hide dark-scrollbar">
        <%!-- Top row --%>
        <div class="flex flex-row pl-5 pt-4 justify-between">
          <!-- Header -->
          <div class="flex items-center">
            <h2 class="z-50 pointer-events-auto text-xl font-bold text-base-content">
              <div class="dropdown dropdown-top">
                <div
                  tabindex="0"
                  role="button"
                  class="inline-block group cursor-pointer bg-base-200/50 hover:bg-base-100 transform transition-transform focus-within:border-accent-content border-accent  border-t-0 border-l-0 border-r-0 border-b-2 outline-none text-base-content focus:outline-none inline-flex items-end"
                >
                  <span
                    :for={{key, _} <- @primitive}
                    class={["#{key}", "keygroup"]}
                    {!(key == :command) && %{hidden: true} || %{hidden: false}}
                  >
                    {Session.t(@locale, key |> to_string |> to_titlecase)}
                  </span>
                </div>
                <ul
                  tabindex="0"
                  class="dropdown-content text-lg font-bold menu rounded bg-transparent transition duration-200 rounded-box z-60 w-32 p-2 shadow-sm"
                >
                  <li
                    :for={{key, _} <- @primitive}
                    class={[
                      "#{key}-keyselector keyselector border-0 rounded-t-lg  border-t-2 border-accent hover:border-primary"
                    ]}
                    {(key == :command) && %{hidden: true} || %{hidden: false}}
                    phx-click={
                      JS.set_attribute({"hidden", "true"}, to: ".keygroup")
                      |> JS.remove_attribute("hidden", to: ".#{key}")
                      |> JS.remove_attribute("hidden", to: ".keyselector")
                      |> JS.set_attribute({"hidden", "true"}, to: ".#{key}-keyselector")
                    }
                  >
                    <a>{Session.t(@locale, key |> to_string |> to_titlecase)}</a>
                  </li>
                </ul>
                <br class="sm:hidden" />
                <span class="inline-block">
                  {Session.t(@locale, "Deck")}
                </span>
              </div>
            </h2>
          </div>

          <%!-- Undo button --%>
          <div
            class="z-50 pointer-events-auto group pt-1 pr-5 ml-2 md:ml-4"
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
            <div class="absolute pointer-events-none mb-2 transition-opacity duration-200 opacity-0 -top-3 right-8 group-hover:opacity-100">
              <div class="px-2 py-1 text-xs border rounded bg-secondary text-secondary-content border-primary backdrop-blur-sm whitespace-nowrap">
                Undo
              </div>
            </div>
          </div>
        </div>
        <!-- Command&Control Dropdown -->
        <div
          id="deckofcards"
          class="h-10/12 z-80 overflow-y-scroll pl-4 sm:py-2 sm:px-4 pointer-events-auto mt-2"
        >
          <%= for {key, spec} <- @primitive do %>
            <div
              class={[key, "keygroup"]}
              {!(key == :command) && %{hidden: true} || %{hidden: false}}
            >
              <%= for {cmd, desc, vals} <- spec do %>
                <div
                  phx-click={
                    JS.dispatch("phx:writeShell",
                      detail: %{key => cmd, "args" => vals && Keyword.keys(vals)}
                    )
                    |> JS.add_class(
                      "fill-secondary-content drop-shadow-md drop-shadow-secondary-content ",
                      to: "#cmdicon-#{cmd}"
                    )
                    |> JS.remove_class(
                      "fill-secondary-content drop-shadow-md drop-shadow-secondary-content",
                      to: "#cmdicon-#{cmd}",
                      transition: "ease-out duration-1200",
                      time: 1200
                    )
                  }
                  class="flex duration-500 animate-fade items-center p-2 transition-colors rounded pointer-events-auto hover:bg-accent/50 group cursor-pointer"
                >
                  <%!-- Icon --%>
                  <div id={"cmdicon-#{cmd}"} class="mr-3 fill-primary">
                    <.cmd_icon command={cmd} class="w-8 h-8 " />
                  </div>
                  <div class="grow">
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
                          class="ml-[1ch] bg-base-200/50 caret-accent-content hover:bg-base-100 focus-within:border-accent-content border-accent focus-within:bg-primary/40 border-t-0 border-l-0 border-r-0 border-b-2 outline-none text-base-content focus:outline-none text-xs px-0 py-0 min-w-[2ch] max-w-[8ch]"
                          placeholder={arg}
                          phx-update="ignore"
                          phx-keydown={
                            JS.dispatch("phx:writeShell",
                              detail: %{key => cmd, "args" => vals && Keyword.keys(vals)}
                            )
                            |> JS.add_class(
                              "fill-secondary-content drop-shadow-md drop-shadow-secondary-content ",
                              to: "#cmdicon-#{cmd}"
                            )
                            |> JS.remove_class(
                              "fill-secondary-content drop-shadow-md drop-shadow-secondary-content",
                              to: "#cmdicon-#{cmd}",
                              transition: "ease-out duration-200",
                              time: 200
                            )
                          }
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
          <% end %>
        </div>
        <!-- Decorative corners -->
        <div class="absolute w-3 h-3 border-t-2 border-l-2 top-0 left-0 border-primary-content"></div>
        <div class="absolute w-3 h-3 border-t-2 border-r-2 top-0 right-2 border-primary-content">
        </div>
        <div class="absolute w-3 h-3 border-b-2 border-l-2 bottom-8 left-0 border-primary-content">
        </div>
        <div class="absolute w-3 h-3 border-b-2 border-r-2 bottom-8 right-2 border-primary-content">
        </div>
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
