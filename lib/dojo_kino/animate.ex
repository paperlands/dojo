defmodule DojoKino.Animate do
  use Kino.JS
  use Kino.JS.Live
  @max_speed 10
  @min_speed 0.5
  @default_speed 1

  @spec new(list() | Range.t() | nil, (integer() -> any()), list()) :: Kino.JS.Live.t()
  def new(range_or_list \\ nil, function, opts \\ [])

  def new(nil, start..finish//_ = range, opts) when is_list(opts) do
    component(%{
      start: start,
      finish: finish,
      function: fn index -> Enum.at(range, index) end,
      opts: opts
    })
  end

  def new(nil, list, opts) when is_list(list) and is_list(opts) do
    component(%{
      start: 0,
      finish: nil,
      function: fn index -> Enum.at(list, index) end,
      opts: opts
    })
  end

  def new(nil, function, opts) when is_function(function) and is_list(opts) do
    component(%{
      start: 1,
      finish: nil,
      function: function,
      opts: opts
    })
  end

  def new(start..finish//_, function, opts) when is_function(function) and is_list(opts) do
    component(%{
      start: start,
      finish: finish,
      function: function,
      opts: opts
    })
  end

  def component(state) do
    frame = Kino.Frame.new()
    Kino.render(frame)
    Kino.Frame.render(frame, state.function.(state.start))

    speed_multiplier =
      Keyword.get(state.opts, :speed_multiplier, @default_speed)
      |> max(@min_speed)
      |> min(@max_speed)

    Kino.JS.Live.new(__MODULE__,
      function: state.function,
      frame: frame,
      finish: state.finish,
      speed_multiplier: speed_multiplier,
      step: state.start,
      start: state.start
    )
  end

  @impl true
  def init(state, ctx) do
    {:ok, assign(ctx, state)}
  end

  def increment_step(ctx) do
    incremented_step =
      if ctx.assigns.finish && ctx.assigns.step >= ctx.assigns.finish,
        do: ctx.assigns.start,
        else: ctx.assigns.step + 1

    assign(ctx, step: incremented_step)
  end

  def decrement_step(ctx) do
    decremented_step =
      if ctx.assigns.step <= ctx.assigns.start,
        do: ctx.assigns.finish || ctx.assigns.start,
        else: ctx.assigns.step - 1

    assign(ctx, step: decremented_step)
  end

  def update_animation(ctx) do
    broadcast_event(ctx, "update_animation", %{"step" => ctx.assigns.step})
    Kino.Frame.render(ctx.assigns.frame, ctx.assigns.function.(ctx.assigns.step))
    ctx
  end

  @impl true
  def handle_info(:increment, ctx) do
    if ctx.assigns.running do
      speed = round(1000 / ctx.assigns.speed_multiplier)
      Process.send_after(self(), :increment, speed)
      {:noreply, ctx |> increment_step() |> update_animation()}
    else
      {:noreply, ctx}
    end
  end

  @impl true
  def handle_connect(ctx) do
    {:ok,
     %{
       "start" => ctx.assigns.start,
       "finish" => ctx.assigns.finish,
       "speed_multiplier" => ctx.assigns.speed_multiplier
     }, ctx}
  end

  @impl true
  def handle_event("stop", _, ctx) do
    {:noreply, assign(ctx, running: false)}
  end

  @impl true
  def handle_event("start", _, ctx) do
    Process.send_after(self(), :increment, 1000)
    {:noreply, assign(ctx, running: true)}
  end

  @impl true
  def handle_event("reset", _, ctx) do
    broadcast_event(ctx, "toggle_speed", %{"speed" => @default_speed})

    {:noreply,
     assign(ctx, step: ctx.assigns.start, speed_multiplier: @default_speed, running: false)
     |> update_animation()}
  end

  @impl true
  def handle_event("next", _, ctx) do
    {:noreply, ctx |> increment_step() |> assign(running: false) |> update_animation()}
  end

  @impl true
  def handle_event("previous", _, ctx) do
    {:noreply, ctx |> decrement_step() |> assign(running: false) |> update_animation()}
  end

  def handle_event("toggle_speed", _, ctx) do
    speed = ctx.assigns.speed_multiplier + 0.5
    next_multiplier = if speed > @max_speed, do: @min_speed, else: speed

    broadcast_event(ctx, "toggle_speed", %{"speed" => next_multiplier})

    {:noreply, assign(ctx, speed_multiplier: next_multiplier)}
  end

  asset "main.js" do
    """
    export function init(ctx, payload) {
      ctx.importCSS("main.css");
      ctx.importCSS("https://cdn.jsdelivr.net/npm/remixicon@2.5.0/fonts/remixicon.css")

      ctx.root.innerHTML = `
        <section class="control">
          <span id="reset">Reset</span>
          <span id="step"></span>
          <i id="previous" class="ri-arrow-left-fill icon"></i>
          <i id="start" class="ri-play-fill icon"></i>
          <i id="stop" class="ri-stop-fill icon"></i>
          <i id="next" class="ri-arrow-right-fill icon"></i>
          <span id="speed_multiplier">${payload.speed_multiplier}x</span>
        </section>
      `;

      ctx.handleSync(() => {
        // Synchronously invokes change listeners
        document.activeElement &&
          document.activeElement.dispatchEvent(new Event("change"));
      });

      const start = ctx.root.querySelector("#start");
      const stop = ctx.root.querySelector("#stop");
      const reset = ctx.root.querySelector("#reset");
      const next = ctx.root.querySelector("#next");
      const previous = ctx.root.querySelector("#previous");
      const speed_multiplier = ctx.root.querySelector("#speed_multiplier");
      const step = ctx.root.querySelector("#step");

      if (payload.finish) {
        step.innerHTML = `1/${payload.finish - payload.start + 1}`
      } else {
        step.innerHTML = 1
      }

      stop.style.display = "none"

      start.addEventListener("click", (event) => {
        start.style.display = "none"
        stop.style.display = "inline"
        ctx.pushEvent("start", {});
      });

      stop.addEventListener("click", (event) => {
        stop.style.display = "none"
        start.style.display = "inline"
        ctx.pushEvent("stop", {});
      });

      reset.addEventListener("click", (event) => {
        start.style.display = "inline"
        stop.style.display = "none"
        ctx.pushEvent("reset", {});
      });

      next.addEventListener("click", (event) => {
        ctx.pushEvent("next", {});
      });

      previous.addEventListener("click", (event) => {
        ctx.pushEvent("previous", {});
      });

      speed_multiplier.addEventListener("click", (event) => {
        ctx.pushEvent("toggle_speed", {});
      });

      ctx.handleEvent("toggle_speed", ({ speed }) => {
        speed_multiplier.innerHTML = `${speed}x`;
      });


      ctx.handleEvent("update_animation", ({ step: current_step }) => {
        if (payload.finish) {
          step.innerHTML = `${1 + current_step - payload.start}/${payload.finish - payload.start + 1}`
        } else {
          step.innerHTML = current_step
        }
      });
    }
    """
  end

  asset "main.css" do
    """
    .control {
      padding: 1rem;
      background-color: rgb(240 245 249);
      border-radius: 0.5rem;
      font-weight: 500;
      color: rgb(97 117 138);
      font-family: Inter, system-ui,-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .icon {
        font-size: 1.875rem;
        padding: 0 1rem;
    }

    #reset {
      position: absolute;
      left: 1rem;
    }

    #step {
      position: absolute;
      left: 20%;
    }


    #speed_multiplier {
      position: absolute;
      right: 2rem;
      padding: 0 1rem;
    }

    .icon:hover, #reset:hover, #speed_multiplier:hover {
      color: black;
      cursor: pointer
    }
    """
  end
end
