defmodule DojoWeb.BootLive do
  use DojoWeb, :live_shell
  import DojoWeb.SVGComponents

  def mount(_params, _session, socket) do
    {:ok, assign(socket,
                 loading_progress: 0,
                 loading_text: "Initializing Systems")}
  end

  # Example function to update progress
  def update_progress(socket, progress, text) do
    assign(socket,
           loading_progress: progress,
           loading_text: text
    )
  end
end
